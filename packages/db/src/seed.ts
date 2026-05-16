// Minimal seed: default locations + a small set of canonical German/Swiss
// ingredients with Swiss-German aliases. Requires SEED_USER_EMAIL pointing to
// a user already registered via the web UI. The full ~500-ingredient seed
// comes in a follow-up via scripts/seed-ingredients.ts.

import { eq } from "drizzle-orm";
import { SWISS_ALIASES } from "@kitchen/shared/text";
import { createDb } from "./client.js";
import {
  ingredientAliases,
  ingredients,
  locations,
  userPreferences,
  users,
} from "./schema/index.js";

type StarterIngredient = {
  de: string;
  en?: string;
  category:
    | "produce"
    | "dairy"
    | "meat"
    | "fish"
    | "bakery"
    | "dry_goods"
    | "spices"
    | "beverages"
    | "frozen"
    | "condiments"
    | "other";
  default_unit: "g" | "ml" | "piece" | "bunch" | "pack" | "slice";
  shelf_life_days?: number;
  typical_piece_weight_g?: number;
  density_g_per_ml?: number;
};

const STARTER_INGREDIENTS: StarterIngredient[] = [
  { de: "Petersilie", en: "parsley", category: "produce", default_unit: "bunch", shelf_life_days: 7, typical_piece_weight_g: 25 },
  { de: "Karotte", en: "carrot", category: "produce", default_unit: "piece", shelf_life_days: 21, typical_piece_weight_g: 80 },
  { de: "Zwiebel", en: "onion", category: "produce", default_unit: "piece", shelf_life_days: 30, typical_piece_weight_g: 120 },
  { de: "Kartoffel", en: "potato", category: "produce", default_unit: "piece", shelf_life_days: 30, typical_piece_weight_g: 150 },
  { de: "Tomate", en: "tomato", category: "produce", default_unit: "piece", shelf_life_days: 7, typical_piece_weight_g: 110 },
  { de: "Apfel", en: "apple", category: "produce", default_unit: "piece", shelf_life_days: 21, typical_piece_weight_g: 180 },
  { de: "Hähnchenbrust", en: "chicken breast", category: "meat", default_unit: "g", shelf_life_days: 3 },
  { de: "Vollmilch", en: "whole milk", category: "dairy", default_unit: "ml", shelf_life_days: 10, density_g_per_ml: 1.03 },
  { de: "Butter", en: "butter", category: "dairy", default_unit: "g", shelf_life_days: 60 },
  { de: "Joghurt", en: "yogurt", category: "dairy", default_unit: "g", shelf_life_days: 21 },
  { de: "Brot", en: "bread", category: "bakery", default_unit: "piece", shelf_life_days: 5 },
  { de: "Mehl", en: "flour", category: "dry_goods", default_unit: "g", shelf_life_days: 365 },
  { de: "Reis", en: "rice", category: "dry_goods", default_unit: "g", shelf_life_days: 365 },
  { de: "Pasta", en: "pasta", category: "dry_goods", default_unit: "g", shelf_life_days: 365 },
  { de: "Salz", en: "salt", category: "spices", default_unit: "g", shelf_life_days: 3650 },
  { de: "Pfeffer", en: "pepper", category: "spices", default_unit: "g", shelf_life_days: 1095 },
  { de: "Olivenöl", en: "olive oil", category: "condiments", default_unit: "ml", shelf_life_days: 540, density_g_per_ml: 0.91 },
];

const STARTER_LOCATIONS: Array<{
  name: string;
  kind: "pantry" | "fridge" | "freezer" | "spice_rack" | "other";
  order: number;
}> = [
  { name: "Kühlschrank", kind: "fridge", order: 0 },
  { name: "Vorratsschrank", kind: "pantry", order: 1 },
  { name: "Tiefkühler", kind: "freezer", order: 2 },
  { name: "Gewürzregal", kind: "spice_rack", order: 3 },
];

function aliasKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const seedEmail = process.env.SEED_USER_EMAIL;
  if (!seedEmail) {
    console.log("seed: SEED_USER_EMAIL not set — skipping. Register via the web UI first.");
    return;
  }

  const db = createDb(url);

  const [user] = await db.select().from(users).where(eq(users.email, seedEmail)).limit(1);
  if (!user) {
    console.log(`seed: no user with email ${seedEmail} — register via the web UI first.`);
    return;
  }

  await db.insert(userPreferences).values({ user_id: user.id }).onConflictDoNothing();

  for (const loc of STARTER_LOCATIONS) {
    await db
      .insert(locations)
      .values({ user_id: user.id, name: loc.name, kind: loc.kind, display_order: loc.order })
      .onConflictDoNothing();
  }

  for (const ing of STARTER_INGREDIENTS) {
    const [row] = await db
      .insert(ingredients)
      .values({
        user_id: user.id,
        canonical_name_de: ing.de,
        canonical_name_en: ing.en,
        category: ing.category,
        default_unit: ing.default_unit,
        shelf_life_days: ing.shelf_life_days,
        typical_piece_weight_g: ing.typical_piece_weight_g?.toString(),
        density_g_per_ml: ing.density_g_per_ml?.toString(),
      })
      .onConflictDoNothing()
      .returning();

    if (!row) continue;
    const aliases = SWISS_ALIASES[aliasKey(ing.de)] ?? [];
    for (const alias of aliases) {
      await db
        .insert(ingredientAliases)
        .values({ ingredient_id: row.id, alias, lang: "de-CH", source: "seed" })
        .onConflictDoNothing();
    }
  }

  console.log("seed: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
