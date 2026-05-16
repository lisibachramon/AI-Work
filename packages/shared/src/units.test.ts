import { describe, expect, it } from "vitest";
import { convertUnit, toGrams, type IngredientConversion } from "./units.js";

const milk: IngredientConversion = { density_g_per_ml: 1.03, typical_piece_weight_g: null };
const carrot: IngredientConversion = { density_g_per_ml: null, typical_piece_weight_g: 80 };
const opaque: IngredientConversion = { density_g_per_ml: null, typical_piece_weight_g: null };

describe("toGrams", () => {
  it("identity for g", () => {
    expect(toGrams(500, "g", milk)).toBe(500);
  });
  it("converts ml when density is known", () => {
    expect(toGrams(1000, "ml", milk)).toBeCloseTo(1030);
  });
  it("returns null for ml without density", () => {
    expect(toGrams(1000, "ml", carrot)).toBeNull();
  });
  it("converts pieces when typical weight is known", () => {
    expect(toGrams(3, "piece", carrot)).toBe(240);
  });
  it("returns null for pieces without typical weight", () => {
    expect(toGrams(3, "piece", opaque)).toBeNull();
  });
});

describe("convertUnit", () => {
  it("identity unit returns input", () => {
    expect(convertUnit(2, "piece", "piece", carrot)).toBe(2);
  });
  it("g to ml when density known", () => {
    expect(convertUnit(1030, "g", "ml", milk)).toBeCloseTo(1000);
  });
  it("piece to g when typical weight known", () => {
    expect(convertUnit(2, "piece", "g", carrot)).toBe(160);
  });
  it("g to piece (cook recipe says 240g of carrots, stock is pieces)", () => {
    expect(convertUnit(240, "g", "piece", carrot)).toBe(3);
  });
  it("null on impossible conversions", () => {
    expect(convertUnit(1, "piece", "ml", opaque)).toBeNull();
    expect(convertUnit(1, "ml", "piece", milk)).toBeNull(); // milk has density but no piece weight
  });
});
