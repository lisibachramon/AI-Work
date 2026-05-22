import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { and, eq, sql } from "drizzle-orm";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { ProposedInventoryChanges, type ProposedItem } from "@kitchen/shared/schemas";
import { matchIngredient, AUTO_LINK_THRESHOLD } from "@kitchen/db";
import {
  ingestionEvents,
  ingestionProposals,
  locations,
  stockItems,
} from "@kitchen/db/schema";
import type { Env } from "../env.js";
import { requireAuth } from "./auth.js";

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? "/app/data/uploads";
const VIDEO_FRAME_MAX_BYTES = 5 * 1024 * 1024;
const VIDEO_FRAMES_PER_BATCH = 3;
const SESSION_DEDUPE_NAME_THRESHOLD = 0.7;

const UUID = z.string().uuid();

const AcceptBody = z.object({
  accepted: z
    .array(
      z.object({
        proposal_id: z.string().uuid(),
        ingredient_id: z.string().uuid().optional(),
        location_id: z.string().uuid(),
        quantity: z.number().positive(),
        unit: z.enum(["g", "ml", "piece", "bunch", "pack", "slice"]),
        expiry_date: z.string().date().nullable().optional(),
      }),
    )
    .max(50),
  rejected: z.array(z.string().uuid()).max(50).default([]),
});

