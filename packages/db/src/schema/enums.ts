import { pgEnum } from "drizzle-orm/pg-core";
import {
  INGREDIENT_CATEGORIES,
  LOCATION_KINDS,
  STOCK_SOURCES,
  STORAGE_UNITS,
} from "@kitchen/shared/units";

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
