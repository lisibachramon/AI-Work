import { z } from "zod";
import { IngredientCategory, LocationKind, StockSource, StorageUnit } from "./units.js";

export const Uuid = z.string().uuid();

export const IngredientInput = z.object({
  canonical_name_de: z.string().min(1).max(120),
  canonical_name_en: z.string().min(1).max(120).optional(),
  category: IngredientCategory,
  default_unit: StorageUnit,
  density_g_per_ml: z.number().positive().nullable().optional(),
  typical_piece_weight_g: z.number().positive().nullable().optional(),
  shelf_life_days: z.number().int().positive().nullable().optional(),
});
export type IngredientInput = z.infer<typeof IngredientInput>;

export const LocationInput = z.object({
  name: z.string().min(1).max(60),
  kind: LocationKind,
  display_order: z.number().int().nonnegative().default(0),
});
export type LocationInput = z.infer<typeof LocationInput>;

export const StockItemInput = z.object({
  ingredient_id: Uuid,
  location_id: Uuid,
  quantity: z.number().positive(),
  unit: StorageUnit,
  original_quantity: z.number().positive().optional(),
  barcode: z.string().min(8).max(14).nullable().optional(),
  purchased_at: z.string().date().nullable().optional(),
  expiry_date: z.string().date().nullable().optional(),
  opened_at: z.string().datetime().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  source: StockSource.default("manual"),
  confidence: z.number().min(0).max(1).default(1),
});
export type StockItemInput = z.infer<typeof StockItemInput>;

// Proposed item from AI ingestion. Goes into ingestion_proposals, NOT directly to stock_items.
export const ProposedItem = z.object({
  name_de: z.string().min(1).max(120),
  quantity: z.number().positive().nullable(),
  unit: StorageUnit.nullable(),
  location_hint: z.string().max(60).nullable(),
  confidence: z.number().min(0).max(1),
  note: z.string().max(200).nullable().optional(),
});
export type ProposedItem = z.infer<typeof ProposedItem>;

export const ProposedInventoryChanges = z.object({
  items: z.array(ProposedItem).max(50),
});
export type ProposedInventoryChanges = z.infer<typeof ProposedInventoryChanges>;

// Recipe filters used by both the HTTP API and the MCP find_recipes tool.
export const RecipeFilters = z.object({
  max_minutes: z.number().int().positive().optional(),
  effort: z.enum(["quick", "medium", "involved"]).optional(),
  healthiness: z.enum(["light", "balanced", "hearty", "indulgent"]).optional(),
  cuisine: z.array(z.string()).optional(),
  must_use: z.array(Uuid).optional(),
  avoid: z.array(z.string()).optional(),
  servings: z.number().int().positive().max(20).optional(),
  leftover_friendly: z.boolean().optional(),
});
export type RecipeFilters = z.infer<typeof RecipeFilters>;

export const RecipeIngredient = z.object({
  ingredient_id: Uuid.nullable(),
  raw_text: z.string(),
  quantity: z.number().nullable(),
  unit: StorageUnit.nullable(),
  optional: z.boolean().default(false),
  note: z.string().nullable().optional(),
});
export type RecipeIngredient = z.infer<typeof RecipeIngredient>;

export const Recipe = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().max(500),
  instructions_md: z.string(),
  effort: z.enum(["quick", "medium", "involved"]),
  time_minutes: z.number().int().positive(),
  healthiness: z.enum(["light", "balanced", "hearty", "indulgent"]),
  cuisine: z.string().max(60).optional(),
  servings: z.number().int().positive(),
  ingredients: z.array(RecipeIngredient),
  pantry_coverage: z.number().min(0).max(1).optional(),
  missing_ingredients: z.array(z.string()).optional(),
});
export type Recipe = z.infer<typeof Recipe>;

export const ProposedRecipes = z.object({
  recipes: z.array(Recipe).max(10),
});
export type ProposedRecipes = z.infer<typeof ProposedRecipes>;
