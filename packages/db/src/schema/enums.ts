// Postgres enum types. The string tuples are duplicated from
// @kitchen/shared/units intentionally — drizzle-kit's CJS loader can't
// read @kitchen/shared's ESM exports map at migration-generation time.
// If you add/remove enum values, update both files (Vitest test in
// @kitchen/shared guards the invariant in CI).

import { pgEnum } from "drizzle-orm/pg-core";

export const INGREDIENT_CATEGORIES = [
  "produce",
  "dairy",
  "meat",
  "fish",
  "bakery",
  "dry_goods",
  "spices",
  "beverages",
  "frozen",
  "condiments",
  "other",
] as const;
export const LOCATION_KINDS = ["pantry", "fridge", "freezer", "spice_rack", "other"] as const;
export const STOCK_SOURCES = [
  "voice",
  "photo",
  "manual",
  "barcode",
  "video_barcode",
  "video_vision",
] as const;
export const STORAGE_UNITS = ["g", "ml", "piece", "bunch", "pack", "slice"] as const;

export const ingredientCategoryEnum = pgEnum("ingredient_category", INGREDIENT_CATEGORIES);
export const locationKindEnum = pgEnum("location_kind", LOCATION_KINDS);
export const storageUnitEnum = pgEnum("storage_unit", STORAGE_UNITS);
export const stockSourceEnum = pgEnum("stock_source", STOCK_SOURCES);

export const ingestionEventKindEnum = pgEnum("ingestion_event_kind", [
  "voice",
  "photo",
  "video_frame",
  "barcode",
  "manual",
]);

export const ingestionEventStatusEnum = pgEnum("ingestion_event_status", [
  "pending",
  "parsed",
  "applied",
  "failed",
  "needs_review",
]);

export const recipeSourceEnum = pgEnum("recipe_source", ["ai", "user", "imported"]);
export const recipeEffortEnum = pgEnum("recipe_effort", ["quick", "medium", "involved"]);
export const recipeHealthEnum = pgEnum("recipe_health", [
  "light",
  "balanced",
  "hearty",
  "indulgent",
]);

export const consumptionReasonEnum = pgEnum("consumption_reason", [
  "cooked",
  "expired",
  "discarded",
  "adjustment",
]);

export const barcodeSourceEnum = pgEnum("barcode_source", [
  "openfoodfacts",
  "manual",
  "llm_guess",
]);

export const dietEnum = pgEnum("diet", [
  "omnivore",
  "vegetarian",
  "vegan",
  "pescatarian",
  "other",
]);
