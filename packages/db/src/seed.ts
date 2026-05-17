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
  // Produce
  { de: "Petersilie", en: "parsley", category: "produce", default_unit: "bunch", shelf_life_days: 7, typical_piece_weight_g: 25 },
  { de: "Karotte", en: "carrot", category: "produce", default_unit: "piece", shelf_life_days: 21, typical_piece_weight_g: 80 },
  { de: "Zwiebel", en: "onion", category: "produce", default_unit: "piece", shelf_life_days: 30, typical_piece_weight_g: 120 },
  { de: "Kartoffel", en: "potato", category: "produce", default_unit: "piece", shelf_life_days: 30, typical_piece_weight_g: 150 },
  { de: "Tomate", en: "tomato", category: "produce", default_unit: "piece", shelf_life_days: 7, typical_piece_weight_g: 110 },
  { de: "Apfel", en: "apple", category: "produce", default_unit: "piece", shelf_life_days: 21, typical_piece_weight_g: 180 },
  { de: "Spinat", en: "spinach", category: "produce", default_unit: "g", shelf_life_days: 4 },
  { de: "Salat", en: "lettuce", category: "produce", default_unit: "piece", shelf_life_days: 7, typical_piece_weight_g: 350 },
  { de: "Gurke", en: "cucumber", category: "produce", default_unit: "piece", shelf_life_days: 10, typical_piece_weight_g: 400 },
  { de: "Paprika", en: "bell pepper", category: "produce", default_unit: "piece", shelf_life_days: 10, typical_piece_weight_g: 160 },
  { de: "Zucchini", en: "zucchini", category: "produce", default_unit: "piece", shelf_life_days: 10, typical_piece_weight_g: 250 },
  { de: "Aubergine", en: "eggplant", category: "produce", default_unit: "piece", shelf_life_days: 10, typical_piece_weight_g: 300 },
  { de: "Brokkoli", en: "broccoli", category: "produce", default_unit: "piece", shelf_life_days: 7, typical_piece_weight_g: 400 },
  { de: "Blumenkohl", en: "cauliflower", category: "produce", default_unit: "piece", shelf_life_days: 7, typical_piece_weight_g: 700 },
  { de: "Pilze", en: "mushrooms", category: "produce", default_unit: "g", shelf_life_days: 5 },
  { de: "Knoblauch", en: "garlic", category: "produce", default_unit: "piece", shelf_life_days: 90, typical_piece_weight_g: 50 },
  { de: "Ingwer", en: "ginger", category: "produce", default_unit: "g", shelf_life_days: 30 },
  { de: "Lauch", en: "leek", category: "produce", default_unit: "piece", shelf_life_days: 14, typical_piece_weight_g: 200 },
  { de: "Sellerie", en: "celery", category: "produce", default_unit: "piece", shelf_life_days: 14, typical_piece_weight_g: 500 },
  { de: "Fenchel", en: "fennel", category: "produce", default_unit: "piece", shelf_life_days: 10, typical_piece_weight_g: 300 },
  { de: "Birne", en: "pear", category: "produce", default_unit: "piece", shelf_life_days: 10, typical_piece_weight_g: 180 },
  { de: "Banane", en: "banana", category: "produce", default_unit: "piece", shelf_life_days: 7, typical_piece_weight_g: 120 },
  { de: "Orange", en: "orange", category: "produce", default_unit: "piece", shelf_life_days: 21, typical_piece_weight_g: 200 },
  { de: "Zitrone", en: "lemon", category: "produce", default_unit: "piece", shelf_life_days: 21, typical_piece_weight_g: 100 },
  { de: "Erdbeere", en: "strawberry", category: "produce", default_unit: "g", shelf_life_days: 4 },
  { de: "Blaubeere", en: "blueberry", category: "produce", default_unit: "g", shelf_life_days: 7 },
  { de: "Himbeere", en: "raspberry", category: "produce", default_unit: "g", shelf_life_days: 3 },
  { de: "Avocado", en: "avocado", category: "produce", default_unit: "piece", shelf_life_days: 7, typical_piece_weight_g: 200 },
  { de: "Schnittlauch", en: "chives", category: "produce", default_unit: "bunch", shelf_life_days: 7, typical_piece_weight_g: 20 },

  // Dairy
  { de: "Vollmilch", en: "whole milk", category: "dairy", default_unit: "ml", shelf_life_days: 10, density_g_per_ml: 1.03 },
  { de: "Magermilch", en: "skim milk", category: "dairy", default_unit: "ml", shelf_life_days: 10, density_g_per_ml: 1.035 },
  { de: "Butter", en: "butter", category: "dairy", default_unit: "g", shelf_life_days: 60 },
  { de: "Joghurt", en: "yogurt", category: "dairy", default_unit: "g", shelf_life_days: 21 },
  { de: "Quark", en: "quark", category: "dairy", default_unit: "g", shelf_life_days: 14 },
  { de: "Mozzarella", en: "mozzarella", category: "dairy", default_unit: "g", shelf_life_days: 14 },
  { de: "Parmesan", en: "parmesan", category: "dairy", default_unit: "g", shelf_life_days: 90 },
  { de: "Feta", en: "feta", category: "dairy", default_unit: "g", shelf_life_days: 30 },
  { de: "Sahne", en: "cream", category: "dairy", default_unit: "ml", shelf_life_days: 10, density_g_per_ml: 1.0 },
  { de: "Crème Fraîche", en: "crème fraîche", category: "dairy", default_unit: "g", shelf_life_days: 21 },
  { de: "Frischkäse", en: "cream cheese", category: "dairy", default_unit: "g", shelf_life_days: 21 },
  { de: "Ricotta", en: "ricotta", category: "dairy", default_unit: "g", shelf_life_days: 14 },
  { de: "Gruyère", en: "gruyère", category: "dairy", default_unit: "g", shelf_life_days: 60 },

  // Meat
  { de: "Hähnchenbrust", en: "chicken breast", category: "meat", default_unit: "g", shelf_life_days: 3 },
  { de: "Rindfleisch", en: "beef", category: "meat", default_unit: "g", shelf_life_days: 3 },
  { de: "Hackfleisch", en: "ground meat", category: "meat", default_unit: "g", shelf_life_days: 2 },
  { de: "Schweinefleisch", en: "pork", category: "meat", default_unit: "g", shelf_life_days: 3 },
  { de: "Schinken", en: "ham", category: "meat", default_unit: "g", shelf_life_days: 7 },
  { de: "Speck", en: "bacon", category: "meat", default_unit: "g", shelf_life_days: 14 },
  { de: "Bratwurst", en: "bratwurst", category: "meat", default_unit: "piece", shelf_life_days: 5, typical_piece_weight_g: 120 },
  { de: "Cervelat", en: "cervelat", category: "meat", default_unit: "piece", shelf_life_days: 14, typical_piece_weight_g: 100 },
  { de: "Lammfleisch", en: "lamb", category: "meat", default_unit: "g", shelf_life_days: 3 },

  // Fish
  { de: "Lachs", en: "salmon", category: "fish", default_unit: "g", shelf_life_days: 2 },
  { de: "Thunfisch", en: "tuna", category: "fish", default_unit: "g", shelf_life_days: 2 },
  { de: "Forelle", en: "trout", category: "fish", default_unit: "piece", shelf_life_days: 2, typical_piece_weight_g: 300 },
  { de: "Garnelen", en: "shrimp", category: "fish", default_unit: "g", shelf_life_days: 2 },
  { de: "Hering", en: "herring", category: "fish", default_unit: "g", shelf_life_days: 3 },
  { de: "Kabeljau", en: "cod", category: "fish", default_unit: "g", shelf_life_days: 2 },

  // Bakery
  { de: "Brot", en: "bread", category: "bakery", default_unit: "piece", shelf_life_days: 5 },
  { de: "Toastbrot", en: "toast bread", category: "bakery", default_unit: "pack", shelf_life_days: 14 },
  { de: "Brötchen", en: "bread roll", category: "bakery", default_unit: "piece", shelf_life_days: 3, typical_piece_weight_g: 60 },
  { de: "Knäckebrot", en: "crispbread", category: "bakery", default_unit: "pack", shelf_life_days: 180 },
  { de: "Croissant", en: "croissant", category: "bakery", default_unit: "piece", shelf_life_days: 3, typical_piece_weight_g: 60 },
  { de: "Baguette", en: "baguette", category: "bakery", default_unit: "piece", shelf_life_days: 2, typical_piece_weight_g: 250 },

  // Dry goods
  { de: "Mehl", en: "flour", category: "dry_goods", default_unit: "g", shelf_life_days: 365 },
  { de: "Brotmehl", en: "bread flour", category: "dry_goods", default_unit: "g", shelf_life_days: 365 },
  { de: "Vollkornmehl", en: "whole wheat flour", category: "dry_goods", default_unit: "g", shelf_life_days: 180 },
  { de: "Reis", en: "rice", category: "dry_goods", default_unit: "g", shelf_life_days: 730 },
  { de: "Pasta", en: "pasta", category: "dry_goods", default_unit: "g", shelf_life_days: 730 },
  { de: "Spaghetti", en: "spaghetti", category: "dry_goods", default_unit: "g", shelf_life_days: 730 },
  { de: "Penne", en: "penne", category: "dry_goods", default_unit: "g", shelf_life_days: 730 },
  { de: "Couscous", en: "couscous", category: "dry_goods", default_unit: "g", shelf_life_days: 365 },
  { de: "Quinoa", en: "quinoa", category: "dry_goods", default_unit: "g", shelf_life_days: 730 },
  { de: "Bulgur", en: "bulgur", category: "dry_goods", default_unit: "g", shelf_life_days: 365 },
  { de: "Haferflocken", en: "rolled oats", category: "dry_goods", default_unit: "g", shelf_life_days: 365 },
  { de: "Linsen", en: "lentils", category: "dry_goods", default_unit: "g", shelf_life_days: 730 },
  { de: "Bohnen", en: "beans", category: "dry_goods", default_unit: "g", shelf_life_days: 730 },
  { de: "Kichererbsen", en: "chickpeas", category: "dry_goods", default_unit: "g", shelf_life_days: 730 },
  { de: "Polenta", en: "polenta", category: "dry_goods", default_unit: "g", shelf_life_days: 365 },
  { de: "Gnocchi", en: "gnocchi", category: "dry_goods", default_unit: "g", shelf_life_days: 30 },
  { de: "Spätzli", en: "spätzle", category: "dry_goods", default_unit: "g", shelf_life_days: 21 },
  { de: "Zucker", en: "sugar", category: "dry_goods", default_unit: "g", shelf_life_days: 3650 },
  { de: "Backpulver", en: "baking powder", category: "dry_goods", default_unit: "g", shelf_life_days: 540 },
  { de: "Hefe", en: "yeast", category: "dry_goods", default_unit: "g", shelf_life_days: 90 },

  // Spices
  { de: "Salz", en: "salt", category: "spices", default_unit: "g", shelf_life_days: 3650 },
  { de: "Pfeffer", en: "pepper", category: "spices", default_unit: "g", shelf_life_days: 1095 },
  { de: "Paprikapulver", en: "paprika powder", category: "spices", default_unit: "g", shelf_life_days: 730 },
  { de: "Currypulver", en: "curry powder", category: "spices", default_unit: "g", shelf_life_days: 730 },
  { de: "Zimt", en: "cinnamon", category: "spices", default_unit: "g", shelf_life_days: 1095 },
  { de: "Muskat", en: "nutmeg", category: "spices", default_unit: "g", shelf_life_days: 1095 },
  { de: "Kümmel", en: "caraway", category: "spices", default_unit: "g", shelf_life_days: 1095 },
  { de: "Thymian", en: "thyme", category: "spices", default_unit: "g", shelf_life_days: 730 },
  { de: "Rosmarin", en: "rosemary", category: "spices", default_unit: "g", shelf_life_days: 730 },
  { de: "Basilikum", en: "basil", category: "spices", default_unit: "g", shelf_life_days: 730 },
  { de: "Oregano", en: "oregano", category: "spices", default_unit: "g", shelf_life_days: 730 },
  { de: "Lorbeerblatt", en: "bay leaf", category: "spices", default_unit: "g", shelf_life_days: 1095 },
  { de: "Knoblauchpulver", en: "garlic powder", category: "spices", default_unit: "g", shelf_life_days: 1095 },
  { de: "Senfkörner", en: "mustard seeds", category: "spices", default_unit: "g", shelf_life_days: 1095 },
  { de: "Chili", en: "chili", category: "spices", default_unit: "g", shelf_life_days: 730 },
  { de: "Kreuzkümmel", en: "cumin", category: "spices", default_unit: "g", shelf_life_days: 1095 },

  // Beverages
  { de: "Wasser", en: "water", category: "beverages", default_unit: "ml", shelf_life_days: 365, density_g_per_ml: 1.0 },
  { de: "Mineralwasser", en: "mineral water", category: "beverages", default_unit: "ml", shelf_life_days: 365, density_g_per_ml: 1.0 },
  { de: "Apfelsaft", en: "apple juice", category: "beverages", default_unit: "ml", shelf_life_days: 180, density_g_per_ml: 1.04 },
  { de: "Orangensaft", en: "orange juice", category: "beverages", default_unit: "ml", shelf_life_days: 180, density_g_per_ml: 1.05 },
  { de: "Wein", en: "wine", category: "beverages", default_unit: "ml", shelf_life_days: 1095, density_g_per_ml: 0.99 },

  // Frozen
  { de: "Tiefkühlerbsen", en: "frozen peas", category: "frozen", default_unit: "g", shelf_life_days: 365 },
  { de: "Tiefkühlspinat", en: "frozen spinach", category: "frozen", default_unit: "g", shelf_life_days: 365 },
  { de: "Tiefkühlpommes", en: "frozen fries", category: "frozen", default_unit: "g", shelf_life_days: 365 },
  { de: "Tiefkühlpizza", en: "frozen pizza", category: "frozen", default_unit: "piece", shelf_life_days: 365, typical_piece_weight_g: 400 },
  { de: "Eis", en: "ice cream", category: "frozen", default_unit: "ml", shelf_life_days: 180, density_g_per_ml: 0.55 },

  // Condiments
  { de: "Olivenöl", en: "olive oil", category: "condiments", default_unit: "ml", shelf_life_days: 540, density_g_per_ml: 0.91 },
  { de: "Senf", en: "mustard", category: "condiments", default_unit: "g", shelf_life_days: 365 },
  { de: "Ketchup", en: "ketchup", category: "condiments", default_unit: "ml", shelf_life_days: 365, density_g_per_ml: 1.1 },
  { de: "Mayonnaise", en: "mayonnaise", category: "condiments", default_unit: "g", shelf_life_days: 180 },
  { de: "Essig", en: "vinegar", category: "condiments", default_unit: "ml", shelf_life_days: 1095, density_g_per_ml: 1.01 },
  { de: "Balsamico", en: "balsamic vinegar", category: "condiments", default_unit: "ml", shelf_life_days: 1095, density_g_per_ml: 1.12 },
  { de: "Honig", en: "honey", category: "condiments", default_unit: "g", shelf_life_days: 1825, density_g_per_ml: 1.42 },
  { de: "Marmelade", en: "jam", category: "condiments", default_unit: "g", shelf_life_days: 365 },
  { de: "Sojasauce", en: "soy sauce", category: "condiments", default_unit: "ml", shelf_life_days: 730, density_g_per_ml: 1.2 },
  { de: "Tabasco", en: "tabasco", category: "condiments", default_unit: "ml", shelf_life_days: 1825, density_g_per_ml: 1.0 },
  { de: "Tomatenmark", en: "tomato paste", category: "condiments", default_unit: "g", shelf_life_days: 365 },
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
  // Use the same normalization rules as SWISS_ALIASES keys: lowercase,
  // umlauts expanded, ALL other diacritics stripped via NFKD (so
  // Crème Fraîche → cremefraiche, Gruyère → gruyere), all whitespace
  // removed.
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "");
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
