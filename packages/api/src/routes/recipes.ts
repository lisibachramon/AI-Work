import type { FastifyInstance } from "fastify";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ProposedRecipes, RecipeFilters } from "@kitchen/shared/schemas";
import { convertUnit, type StorageUnit } from "@kitchen/shared/units";
import {
  consumptionEvents,
  ingredients,
  recipeIngredients,
  recipes,
  stockItems,
} from "@kitchen/db/schema";
import { requireAuth } from "./auth.js";
import { buildPantrySnapshot } from "../services/recipes/pantry-snapshot.js";

const SuggestBody = z.object({
  filters: RecipeFilters.optional(),
  count: z.number().int().positive().max(8).default(3),
  // Free-form steer from the user ("vegetarian today", "use up the spinach").
  prompt_hint: z.string().max(500).optional(),
});

const CookBody = z.object({
  servings: z.number().int().positive().max(20).optional(),
  // Map of recipe_ingredient.id → stock_item.id picks. Optional; the
  // server FIFOs by expiry_date when an explicit pick isn't provided.
  picks: z.record(z.string().uuid(), z.string().uuid()).optional(),
});

export async function registerRecipeRoutes(app: FastifyInstance) {
  app.post("/api/recipes/suggest", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const parsed = SuggestBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

    const snap = await buildPantrySnapshot(app.db, userId);
    if (snap.items.length === 0 && snap.essentials.length === 0) {
      return reply.code(400).send({ error: "pantry_empty" });
    }

    const filters = parsed.data.filters ?? {};
    // Resolve must_use UUIDs to canonical names so the LLM has something
    // meaningful to bias against. The IDs alone are opaque.
    let mustUseNames: string[] = [];
    if (filters.must_use?.length) {
      const rows = await app.db
        .select({ id: ingredients.id, name: ingredients.canonical_name_de })
        .from(ingredients)
        .where(
          and(
            eq(ingredients.user_id, userId),
            sql`${ingredients.id} = ANY(${filters.must_use}::uuid[])`,
          ),
        );
      mustUseNames = rows.map((r) => r.name);
    }
    const system = buildSystemPrompt();
    const prompt = buildUserPrompt(
      snap,
      filters,
      mustUseNames,
      parsed.data.prompt_hint,
      parsed.data.count,
    );

    try {
      const result = await app.llm.complete({
        task: "recipe_generation",
        system,
        prompt,
        schema: ProposedRecipes,
        temperature: 0.7,
        maxTokens: 4096,
      });

      // Validate ingredient_ids — Claude may hallucinate a UUID that doesn't
      // exist for this user. Build a set of valid ids, null out any
      // references the model invented to avoid FK failures.
      const proposedIds = new Set<string>();
      for (const r of result.value.recipes) {
        for (const ri of r.ingredients) {
          if (ri.ingredient_id) proposedIds.add(ri.ingredient_id);
        }
      }
      const validIds = new Set<string>();
      if (proposedIds.size > 0) {
        const validRows = await app.db
          .select({ id: ingredients.id })
          .from(ingredients)
          .where(
            and(
              eq(ingredients.user_id, userId),
              sql`${ingredients.id} = ANY(${Array.from(proposedIds)}::uuid[])`,
            ),
          );
        for (const row of validRows) validIds.add(row.id);
      }

      const persisted = await Promise.all(
        result.value.recipes.map(async (r) => {
          const [row] = await app.db
            .insert(recipes)
            .values({
              user_id: userId,
              title: r.title,
              summary: r.summary,
              instructions_md: r.instructions_md,
              effort: r.effort,
              time_minutes: r.time_minutes,
              healthiness: r.healthiness,
              cuisine: r.cuisine,
              servings: r.servings,
              source: "ai",
            })
            .returning();
          if (!row) return null;
          if (r.ingredients.length > 0) {
            await app.db.insert(recipeIngredients).values(
              r.ingredients.map((ri) => ({
                recipe_id: row.id,
                ingredient_id:
                  ri.ingredient_id && validIds.has(ri.ingredient_id)
                    ? ri.ingredient_id
                    : null,
                raw_text: ri.raw_text,
                quantity: ri.quantity?.toString(),
                unit: ri.unit,
                optional: ri.optional,
                note: ri.note ?? undefined,
              })),
            );
          }
          return {
            id: row.id,
            title: r.title,
            summary: r.summary,
            effort: r.effort,
            time_minutes: r.time_minutes,
            healthiness: r.healthiness,
            servings: r.servings,
            pantry_coverage: r.pantry_coverage,
            missing_ingredients: r.missing_ingredients ?? [],
          };
        }),
      );
      return { recipes: persisted.filter((r): r is NonNullable<typeof r> => r !== null) };
    } catch (err) {
      app.log.error({ err }, "recipe suggest failed");
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: "llm_failed", message: msg });
    }
  });

  app.get("/api/recipes", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    return app.db
      .select({
        id: recipes.id,
        title: recipes.title,
        summary: recipes.summary,
        effort: recipes.effort,
        time_minutes: recipes.time_minutes,
        healthiness: recipes.healthiness,
        servings: recipes.servings,
        cuisine: recipes.cuisine,
        times_cooked: recipes.times_cooked,
        last_cooked_at: recipes.last_cooked_at,
        rating: recipes.rating,
        source: recipes.source,
        created_at: recipes.created_at,
      })
      .from(recipes)
      .where(eq(recipes.user_id, userId))
      .orderBy(sql`${recipes.created_at} DESC`)
      .limit(50);
  });

  app.get("/api/recipes/:id", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const { id } = req.params as { id: string };
    const [recipe] = await app.db
      .select()
      .from(recipes)
      .where(and(eq(recipes.id, id), eq(recipes.user_id, userId)))
      .limit(1);
    if (!recipe) return reply.code(404).send({ error: "not_found" });
    const ris = await app.db
      .select({
        id: recipeIngredients.id,
        ingredient_id: recipeIngredients.ingredient_id,
        raw_text: recipeIngredients.raw_text,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
        optional: recipeIngredients.optional,
        note: recipeIngredients.note,
        ingredient_name: ingredients.canonical_name_de,
        density_g_per_ml: ingredients.density_g_per_ml,
        typical_piece_weight_g: ingredients.typical_piece_weight_g,
      })
      .from(recipeIngredients)
      .leftJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredient_id))
      .where(eq(recipeIngredients.recipe_id, id));
    return { ...recipe, ingredients: ris };
  });

  app.patch("/api/recipes/:id", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const { id } = req.params as { id: string };
    const Body = z.object({
      rating: z.number().int().min(1).max(5).nullable().optional(),
      title: z.string().min(1).max(200).optional(),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const update: Record<string, unknown> = {};
    if (parsed.data.rating !== undefined) update.rating = parsed.data.rating;
    if (parsed.data.title !== undefined) update.title = parsed.data.title;
    if (Object.keys(update).length === 0) return reply.code(400).send({ error: "no_fields" });
    const [row] = await app.db
      .update(recipes)
      .set(update)
      .where(and(eq(recipes.id, id), eq(recipes.user_id, userId)))
      .returning();
    if (!row) return reply.code(404).send({ error: "not_found" });
    return row;
  });

  app.delete("/api/recipes/:id", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const { id } = req.params as { id: string };
    const [row] = await app.db
      .delete(recipes)
      .where(and(eq(recipes.id, id), eq(recipes.user_id, userId)))
      .returning({ id: recipes.id });
    if (!row) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  app.post("/api/recipes/:id/cook", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const { id } = req.params as { id: string };
    const parsed = CookBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

    const [recipe] = await app.db
      .select()
      .from(recipes)
      .where(and(eq(recipes.id, id), eq(recipes.user_id, userId)))
      .limit(1);
    if (!recipe) return reply.code(404).send({ error: "not_found" });

    const ris = await app.db
      .select({
        id: recipeIngredients.id,
        ingredient_id: recipeIngredients.ingredient_id,
        ingredient_name: ingredients.canonical_name_de,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
        optional: recipeIngredients.optional,
        density_g_per_ml: ingredients.density_g_per_ml,
        typical_piece_weight_g: ingredients.typical_piece_weight_g,
      })
      .from(recipeIngredients)
      .leftJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredient_id))
      .where(eq(recipeIngredients.recipe_id, id));

    const scale =
      parsed.data.servings && recipe.servings > 0
        ? parsed.data.servings / recipe.servings
        : 1;

    type Decrement = {
      stock_item_id: string;
      ingredient_id: string;
      ingredient_name: string;
      amount_consumed: number;
      stock_unit: StorageUnit;
    };
    type Missing = {
      ingredient_name: string;
      needed: number;
      unit: string;
      optional: boolean;
    };
    const decrements: Decrement[] = [];
    const missing: Missing[] = [];

    // Snapshot live FIFO stock per ingredient inside the loop so multiple
    // recipe lines using the same ingredient don't double-consume.
    const stockCache = new Map<string, Array<typeof stockItemRow>>();
    let stockItemRow!: {
      id: string;
      quantity: string;
      unit: StorageUnit;
      expiry_date: string | null;
    };

    for (const ri of ris) {
      if (!ri.ingredient_id || ri.quantity == null || !ri.unit) {
        if (!ri.optional) {
          missing.push({
            ingredient_name: ri.ingredient_name ?? "?",
            needed: Number(ri.quantity ?? 0),
            unit: ri.unit ?? "?",
            optional: ri.optional,
          });
        }
        continue;
      }

      const needed = Number(ri.quantity) * scale;
      // Defensive: Zod's schema lets quantity be 0 or negative (Claude
      // sometimes emits 0 for "to taste"). Skip those rather than letting
      // them propagate as NaN/-inf through the decrement loop.
      if (!Number.isFinite(needed) || needed <= 0) continue;
      const recipeUnit = ri.unit as StorageUnit;
      const conv = {
        density_g_per_ml: ri.density_g_per_ml === null ? null : Number(ri.density_g_per_ml),
        typical_piece_weight_g:
          ri.typical_piece_weight_g === null ? null : Number(ri.typical_piece_weight_g),
      };

      let remaining = needed;

      let stocks = stockCache.get(ri.ingredient_id);
      if (!stocks) {
        const rows = await app.db
          .select({
            id: stockItems.id,
            quantity: stockItems.quantity,
            unit: stockItems.unit,
            expiry_date: stockItems.expiry_date,
          })
          .from(stockItems)
          .where(
            and(
              eq(stockItems.user_id, userId),
              eq(stockItems.ingredient_id, ri.ingredient_id),
              isNull(stockItems.deleted_at),
            ),
          )
          .orderBy(sql`${stockItems.expiry_date} ASC NULLS LAST`, asc(stockItems.created_at));
        stocks = rows;
        stockCache.set(ri.ingredient_id, stocks);
      }

      // Apply explicit pick first if provided.
      const pickedId = parsed.data.picks?.[ri.id];
      if (pickedId) {
        const idx = stocks.findIndex((s) => s.id === pickedId);
        if (idx > 0) {
          const [picked] = stocks.splice(idx, 1);
          if (picked) stocks.unshift(picked);
        }
      }

      for (const s of stocks) {
        if (remaining <= 0) break;
        const stockUnit = s.unit as StorageUnit;
        const stockQty = Number(s.quantity);
        // Convert what we need (in recipe units) into stock units.
        const neededInStockUnit = convertUnit(remaining, recipeUnit, stockUnit, conv);
        if (neededInStockUnit === null) continue; // unconvertible — try next item
        const consumed = Math.min(neededInStockUnit, stockQty);
        const consumedInRecipeUnit = convertUnit(consumed, stockUnit, recipeUnit, conv);
        if (consumedInRecipeUnit === null) continue;
        decrements.push({
          stock_item_id: s.id,
          ingredient_id: ri.ingredient_id,
          ingredient_name: ri.ingredient_name ?? "?",
          amount_consumed: consumed,
          stock_unit: stockUnit,
        });
        s.quantity = (stockQty - consumed).toString();
        remaining -= consumedInRecipeUnit;
      }

      if (remaining > 0.001 && !ri.optional) {
        missing.push({
          ingredient_name: ri.ingredient_name ?? "?",
          needed: remaining,
          unit: recipeUnit,
          optional: ri.optional,
        });
      }
    }

    // Apply decrements in a single transaction.
    await app.db.transaction(async (tx) => {
      for (const d of decrements) {
        const [row] = await tx
          .select({ qty: stockItems.quantity })
          .from(stockItems)
          .where(eq(stockItems.id, d.stock_item_id))
          .limit(1);
        if (!row) continue;
        const newQty = Number(row.qty) - d.amount_consumed;
        if (newQty <= 0.0005) {
          await tx
            .update(stockItems)
            .set({ quantity: "0", deleted_at: new Date() })
            .where(eq(stockItems.id, d.stock_item_id));
        } else {
          await tx
            .update(stockItems)
            .set({ quantity: newQty.toString() })
            .where(eq(stockItems.id, d.stock_item_id));
        }
        await tx.insert(consumptionEvents).values({
          user_id: userId,
          stock_item_id: d.stock_item_id,
          ingredient_id: d.ingredient_id,
          quantity_consumed: d.amount_consumed.toString(),
          unit: d.stock_unit,
          reason: "cooked",
          recipe_id: id,
        });
      }
      await tx
        .update(recipes)
        .set({
          times_cooked: sql`${recipes.times_cooked} + 1`,
          last_cooked_at: new Date(),
        })
        .where(eq(recipes.id, id));
    });

    return {
      cooked: true,
      decremented: decrements.length,
      missing,
    };
  });
}

