// MCP tool definitions. M1 wires the read-only tools against the DB so
// Claude Desktop can answer "what's in my pantry?" the moment the spine
// is up. Write/cook tools land in M2/M3 once ingestion is real.

import { z } from "zod";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { DbClient } from "@kitchen/db";
import { matchIngredient } from "@kitchen/db";
import { ingredients, locations, stockItems } from "@kitchen/db/schema";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (db: DbClient, userId: string, input: unknown) => Promise<unknown>;
}

const ListInventoryInput = z.object({
  location_kind: z.enum(["pantry", "fridge", "freezer", "spice_rack", "other"]).optional(),
  expiring_within_days: z.number().int().positive().max(365).optional(),
});

const SearchInput = z.object({
  query: z.string().min(1).max(120),
  limit: z.number().int().positive().max(50).default(10),
});

const ExpiringInput = z.object({
  days: z.number().int().positive().max(60).default(7),
});

export const TOOLS: ToolDef[] = [
  {
    name: "list_inventory",
    description:
      "List the user's current pantry stock. Optionally filter by location kind or items expiring within N days.",
    inputSchema: ListInventoryInput,
    async handler(db, userId, input) {
      const args = ListInventoryInput.parse(input);
      const conditions = [eq(stockItems.user_id, userId), isNull(stockItems.deleted_at)];
      if (args.location_kind) conditions.push(eq(locations.kind, args.location_kind));
      if (args.expiring_within_days !== undefined) {
        conditions.push(
          sql`${stockItems.expiry_date} IS NOT NULL AND ${stockItems.expiry_date} <= current_date + ${args.expiring_within_days}::int * INTERVAL '1 day'`,
        );
      }
      return db
        .select({
          quantity: stockItems.quantity,
          unit: stockItems.unit,
          expiry_date: stockItems.expiry_date,
          ingredient: ingredients.canonical_name_de,
          location: locations.name,
        })
        .from(stockItems)
        .innerJoin(ingredients, eq(ingredients.id, stockItems.ingredient_id))
        .innerJoin(locations, eq(locations.id, stockItems.location_id))
        .where(and(...conditions))
        .orderBy(asc(stockItems.expiry_date));
    },
  },
  {
    name: "search_ingredients",
    description:
      "Search the user's ingredient catalogue by German name, alias, or fuzzy match. Returns ranked candidates.",
    inputSchema: SearchInput,
    async handler(db, userId, input) {
      const args = SearchInput.parse(input);
      return matchIngredient(db, { userId, query: args.query, limit: args.limit });
    },
  },
  {
    name: "get_expiring",
    description: "List items expiring within the given number of days (default 7).",
    inputSchema: ExpiringInput,
    async handler(db, userId, input) {
      const args = ExpiringInput.parse(input);
      return db
        .select({
          ingredient: ingredients.canonical_name_de,
          quantity: stockItems.quantity,
          unit: stockItems.unit,
          expiry_date: stockItems.expiry_date,
          location: locations.name,
        })
        .from(stockItems)
        .innerJoin(ingredients, eq(ingredients.id, stockItems.ingredient_id))
        .innerJoin(locations, eq(locations.id, stockItems.location_id))
        .where(
          and(
            eq(stockItems.user_id, userId),
            isNull(stockItems.deleted_at),
            sql`${stockItems.expiry_date} IS NOT NULL AND ${stockItems.expiry_date} <= current_date + ${args.days}::int * INTERVAL '1 day'`,
          ),
        )
        .orderBy(asc(stockItems.expiry_date));
    },
  },
];
