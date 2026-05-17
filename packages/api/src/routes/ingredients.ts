import type { FastifyInstance } from "fastify";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { IngredientInput } from "@kitchen/shared/schemas";
import { ingredients } from "@kitchen/db/schema";
import { requireAuth } from "./auth.js";
import { matchIngredient } from "../services/ingestion/matcher.js";

const SearchQuery = z.object({
  q: z.string().min(1).max(120),
  limit: z.coerce.number().int().positive().max(50).default(10),
  // Opt-in for now: only compute a query embedding when the caller explicitly
  // asks for it, so we don't pay the Ollama round-trip on every keystroke.
  semantic: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "true"),
});

// Threshold above which we trust the cheap trigram/alias/prefix path and
// don't bother computing a query embedding.
const HIGH_CONFIDENCE_SCORE = 0.85;
// Below this query length the embedding lookup tends to be noise; bge-m3
// gives weak signal on 1–3 character fragments.
const MIN_SEMANTIC_QUERY_LEN = 4;

export async function registerIngredientRoutes(app: FastifyInstance) {
  app.get("/api/ingredients/search", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const parsed = SearchQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

    const { q, limit, semantic } = parsed.data;

    // First pass: cheap lexical match. If we already have a high-confidence
    // canonical/alias/prefix hit, semantic search adds nothing.
    let results = await matchIngredient(app.db, { userId, query: q, limit });

    const topScore = results[0]?.score ?? 0;
    const shouldSemantic =
      semantic &&
      q.trim().length >= MIN_SEMANTIC_QUERY_LEN &&
      topScore < HIGH_CONFIDENCE_SCORE;

    if (shouldSemantic) {
      try {
        const embedRes = await app.llm.embed({ task: "embeddings", texts: [q] });
        const vec = embedRes.vectors[0];
        if (vec && vec.length > 0) {
          results = await matchIngredient(app.db, {
            userId,
            query: q,
            limit,
            queryEmbedding: vec,
          });
        }
      } catch (err) {
        // Semantic is best-effort: if Ollama is down we still return the
        // lexical results rather than blowing up the search endpoint.
        app.log.warn({ err }, "semantic search: ollama embed failed, falling back to lexical");
      }
    }

    return { results };
  });

  app.get("/api/ingredients", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const ListQuery = z.object({
      category: z.string().optional(),
      limit: z.coerce.number().int().positive().max(500).default(200),
    });
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const conditions = [eq(ingredients.user_id, userId)];
    if (parsed.data.category) {
      conditions.push(sql`${ingredients.category}::text = ${parsed.data.category}`);
    }
    return app.db
      .select({
        id: ingredients.id,
        canonical_name_de: ingredients.canonical_name_de,
        canonical_name_en: ingredients.canonical_name_en,
        category: ingredients.category,
        default_unit: ingredients.default_unit,
        shelf_life_days: ingredients.shelf_life_days,
        typical_piece_weight_g: ingredients.typical_piece_weight_g,
        density_g_per_ml: ingredients.density_g_per_ml,
      })
      .from(ingredients)
      .where(and(...conditions))
      .orderBy(ingredients.canonical_name_de)
      .limit(parsed.data.limit);
  });

  app.post("/api/ingredients", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const parsed = IngredientInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const [row] = await app.db
      .insert(ingredients)
      .values({
        user_id: userId,
        canonical_name_de: parsed.data.canonical_name_de,
        canonical_name_en: parsed.data.canonical_name_en,
        category: parsed.data.category,
        default_unit: parsed.data.default_unit,
        density_g_per_ml: parsed.data.density_g_per_ml?.toString(),
        typical_piece_weight_g: parsed.data.typical_piece_weight_g?.toString(),
        shelf_life_days: parsed.data.shelf_life_days,
      })
      .returning();
    return row;
  });

  app.get("/api/ingredients/:id", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const { id } = req.params as { id: string };
    const [row] = await app.db
      .select()
      .from(ingredients)
      .where(and(eq(ingredients.id, id), eq(ingredients.user_id, userId)))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "not_found" });
    return row;
  });
}
