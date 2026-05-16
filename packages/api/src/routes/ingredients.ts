import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { IngredientInput } from "@kitchen/shared/schemas";
import { ingredients } from "@kitchen/db/schema";
import { requireAuth } from "./auth.js";
import { matchIngredient } from "../services/ingestion/matcher.js";

const SearchQuery = z.object({
  q: z.string().min(1).max(120),
  limit: z.coerce.number().int().positive().max(50).default(10),
});

export async function registerIngredientRoutes(app: FastifyInstance) {
  app.get("/api/ingredients/search", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const parsed = SearchQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const results = await matchIngredient(app.db, {
      userId,
      query: parsed.data.q,
      limit: parsed.data.limit,
    });
    return { results };
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