function buildSystemPrompt(): string {
  return `Du bist ein erfahrener Schweizer Koch und planst Rezepte aus dem, was bereits in der Küche vorhanden ist.

Regeln:
- Sprich Hochdeutsch (CH), aber benutze gängige Schweizer Begriffe (Peterli, Rüebli, Pouletbrust) wenn passend.
- Verwende vorrangig Zutaten, die der Nutzer schon hat. Mindestens 80% der nicht-essential Zutaten müssen aus dem Vorrat kommen.
- Markiere fehlende Zutaten klar in missing_ingredients.
- Berücksichtige must_use_priority: high zwingend einbauen, medium bevorzugt, low optional.
- Ehrliche Zeitangaben in time_minutes (Vorbereitung + Kochen).
- effort: "quick" < 25 Min, "medium" 25-60 Min, "involved" > 60 Min.
- healthiness: light/balanced/hearty/indulgent, deinem Urteil nach.
- pantry_coverage als Anteil 0.0-1.0 der Hauptzutaten, die aus dem Vorrat kommen.
- ingredient_id NUR setzen, wenn die Zutat im Vorrat steht — übernimm die UUID exakt aus der Liste. Sonst null.
- Mengen realistisch und passend zur servings.
- Instructions als Markdown mit nummerierter Schrittliste.
`;
}

