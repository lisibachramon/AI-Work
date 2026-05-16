import type { FastifyInstance } from "fastify";
import { and, eq, isNull, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { StockItemInput } from "@kitchen/shared/schemas";
import { ingredients, locations, stockItems } from "@kitchen/db/schema";
import { requireAuth } from "./auth.js";

const ListQuery = z.object({
  location_id: z.string().uuid().optional(),
  expiring_within_days: z.coerce.number().int().positive().max(365).optional(),
});

export async function registerStockRoutes(app: FastifyInstance) {
  app.get("/api/stock", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

    const conditions = [eq(stockItems.user_id, userId), isNull(stockItems.deleted_at)];
    if (parsed.data.location_id) conditions.push(eq(stockItems.location_id, parsed.data.location_id));
    if (parsed.data.expiring_within_days !== undefined) {
      conditions.push(
        sql`${stockItems.expiry_date} IS NOT NULL AND ${stockItems.expiry_date} <= current_date + ${parsed.data.expiring_within_days}::int * INTERVAL '1 day'`,
      );
    }

    return app.db
      .select({
        id: stockItems.id,
        quantity: stockItems.quantity,
        unit: stockItems.unit,
        expiry_date: stockItems.expiry_date,
        opened_at: stockItems.opened_at,
        confidence: stockItems.confidence,
        source: stockItems.source,
        ingredient: {
          id: ingredients.id,
          canonical_name_de: ingredients.canonical_name_de,
          category: ingredients.category,
        },
        location: {
          id: locations.id,
          name: locations.name,
          kind: locations.kind,
        },
      })
      .from(stockItems)
      .innerJoin(ingredients, eq(ingredients.id, stockItems.ingredient_id))
      .innerJoin(locations, eq(locations.id, stockItems.location_id))
      .where(and(...conditions))
      .orderBy(asc(stockItems.expiry_date));
  });

  app.post("/api/stock", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const parsed = StockItemInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const v = parsed.data;
    const [row] = await app.db
      .insert(stockItems)
      .values({
        user_id: userId,
        ingredient_id: v.ingredient_id,
        location_id: v.location_id,
        quantity: v.quantity.toString(),
        unit: v.unit,
        original_quantity: v.original_quantity?.toString(),
        barcode: v.barcode ?? undefined,
        purchased_at: v.purchased_at ?? undefined,
        expiry_date: v.expiry_date ?? undefined,
        opened_at: v.opened_at ? new Date(v.opened_at) : undefined,
        notes: v.notes ?? undefined,
        confidence: v.confidence.toString(),
        source: v.source,
      })
      .returning();
    return row;
  });

  app.patch("/api/stock/:id", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const { id } = req.params as { id: string };
    const Body = z.object({
      quantity: z.number().positive().optional(),
      expiry_date: z.string().date().nullable().optional(),
      opened_at: z.string().datetime().nullable().optional(),
      notes: z.string().max(500).nullable().optional(),
      location_id: z.string().uuid().optional(),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const update: Record<string, unknown> = {};
    if (parsed.data.quantity !== undefined) update.quantity = parsed.data.quantity.toString();
    if (parsed.data.expiry_date !== undefined) update.expiry_date = parsed.data.expiry_date;
    if (parsed.data.opened_at !== undefined)
      update.opened_at = parsed.data.opened_at ? new Date(parsed.data.opened_at) : null;
    if (parsed.data.notes !== undefined) update.notes = parsed.data.notes;
    if (parsed.data.location_id !== undefined) update.location_id = parsed.data.location_id;
    if (Object.keys(update).length === 0) return reply.code(400).send({ error: "no_fields" });
    update.updated_at = new Date();

    const [row] = await app.db
      .update(stockItems)
      .set(update)
      .where(and(eq(stockItems.id, id), eq(stockItems.user_id, userId)))
      .returning();
    if (!row) return reply.code(404).send({ error: "not_found" });
    return row;
  });

  app.delete("/api/stock/:id", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const { id } = req.params as { id: string };
    await app.db
      .update(stockItems)
      .set({ deleted_at: new Date() })
      .where(and(eq(stockItems.id, id), eq(stockItems.user_id, userId)));
    return { ok: true };
  });
}