export async function registerIngestRoutes(app: FastifyInstance, env: Env) {
  await app.register(multipart, {
    // Up to VIDEO_FRAMES_PER_BATCH frames per video-frames POST; photos
    // are single-file but the higher limit is harmless for that path.
    limits: { fileSize: 20 * 1024 * 1024, files: VIDEO_FRAMES_PER_BATCH },
  });

  app.post("/api/ingest/photo", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "no_file" });
    if (!file.mimetype.startsWith("image/"))
      return reply.code(400).send({ error: "not_an_image" });

    // Persist + downscale.
    await mkdir(join(UPLOADS_DIR, "photos"), { recursive: true });
    const photoId = randomUUID();
    const buf = await file.toBuffer();
    const processed = await sharp(buf)
      .rotate() // honor EXIF
      .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    const path = join(UPLOADS_DIR, "photos", `${photoId}.jpg`);
    await writeFile(path, processed);

    // Open the ingestion event.
    const [evt] = await app.db
      .insert(ingestionEvents)
      .values({
        user_id: userId,
        kind: "photo",
        status: "pending",
        input_blob_path: path,
      })
      .returning();
    if (!evt) return reply.code(500).send({ error: "event_create_failed" });

    try {
      const system = buildVisionSystemPrompt();
      const userPrompt = `Identifiziere die Lebensmittel auf diesem Foto. Schätze Mengen, gib für jedes ein name_de, quantity, unit, location_hint (Kühlschrank/Vorratsschrank/Tiefkühler/Gewürzregal) und confidence (0-1).`;

      const result = await app.llm.complete({
        task: "photo_vision",
        system,
        prompt: userPrompt,
        schema: ProposedInventoryChanges,
        temperature: 0.2,
        maxTokens: 2048,
        images: [{ media_type: "image/jpeg", data_base64: processed.toString("base64") }],
      });

      await app.db
        .update(ingestionEvents)
        .set({
          status: "needs_review",
          llm_response: result.value as unknown as Record<string, unknown>,
        })
        .where(eq(ingestionEvents.id, evt.id));

      // Resolve each proposed item against the user's ingredient catalogue.
      const enriched = await Promise.all(
        result.value.items.map(async (item) => {
          const matches = await matchIngredient(app.db, {
            userId,
            query: item.name_de,
            limit: 3,
          });
          return { item, matches };
        }),
      );

      // Persist proposals.
      const inserted = await app.db
        .insert(ingestionProposals)
        .values(
          enriched.map(({ item, matches }) => ({
            event_id: evt.id,
            proposed_action: {
              item,
              matches: matches.map((m) => ({
                ingredient_id: m.ingredient_id,
                name: m.canonical_name_de,
                score: m.score,
                matched_via: m.matched_via,
              })),
              // The UI will default to top match when score >= 0.9.
              auto: matches[0]?.score ?? 0 >= AUTO_LINK_THRESHOLD,
            },
          })),
        )
        .returning();

      return { event_id: evt.id, proposals: inserted };
    } catch (err) {
      app.log.error({ err }, "photo ingest failed");
      const msg = err instanceof Error ? err.message : String(err);
      await app.db
        .update(ingestionEvents)
        .set({ status: "failed", error: msg })
        .where(eq(ingestionEvents.id, evt.id));
      return reply.code(502).send({ error: "vision_failed", message: msg });
    }
  });

  app.post("/api/ingest/video-frames", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;

    // Multipart parts: one `session_id` field + 1..N image file parts.
    let sessionId: string | null = null;
    const frames: Buffer[] = [];
    try {
      for await (const part of req.parts()) {
        if (part.type === "field" && part.fieldname === "session_id") {
          const v = typeof part.value === "string" ? part.value : "";
          if (!UUID.safeParse(v).success) {
            return reply.code(400).send({ error: "bad_session_id" });
          }
          sessionId = v;
        } else if (part.type === "file") {
          if (!part.mimetype.startsWith("image/")) {
            return reply.code(400).send({ error: "not_an_image" });
          }
          const buf = await part.toBuffer();
          if (buf.byteLength > VIDEO_FRAME_MAX_BYTES) {
            return reply.code(413).send({ error: "frame_too_large" });
          }
          frames.push(buf);
          if (frames.length > VIDEO_FRAMES_PER_BATCH) {
            return reply.code(400).send({ error: "too_many_frames" });
          }
        }
      }
    } catch (err) {
      app.log.warn({ err }, "video-frames multipart parse failed");
      return reply.code(400).send({ error: "bad_multipart" });
    }
    if (!sessionId) return reply.code(400).send({ error: "missing_session_id" });
    if (frames.length === 0) return reply.code(400).send({ error: "no_frames" });

    // Find-or-create the session's ingestion_events row.
    let evt = await getOrCreateVideoSession(app.db, userId, sessionId);

    const callsUsed = readVisionCalls(evt.metadata);
    const cap = env.VIDEO_MAX_VISION_CALLS_PER_SESSION;
    if (callsUsed >= cap) {
      return reply
        .code(429)
        .send({ error: "cost_cap_reached", calls_used: callsUsed, max: cap });
    }

    // Downscale each frame in-memory; never write video frames to disk.
    const processed = await Promise.all(
      frames.map((buf) =>
        sharp(buf)
          .rotate()
          .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 70 })
          .toBuffer(),
      ),
    );

    try {
      const system = buildVisionSystemPrompt();
      const userPrompt = `Hier sind ${processed.length} aufeinanderfolgende Frames eines Küchen-Videos. Identifiziere die sichtbaren Lebensmittel über alle Frames hinweg, ohne Wiederholungen. Schätze Mengen konservativ.`;

      const result = await app.llm.complete({
        task: "video_vision",
        system,
        prompt: userPrompt,
        schema: ProposedInventoryChanges,
        temperature: 0.2,
        maxTokens: 2048,
        images: processed.map((b) => ({
          media_type: "image/jpeg" as const,
          data_base64: b.toString("base64"),
        })),
      });

      // Existing proposals in this session — used to dedupe by name.
      const existing = await app.db
        .select({ proposed_action: ingestionProposals.proposed_action })
        .from(ingestionProposals)
        .where(eq(ingestionProposals.event_id, evt.id));
      const seenNames = new Set(
        existing
          .map((r) => extractItemName(r.proposed_action))
          .filter((n): n is string => !!n)
          .map(normalizeName),
      );

      const newProposals: Array<{ event_id: string; proposed_action: unknown }> = [];
      for (const item of result.value.items) {
        const norm = normalizeName(item.name_de);
        if (seenNames.has(norm)) continue;
        const matches = await matchIngredient(app.db, {
          userId,
          query: item.name_de,
          limit: 3,
        });
        if (matches[0] && matches[0].score >= SESSION_DEDUPE_NAME_THRESHOLD) {
          const matchNorm = normalizeName(matches[0].canonical_name_de);
          if (seenNames.has(matchNorm)) continue;
          seenNames.add(matchNorm);
        }
        seenNames.add(norm);
        newProposals.push({
          event_id: evt.id,
          proposed_action: {
            item,
            matches: matches.map((m) => ({
              ingredient_id: m.ingredient_id,
              name: m.canonical_name_de,
              score: m.score,
              matched_via: m.matched_via,
            })),
            auto: (matches[0]?.score ?? 0) >= AUTO_LINK_THRESHOLD,
          },
        });
      }

      const inserted = newProposals.length
        ? await app.db.insert(ingestionProposals).values(newProposals).returning()
        : [];

      // Bump call counter + mark event reviewable. We own every write to
      // this metadata blob so overwriting is safe.
      const newCalls = callsUsed + 1;
      const existingMeta =
        evt.metadata && typeof evt.metadata === "object"
          ? (evt.metadata as Record<string, unknown>)
          : {};
      const [updated] = await app.db
        .update(ingestionEvents)
        .set({
          status: "needs_review",
          metadata: { ...existingMeta, vision_calls: newCalls },
        })
        .where(eq(ingestionEvents.id, evt.id))
        .returning();
      evt = updated ?? evt;

      // Total item count in the session after this batch.
      const totalRows = await app.db
        .select({ n: sql<number>`count(*)::int` })
        .from(ingestionProposals)
        .where(eq(ingestionProposals.event_id, evt.id));
      const itemsInSession = totalRows[0]?.n ?? 0;

      return {
        session_id: sessionId,
        event_id: evt.id,
        calls_used: newCalls,
        max: cap,
        items_in_session: itemsInSession,
        new_items: inserted,
      };
    } catch (err) {
      app.log.error({ err }, "video-frames ingest failed");
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: "vision_failed", message: msg });
    }
  });

  app.post("/api/ingest/video-frames/:session_id/finalize", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const { session_id } = req.params as { session_id: string };
    if (!UUID.safeParse(session_id).success) {
      return reply.code(400).send({ error: "bad_session_id" });
    }
    const [evt] = await app.db
      .select()
      .from(ingestionEvents)
      .where(
        and(
          eq(ingestionEvents.user_id, userId),
          eq(ingestionEvents.client_session_id, session_id),
        ),
      )
      .limit(1);
    if (!evt) return reply.code(404).send({ error: "not_found" });
    if (evt.status === "pending") {
      await app.db
        .update(ingestionEvents)
        .set({ status: "needs_review" })
        .where(eq(ingestionEvents.id, evt.id));
    }
    return { event_id: evt.id };
  });

  app.get("/api/ingest/events", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    return app.db
      .select()
      .from(ingestionEvents)
      .where(
        and(eq(ingestionEvents.user_id, userId), eq(ingestionEvents.status, "needs_review")),
      )
      .orderBy(ingestionEvents.created_at);
  });

  app.get("/api/ingest/events/:id", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const { id } = req.params as { id: string };
    const [evt] = await app.db
      .select()
      .from(ingestionEvents)
      .where(and(eq(ingestionEvents.id, id), eq(ingestionEvents.user_id, userId)))
      .limit(1);
    if (!evt) return reply.code(404).send({ error: "not_found" });
    const props = await app.db
      .select()
      .from(ingestionProposals)
      .where(eq(ingestionProposals.event_id, evt.id))
      .orderBy(ingestionProposals.created_at);
    return { event: evt, proposals: props };
  });

  app.post("/api/ingest/events/:id/apply", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const { id } = req.params as { id: string };
    const parsed = AcceptBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

    const [evt] = await app.db
      .select()
      .from(ingestionEvents)
      .where(and(eq(ingestionEvents.id, id), eq(ingestionEvents.user_id, userId)))
      .limit(1);
    if (!evt) return reply.code(404).send({ error: "not_found" });

    // Reject the explicit rejections.
    for (const pid of parsed.data.rejected) {
      await app.db
        .update(ingestionProposals)
        .set({ chosen: false })
        .where(eq(ingestionProposals.id, pid));
    }

    // Apply each accepted item -> stock_items, link the proposal.
    const created: Array<{ stock_item_id: string; proposal_id: string }> = [];
    await app.db.transaction(async (tx) => {
      for (const a of parsed.data.accepted) {
        if (!a.ingredient_id) continue;
        // Verify the location is the user's.
        const [loc] = await tx
          .select()
          .from(locations)
          .where(and(eq(locations.id, a.location_id), eq(locations.user_id, userId)))
          .limit(1);
        if (!loc) continue;
        const [row] = await tx
          .insert(stockItems)
          .values({
            user_id: userId,
            ingredient_id: a.ingredient_id,
            location_id: a.location_id,
            quantity: a.quantity.toString(),
            unit: a.unit,
            expiry_date: a.expiry_date ?? undefined,
            source:
              evt.kind === "photo"
                ? "photo"
                : evt.kind === "video_frame"
                  ? "video_vision"
                  : "voice",
            source_event_id: evt.id,
            confidence: "1.000",
          })
          .returning();
        if (row) {
          await tx
            .update(ingestionProposals)
            .set({ chosen: true, applied_stock_item_id: row.id })
            .where(eq(ingestionProposals.id, a.proposal_id));
          created.push({ stock_item_id: row.id, proposal_id: a.proposal_id });
        }
      }
      await tx
        .update(ingestionEvents)
        .set({ status: "applied", applied_at: new Date() })
        .where(eq(ingestionEvents.id, evt.id));
    });

    return { applied: created.length, items: created };
  });
}

