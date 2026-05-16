import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { essentials, ingredients } from "@kitchen/db/schema";
import { requireAuth } from "./auth.js";

const UpsertBody = z.object({
  ingredient_id: z.string().uuid(),
  present: z.boolean().default(true),
  low: z.boolean().default(false),
});

export async function registerEssentialsRoutes(app: FastifyInstance) {
  app.get("/api/essentials", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    return app.db
      .select({
        id: essentials.id,
        ingredient_id: essentials.ingredient_id,
        ingredient_name: ingredients.canonical_name_de,
        present: essentials.present,
        low: essentials.low,
        updated_at: essentials.updated_at,
      })
      .from(essentials)
      .innerJoin(ingredients, eq(ingredients.id, essentials.ingredient_id))
      .where(eq(essentials.user_id, userId))
      .orderBy(ingredients.canonical_name_de);
  });

  app.post("/api/essentials", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const parsed = UpsertBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

    const [row] = await app.db
      .insert(essentials)
      .values({
        user_id: userId,
        ingredient_id: parsed.data.ingredient_id,
        present: parsed.data.present,
        low: parsed.data.low,
      })
      .onConflictDoUpdate({
        target: [essentials.user_id, essentials.ingredient_id],
        set: {
          present: parsed.data.present,
          low: parsed.data.low,
          updated_at: new Date(),
        },
      })
      .returning();
    return row;
  });

  app.delete("/api/essentials/:ingredient_id", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const { ingredient_id } = req.params as { ingredient_id: string };
    await app.db
      .delete(essentials)
      .where(
        and(eq(essentials.user_id, userId), eq(essentials.ingredient_id, ingredient_id)),
      );
    return { ok: true };
  });
}