function buildUserPrompt(
  snap: Awaited<ReturnType<typeof buildPantrySnapshot>>,
  filters: z.infer<typeof RecipeFilters>,
  mustUseNames: string[],
  hint: string | undefined,
  count: number,
): string {
  const lines: string[] = [];
  lines.push(`# Vorrat (${snap.items.length} Positionen)`);
  for (const it of snap.items) {
    const exp =
      it.expires_in_days === null
        ? ""
        : ` — läuft in ${it.expires_in_days}d ab${it.must_use_priority !== "low" ? ` (${it.must_use_priority})` : ""}`;
    lines.push(
      `- [${it.ingredient_id}] ${it.name_de} — ${it.quantity} ${it.unit} im ${it.location}${exp}`,
    );
  }
  if (snap.essentials.length > 0) {
    lines.push("");
    lines.push(`# Immer vorhanden (essentials): ${snap.essentials.join(", ")}`);
  }
  if (snap.low_essentials.length > 0) {
    lines.push(`# Knapp: ${snap.low_essentials.join(", ")}`);
  }

  lines.push("");
  lines.push("# Filter");
  if (filters.max_minutes) lines.push(`- max ${filters.max_minutes} Min`);
  if (filters.effort) lines.push(`- effort: ${filters.effort}`);
  if (filters.healthiness) lines.push(`- healthiness: ${filters.healthiness}`);
  if (filters.cuisine?.length) lines.push(`- cuisine: ${filters.cuisine.join(", ")}`);
  if (filters.servings) lines.push(`- servings: ${filters.servings}`);
  if (mustUseNames.length > 0) {
    lines.push(`- must_use (zwingend einbauen): ${mustUseNames.join(", ")}`);
  }
  if (filters.avoid?.length) lines.push(`- avoid: ${filters.avoid.join(", ")}`);
  if (filters.leftover_friendly) lines.push(`- gut als Resteverwertung`);
  if (hint) {
    lines.push("");
    lines.push(`# Hinweis vom Nutzer`);
    lines.push(hint);
  }
  lines.push("");
  lines.push(`Schlage ${count} sinnvolle Rezepte vor.`);
  return lines.join("\n");
}
