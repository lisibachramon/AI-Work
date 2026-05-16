import { z } from "zod";

export const STORAGE_UNITS = ["g", "ml", "piece", "bunch", "pack", "slice"] as const;
export const StorageUnit = z.enum(STORAGE_UNITS);
export type StorageUnit = z.infer<typeof StorageUnit>;

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
export const IngredientCategory = z.enum(INGREDIENT_CATEGORIES);
export type IngredientCategory = z.infer<typeof IngredientCategory>;

export const LOCATION_KINDS = ["pantry", "fridge", "freezer", "spice_rack", "other"] as const;
export const LocationKind = z.enum(LOCATION_KINDS);
export type LocationKind = z.infer<typeof LocationKind>;

export const STOCK_SOURCES = [
  "voice",
  "photo",
  "manual",
  "barcode",
  "video_barcode",
  "video_vision",
] as const;
export const StockSource = z.enum(STOCK_SOURCES);
export type StockSource = z.infer<typeof StockSource>;

export interface IngredientConversion {
  density_g_per_ml: number | null;
  typical_piece_weight_g: number | null;
}

// Convert a (quantity, unit) pair to grams for math. Returns null when unconvertible.
export function toGrams(
  quantity: number,
  unit: StorageUnit,
  conv: IngredientConversion,
): number | null {
  switch (unit) {
    case "g":
      return quantity;
    case "ml":
      return conv.density_g_per_ml === null ? null : quantity * conv.density_g_per_ml;
    case "piece":
    case "bunch":
    case "slice":
    case "pack":
      return conv.typical_piece_weight_g === null ? null : quantity * conv.typical_piece_weight_g;
  }
}

// Convert from one unit to another for the same ingredient. Returns null on impossible conversions.
export function convertUnit(
  quantity: number,
  from: StorageUnit,
  to: StorageUnit,
  conv: IngredientConversion,
): number | null {
  if (from === to) return quantity;
  const grams = toGrams(quantity, from, conv);
  if (grams === null) return null;
  switch (to) {
    case "g":
      return grams;
    case "ml":
      return conv.density_g_per_ml === null ? null : grams / conv.density_g_per_ml;
    case "piece":
    case "bunch":
    case "slice":
    case "pack":
      return conv.typical_piece_weight_g === null ? null : grams / conv.typical_piece_weight_g;
  }
}
