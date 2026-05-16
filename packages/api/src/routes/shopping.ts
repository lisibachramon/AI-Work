import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { requireAuth } from "./auth.js";

// GET /api/shopping-list
//
// Surfaces three buckets the user should consider buying:
//   1. low essentials (toggled low or not-present in the essentials table)
//   2. items consumed in the last 14 days that are no longer in stock
//   3. ingredients referenced in the user's recent recipes (last 5 cooked or
//      suggested) that aren't currently in stock
//
// Returns deduplicated by ingredient_id; each row is annotated with the
// reasons it surfaced so the UI can group / explain.

type Row = {
  ingredient_id: string;
  name_de: string;
  reasons: string[];
};

export async function registerShoppingRoutes(app: FastifyInstance) {
  app.get("/api/shopping-list", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;

    const lowRows = await app.db.execute<{ ingredient_id: string; name_de: string }>(sql`
      SELECT e.ingredient_id, i.canonical_name_de AS name_de
      FROM essentials e
      JOIN ingredients i ON i.id = e.ingredient_id
      WHERE e.user_id = ${userId}
        AND (e.low = true OR e.present = false)
    `);

    const consumedRows = await app.db.execute<{ ingredient_id: string; name_de: string }>(sql`
      SELECT DISTINCT c.ingredient_id, i.canonical_name_de AS name_de
      FROM consumption_events c
      JOIN ingredients i ON i.id = c.ingredient_id
      WHERE c.user_id = ${userId}
        AND c.occurred_at >= now() - INTERVAL '14 days'
        AND NOT EXISTS (
          SELECT 1 FROM stock_items s
          WHERE s.user_id = c.user_id
            AND s.ingredient_id = c.ingredient_id
            AND s.deleted_at IS NULL
            AND s.quantity::numeric > 0
        )
    `);

    const recipeGaps = await app.db.execute<{ ingredient_id: string; name_de: string }>(sql`
      WITH recent AS (
        SELECT id FROM recipes
        WHERE user_id = ${userId}
        ORDER BY GREATEST(coalesce(last_cooked_at, created_at), created_at) DESC
        LIMIT 5
      )
      SELECT DISTINCT ri.ingredient_id, i.canonical_name_de AS name_de
      FROM recipe_ingredients ri
      JOIN recent r ON r.id = ri.recipe_id
      JOIN ingredients i ON i.id = ri.ingredient_id
      WHERE ri.ingredient_id IS NOT NULL
        AND ri.optional = false
        AND NOT EXISTS (
          SELECT 1 FROM stock_items s
          WHERE s.user_id = ${userId}
            AND s.ingredient_id = ri.ingredient_id
            AND s.deleted_at IS NULL
            AND s.quantity::numeric > 0
        )
    `);

    const out = new Map<string, Row>();
    function add(id: string, name: string, reason: string) {
      const r = out.get(id);
      if (r) {
        if (!r.reasons.includes(reason)) r.reasons.push(reason);
      } else {
        out.set(id, { ingredient_id: id, name_de: name, reasons: [reason] });
      }
    }
    for (const r of lowRows) add(r.ingredient_id, r.name_de, "low_essential");
    for (const r of consumedRows) add(r.ingredient_id, r.name_de, "consumed_recently");
    for (const r of recipeGaps) add(r.ingredient_id, r.name_de, "recipe_gap");

    return { items: [...out.values()] };
  });
}