type DbHandle = FastifyInstance["db"];

async function getOrCreateVideoSession(db: DbHandle, userId: string, sessionId: string) {
  const [existing] = await db
    .select()
    .from(ingestionEvents)
    .where(
      and(
        eq(ingestionEvents.user_id, userId),
        eq(ingestionEvents.client_session_id, sessionId),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(ingestionEvents)
    .values({
      user_id: userId,
      kind: "video_frame",
      status: "pending",
      client_session_id: sessionId,
      metadata: { vision_calls: 0 },
    })
    .returning();
  if (!created) throw new Error("could not create video session event");
  return created;
}

function readVisionCalls(metadata: unknown): number {
  if (metadata && typeof metadata === "object" && "vision_calls" in metadata) {
    const v = (metadata as { vision_calls: unknown }).vision_calls;
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return 0;
}

function extractItemName(proposedAction: unknown): string | null {
  if (
    proposedAction &&
    typeof proposedAction === "object" &&
    "item" in proposedAction &&
    proposedAction.item &&
    typeof proposedAction.item === "object" &&
    "name_de" in proposedAction.item
  ) {
    const n = (proposedAction.item as { name_de: unknown }).name_de;
    return typeof n === "string" ? n : null;
  }
  return null;
}

function normalizeName(s: string): string {
  return s
    .toLocaleLowerCase("de")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildVisionSystemPrompt(): string {
  return `Du bist ein Assistent, der Fotos von Lebensmitteln in der Küche analysiert.

Aufgabe: Identifiziere jedes erkennbare Lebensmittel und gib eine Liste von Vorschlägen aus.

Regeln:
- Benutze deutsche Lebensmittelnamen (Singular, kanonisch). Berücksichtige Schweizer Begriffe.
- Schätze Mengen konservativ. Eine Tomate = 1 piece. Eine Milchflasche = ca. 1000 ml. Käseblock = Schätzung in g.
- unit: g | ml | piece | bunch | pack | slice
- location_hint: "Kühlschrank" | "Vorratsschrank" | "Tiefkühler" | "Gewürzregal" | null
- confidence: 0-1. Klar erkennbar = 0.9+. Ungewiss = 0.5. Wenn unsicher, lieber niedriger.
- Keine Marken raten. Wenn du nicht sicher bist, was es ist, lass es weg.
- Keine Mengen über das Bild rätseln, was nicht sichtbar ist.
- Maximal 30 Items pro Bild.
`;
}
