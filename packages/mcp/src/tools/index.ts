// MCP tool definitions. Read-only operations against the kitchen db.
// Recipe generation lives in the API (uses Claude OAuth); the MCP tools
// surface what's already persisted so Claude Desktop can plan from your
// pantry directly.

import { z } from "zod";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { DbClient } from "@kitchen/db";
import { matchIngredient } from "@kitchen/db";
import {
  ingredients,
  locations,
  recipes,
  recipeIngredients,
  stockItems,
} from "@kitchen/db/schema";

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

const RecipeSearchInput = z.object({
  query: z.string().min(1).max(200).optional(),
  effort: z.enum(["quick", "medium", "involved"]).optional(),
  max_minutes: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(20).default(10),
});

const RecipeDetailInput = z.object({
  recipe_id: z.string().uuid(),
});

export const TOOLS: ToolDef[] = [
  {
    name: "list_inventory",
    description:
      "List the user's current pantry stock. Optionally filter by location kind or items expiring within N days. Returns canonical names, quantities, units, location, and expiry days.",
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
      "Search the user's ingredient catalogue by German name, alias, or fuzzy match (canonical + Swiss-German aliases + trigram + prefix). Returns ranked candidates.",
    inputSchema: SearchInput,
    async handler(db, userId, input) {
      const args = SearchInput.parse(input);
      return matchIngredient(db, { userId, query: args.query, limit: args.limit });
    },
  },
  {
    name: "get_expiring",
    description: "List stock items expiring within the given number of days (default 7).",
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
  {
    name: "find_recipes",
    description:
      "Search the user's saved recipes (both AI-suggested and user-saved). Optional filters by effort and max time. Returns title + summary + meta — call get_recipe for full instructions.",
    inputSchema: RecipeSearchInput,
    async handler(db, userId, input) {
      const args = RecipeSearchInput.parse(input);
      const conditions = [eq(recipes.user_id, userId)];
      if (args.effort) conditions.push(eq(recipes.effort, args.effort));
      if (args.max_minutes !== undefined) {
        conditions.push(sql`${recipes.time_minutes} <= ${args.max_minutes}`);
      }
      if (args.query) {
        conditions.push(
          sql`(${recipes.title} ILIKE ${`%${args.query}%`} OR ${recipes.summary} ILIKE ${`%${args.query}%`})`,
        );
      }
      return db
        .select({
          id: recipes.id,
          title: recipes.title,
          summary: recipes.summary,
          effort: recipes.effort,
          time_minutes: recipes.time_minutes,
          servings: recipes.servings,
          times_cooked: recipes.times_cooked,
          rating: recipes.rating,
        })
        .from(recipes)
        .where(and(...conditions))
        .orderBy(sql`${recipes.last_cooked_at} DESC NULLS LAST`, sql`${recipes.created_at} DESC`)
        .limit(args.limit);
    },
  },
  {
    name: "get_recipe",
    description:
      "Fetch a recipe with full instructions and ingredient list. Useful after find_recipes returns a candidate id.",
    inputSchema: RecipeDetailInput,
    async handler(db, userId, input) {
      const args = RecipeDetailInput.parse(input);
      const [recipe] = await db
        .select()
        .from(recipes)
        .where(and(eq(recipes.id, args.recipe_id), eq(recipes.user_id, userId)))
        .limit(1);
      if (!recipe) return { error: "not_found" };
      const ris = await db
        .select({
          raw_text: recipeIngredients.raw_text,
          quantity: recipeIngredients.quantity,
          unit: recipeIngredients.unit,
          optional: recipeIngredients.optional,
          ingredient_name: ingredients.canonical_name_de,
        })
        .from(recipeIngredients)
        .leftJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredient_id))
        .where(eq(recipeIngredients.recipe_id, args.recipe_id));
      return { ...recipe, ingredients: ris };
    },
  },
  {
    name: "get_shopping_list",
    description:
      "Surface items the user should consider buying. Combines low essentials, ingredients consumed recently but no longer in stock, and gaps in recent recipes.",
    inputSchema: z.object({}),
    async handler(db, userId, _input) {
      const lowRows = await db.execute<{ ingredient_id: string; name_de: string }>(sql`
        SELECT e.ingredient_id, i.canonical_name_de AS name_de
        FROM essentials e
        JOIN ingredients i ON i.id = e.ingredient_id
        WHERE e.user_id = ${userId}
          AND (e.low = true OR e.present = false)
      `);
      const consumedRows = await db.execute<{ ingredient_id: string; name_de: string }>(sql`
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
      const out = new Map<string, { name_de: string; reasons: string[] }>();
      for (const r of lowRows) {
        const cur = out.get(r.ingredient_id);
        if (cur) cur.reasons.push("low_essential");
        else out.set(r.ingredient_id, { name_de: r.name_de, reasons: ["low_essential"] });
      }
      for (const r of consumedRows) {
        const cur = out.get(r.ingredient_id);
        if (cur) cur.reasons.push("consumed_recently");
        else out.set(r.ingredient_id, { name_de: r.name_de, reasons: ["consumed_recently"] });
      }
      return {
        items: Array.from(out.entries()).map(([id, v]) => ({
          ingredient_id: id,
          name: v.name_de,
          reasons: v.reasons,
        })),
      };
    },
  },
];
