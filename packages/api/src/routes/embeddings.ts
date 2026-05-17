import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { requireAuth } from "./auth.js";

// POST /api/embeddings/backfill
//
// Finds ingredients owned by the authed user that are missing an embedding and
// fills them in using Ollama (bge-m3, 1024-dim). Idempotent: rows whose
// embedding is already populated are skipped.
//
// We batch 32 rows at a time, embed in one Ollama call, then commit each batch
// inside its own transaction. That way an interrupted run still leaves earlier
// batches durably written, and a crash mid-batch is just rolled back — never
// a half-written row.
//
// If Ollama is unreachable we abort the current batch (its tx rolls back),
// don't touch any further rows, and return 502.

const BATCH_SIZE = 32;

type PendingRow = {
  id: string;
  canonical_name_de: string;
  canonical_name_en: string | null;
};

function buildEmbedText(row: PendingRow): string {
  // bge-m3 is multilingual, so feeding both names when present nudges the
  // vector toward the shared meaning instead of just the German surface form.
  if (row.canonical_name_en && row.canonical_name_en.trim().length > 0) {
    return `${row.canonical_name_de}, ${row.canonical_name_en}`;
  }
  return row.canonical_name_de;
}

export async function registerEmbeddingsRoutes(app: FastifyInstance) {
  app.post("/api/embeddings/backfill", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;

    // Count what's already done up front so the response can report skipped.
    // (Anything not picked up by the missing-set below was already populated.)
    const skippedRows = await app.db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM ingredients
      WHERE user_id = ${userId}
        AND embedding IS NOT NULL
    `);
    const skipped = Number(skippedRows[0]?.count ?? 0);

    let updated = 0;

    // Loop until no more rows are missing an embedding. Each iteration grabs
    // BATCH_SIZE rows; if Ollama or the embed step fails we abort with 502 and
    // the in-flight transaction rolls back so partial vectors aren't written.
    while (true) {
      const pending = await app.db.execute<PendingRow>(sql`
        SELECT id, canonical_name_de, canonical_name_en
        FROM ingredients
        WHERE user_id = ${userId}
          AND embedding IS NULL
        ORDER BY created_at ASC
        LIMIT ${BATCH_SIZE}
      `);
      if (pending.length === 0) break;

      const texts = pending.map(buildEmbedText);

      let vectors: number[][];
      try {
        const res = await app.llm.embed({ task: "embeddings", texts });
        vectors = res.vectors;
      } catch (err) {
        app.log.error({ err }, "embeddings backfill: ollama embed failed");
        return reply.code(502).send({
          error: "ollama_failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }

      if (vectors.length !== pending.length) {
        app.log.error(
          { expected: pending.length, got: vectors.length },
          "embeddings backfill: vector count mismatch",
        );
        return reply.code(502).send({
          error: "ollama_failed",
          message: `expected ${pending.length} vectors, got ${vectors.length}`,
        });
      }

      try {
        await app.db.transaction(async (tx) => {
          for (let i = 0; i < pending.length; i++) {
            const row = pending[i]!;
            const vec = vectors[i]!;
            const vecLit = `[${vec.join(",")}]`;
            await tx.execute(sql`
              UPDATE ingredients
              SET embedding = ${vecLit}::vector,
                  updated_at = now()
              WHERE id = ${row.id}
                AND user_id = ${userId}
                AND embedding IS NULL
            `);
          }
        });
      } catch (err) {
        app.log.error({ err }, "embeddings backfill: db write failed");
        return reply.code(502).send({
          error: "ollama_failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }

      updated += pending.length;
    }

    return { updated, skipped };
  });
}
