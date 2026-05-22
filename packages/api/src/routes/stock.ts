import type { FastifyInstance } from "fastify";
import { and, eq, isNull, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { StockItemInput } from "@kitchen/shared/schemas";
import { barcodes, ingredients, locations, stockItems } from "@kitchen/db/schema";
import type { INGREDIENT_CATEGORIES, LOCATION_KINDS } from "@kitchen/db/schema";
import { requireAuth } from "./auth.js";

type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number];
type LocationKind = (typeof LOCATION_KINDS)[number];

// Default location kind by ingredient category. Used by the scan-and-add-all
// auto-add path; the user can change it afterwards from inventory.
const CATEGORY_TO_LOCATION_KIND: Record<IngredientCategory, LocationKind> = {
  produce: "fridge",
  dairy: "fridge",
  meat: "fridge",
  fish: "fridge",
  frozen: "freezer",
  spices: "spice_rack",
  bakery: "pantry",
  dry_goods: "pantry",
  beverages: "pantry",
  condiments: "pantry",
  other: "pantry",
};

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

  const FromGtinBody = z.object({
    gtin: z.string().regex(/^[0-9]{8,14}$/),
    quantity: z.number().positive().max(9999).optional(),
    location_id: z.string().uuid().optional(),
  });

  app.post("/api/stock/from-gtin", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const parsed = FromGtinBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const gtin = parsed.data.gtin.padStart(13, "0").slice(-13);

    const [bc] = await app.db.select().from(barcodes).where(eq(barcodes.gtin, gtin)).limit(1);
    if (!bc || !bc.ingredient_id) {
      return reply.code(404).send({ error: "unknown_gtin" });
    }
    const [ing] = await app.db
      .select()
      .from(ingredients)
      .where(and(eq(ingredients.id, bc.ingredient_id), eq(ingredients.user_id, userId)))
      .limit(1);
    if (!ing) return reply.code(404).send({ error: "ingredient_not_for_user" });

    // Pick the location: caller's explicit choice → category default → first owned.
    let locationId = parsed.data.location_id;
    if (!locationId) {
      const owned = await app.db
        .select()
        .from(locations)
        .where(eq(locations.user_id, userId))
        .orderBy(asc(locations.display_order));
      if (owned.length === 0) return reply.code(409).send({ error: "no_locations" });
      const preferredKind = CATEGORY_TO_LOCATION_KIND[ing.category as IngredientCategory];
      locationId = (owned.find((l) => l.kind === preferredKind) ?? owned[0])!.id;
    }

    const unit = bc.package_unit ?? "piece";
    const pkgQty = bc.package_quantity ? Number(bc.package_quantity) : null;
    const quantity =
      parsed.data.quantity ?? (pkgQty && Number.isFinite(pkgQty) ? pkgQty : 1);

    const [row] = await app.db
      .insert(stockItems)
      .values({
        user_id: userId,
        ingredient_id: ing.id,
        location_id: locationId,
        quantity: quantity.toString(),
        unit,
        barcode: gtin,
        source: "video_barcode",
        confidence: "1.000",
      })
      .returning();
    return { stock_item: row, ingredient: { id: ing.id, name: ing.canonical_name_de } };
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
