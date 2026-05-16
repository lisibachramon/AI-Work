// Build a pantry snapshot suitable for prompting an LLM:
// canonical names + quantities, location, days-to-expiry, and a
// must-use priority for items that are about to spoil.

import { eq, sql } from "drizzle-orm";
import type { DbClient } from "@kitchen/db";
import { essentials, ingredients } from "@kitchen/db/schema";

export interface PantryItem {
  ingredient_id: string;
  name_de: string;
  category: string;
  quantity: number;
  unit: string;
  location: string;
  expires_in_days: number | null;
  must_use_priority: "high" | "medium" | "low";
}

export interface PantrySnapshot {
  items: PantryItem[];
  essentials: string[]; // canonical names the user marks as always-on-hand
  low_essentials: string[]; // marked low and likely missing
}

export async function buildPantrySnapshot(
  db: DbClient,
  userId: string,
): Promise<PantrySnapshot> {
  type StockRow = {
    ingredient_id: string;
    name_de: string;
    category: string;
    quantity: string;
    unit: string;
    location: string;
    expiry_date: string | null;
  };
  const rows = await db.execute<StockRow>(sql`
    SELECT
      s.ingredient_id,
      i.canonical_name_de AS name_de,
      i.category::text AS category,
      s.quantity::text AS quantity,
      s.unit::text AS unit,
      l.name AS location,
      s.expiry_date::text AS expiry_date
    FROM stock_items s
    JOIN ingredients i ON i.id = s.ingredient_id
    JOIN locations l ON l.id = s.location_id
    WHERE s.user_id = ${userId} AND s.deleted_at IS NULL
    ORDER BY s.expiry_date NULLS LAST, i.canonical_name_de
  `);

  const items: PantryItem[] = rows.map((r) => {
    let expires_in_days: number | null = null;
    if (r.expiry_date) {
      const ms = new Date(r.expiry_date + "T00:00:00Z").getTime() - Date.now();
      expires_in_days = Math.ceil(ms / 86400000);
    }
    let must_use_priority: PantryItem["must_use_priority"] = "low";
    if (expires_in_days !== null) {
      if (expires_in_days <= 1) must_use_priority = "high";
      else if (expires_in_days <= 4) must_use_priority = "medium";
    }
    return {
      ingredient_id: r.ingredient_id,
      name_de: r.name_de,
      category: r.category,
      quantity: Number(r.quantity),
      unit: r.unit,
      location: r.location,
      expires_in_days,
      must_use_priority,
    };
  });

  const ess = await db
    .select({
      name: ingredients.canonical_name_de,
      present: essentials.present,
      low: essentials.low,
    })
    .from(essentials)
    .innerJoin(ingredients, eq(ingredients.id, essentials.ingredient_id))
    .where(eq(essentials.user_id, userId));

  return {
    items,
    essentials: ess.filter((e) => e.present && !e.low).map((e) => e.name),
    low_essentials: ess.filter((e) => e.low).map((e) => e.name),
  };
}
