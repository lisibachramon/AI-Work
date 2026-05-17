<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { api, ApiError } from "$lib/api.ts";

  type RecipeIngredient = {
    id: string;
    ingredient_id: string | null;
    ingredient_name: string | null;
    raw_text: string;
    quantity: string | null;
    unit: string | null;
    optional: boolean;
    note: string | null;
  };

  type Recipe = {
    id: string;
    title: string;
    summary: string | null;
    instructions_md: string;
    effort: "quick" | "medium" | "involved";
    time_minutes: number;
    healthiness: "light" | "balanced" | "hearty" | "indulgent";
    cuisine: string | null;
    servings: number;
    times_cooked: number;
    last_cooked_at: string | null;
    rating: number | null;
    ingredients: RecipeIngredient[];
  };

  let recipe = $state<Recipe | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let cookBusy = $state(false);
  let cookResult = $state<{ decremented: number; missing: Array<{ ingredient_name: string }> } | null>(null);
  let servings = $state<number | null>(null);

  const id = $derived(page.params.id);

  onMount(load);

  async function load() {
    loading = true;
    error = null;
    try {
      recipe = await api.get<Recipe>(`/api/recipes/${id}`);
      servings = recipe.servings;
    } catch (err) {
      error = err instanceof ApiError ? err.message : "Failed to load.";
    } finally {
      loading = false;
    }
  }

  async function cook() {
    if (!recipe || cookBusy) return;
    cookBusy = true;
    try {
      const body: Record<string, unknown> = {};
      if (servings && servings !== recipe.servings) body.servings = servings;
      cookResult = await api.post(`/api/recipes/${id}/cook`, body);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Cook failed.");
    } finally {
      cookBusy = false;
    }
  }

  async function setRating(value: number | null) {
    if (!recipe) return;
    const prior = recipe.rating;
    recipe = { ...recipe, rating: value };
    try {
      await api.patch(`/api/recipes/${id}`, { rating: value });
    } catch (err) {
      // Revert the optimistic update.
      recipe = recipe ? { ...recipe, rating: prior } : recipe;
      alert(err instanceof ApiError ? err.message : "Rating failed.");
    }
  }

  async function deleteRecipe() {
    if (!recipe) return;
    if (!confirm(`Delete "${recipe.title}"?`)) return;
    try {
      await api.delete(`/api/recipes/${id}`);
      goto("/cook/", { replaceState: true });
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Delete failed.");
    }
  }
</script>

<a href="/cook/" class="back">← All recipes</a>

{#if loading}
  <p class="muted">Loading…</p>
{:else if error}
  <p class="err">{error}</p>
{:else if recipe}
  <h1>{recipe.title}</h1>
  {#if recipe.summary}
    <p class="summary">{recipe.summary}</p>
  {/if}
  <div class="meta">
    <span class="badge {recipe.effort}">{recipe.effort}</span>
    <span>{recipe.time_minutes} min</span>
    <span>·</span>
    <span>{recipe.healthiness}</span>
    {#if recipe.cuisine}<span>·</span><span>{recipe.cuisine}</span>{/if}
    {#if recipe.times_cooked > 0}<span>·</span><span class="cooked">cooked {recipe.times_cooked}×</span>{/if}
  </div>

  <div class="rating-row">
    <div class="stars" role="radiogroup" aria-label="Rating">
      {#each [1, 2, 3, 4, 5] as n (n)}
        <button
          type="button"
          class="star"
          class:on={(recipe.rating ?? 0) >= n}
          onclick={() => setRating((recipe?.rating ?? 0) === n ? null : n)}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
        >★</button>
      {/each}
    </div>
    <button class="delete-recipe" onclick={deleteRecipe}>Delete recipe</button>
  </div>

  <section>
    <h2>Ingredients ({recipe.servings} servings)</h2>
    <ul>
      {#each recipe.ingredients as ri (ri.id)}
        <li class:optional={ri.optional}>
          {ri.raw_text}
          {#if ri.optional}<span class="opt">optional</span>{/if}
          {#if !ri.ingredient_id}<span class="unlinked">unlinked</span>{/if}
        </li>
      {/each}
    </ul>
  </section>

  <section>
    <h2>Instructions</h2>
    <div class="instructions">{recipe.instructions_md}</div>
  </section>

  <section class="cook-bar">
    <label>
      Servings
      <input type="number" min="1" max="20" bind:value={servings} />
    </label>
    <button onclick={cook} class="primary" disabled={cookBusy}>
      {cookBusy ? "Cooking…" : "Cooked it — decrement pantry"}
    </button>
  </section>

  {#if cookResult}
    <div class="result">
      <p>✓ {cookResult.decremented} items decremented.</p>
      {#if cookResult.missing.length > 0}
        <p class="warn">
          Was short on: {cookResult.missing.map((m) => m.ingredient_name).join(", ")} — you may have added them off-pantry.
        </p>
      {/if}
    </div>
  {/if}
{/if}

<style>
  .back {
    color: #888;
    text-decoration: none;
    font-size: 0.9rem;
  }
  h1 {
    margin: 0.5rem 0 0.5rem;
  }
  .summary {
    color: #ccc;
    line-height: 1.5;
  }
  .meta {
    display: flex;
    gap: 0.4rem;
    font-size: 0.85rem;
    color: #888;
    flex-wrap: wrap;
    margin-bottom: 1.5rem;
  }
  .badge {
    font-size: 0.7rem;
    padding: 0.1rem 0.45rem;
    border-radius: 4px;
    background: #1a1a1a;
    color: #aaa;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .badge.quick {
    background: #1a3a2a;
    color: #6ec38a;
  }
  .badge.involved {
    background: #3a1a2a;
    color: #d77ea8;
  }
  .cooked {
    color: #6ec38a;
  }
  .rating-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
    padding: 0.6rem 0.9rem;
    background: #111;
    border-radius: 8px;
  }
  .stars {
    display: flex;
    gap: 0.15rem;
  }
  .star {
    background: transparent;
    border: 0;
    color: #444;
    font-size: 1.5rem;
    padding: 0.1rem 0.2rem;
    cursor: pointer;
    line-height: 1;
  }
  .star.on {
    color: #f0c674;
  }
  .delete-recipe {
    background: transparent;
    border: 1px solid #2a2a2a;
    color: #888;
    padding: 0.4rem 0.7rem;
    border-radius: 6px;
    font: inherit;
    font-size: 0.85rem;
  }
  .delete-recipe:hover {
    border-color: #663030;
    color: #ff6b6b;
  }
  section {
    margin-bottom: 1.5rem;
  }
  h2 {
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #888;
    margin: 0 0 0.5rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    background: #111;
    border-radius: 8px;
    overflow: hidden;
  }
  li {
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid #1d1d1d;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  li:last-child {
    border-bottom: 0;
  }
  li.optional {
    color: #888;
  }
  .opt,
  .unlinked {
    font-size: 0.7rem;
    color: #777;
    padding: 0.05rem 0.4rem;
    border-radius: 4px;
    background: #1a1a1a;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .unlinked {
    color: #d77ea8;
    background: #2a1018;
  }
  .instructions {
    background: #111;
    border-radius: 8px;
    padding: 1rem;
    white-space: pre-wrap;
    line-height: 1.5;
    color: #ddd;
  }
  .cook-bar {
    display: flex;
    align-items: end;
    gap: 0.8rem;
    background: #111;
    padding: 1rem;
    border-radius: 8px;
  }
  .cook-bar label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    color: #aaa;
    font-size: 0.85rem;
  }
  .cook-bar input {
    background: #0a0a0a;
    border: 1px solid #2a2a2a;
    color: #f5f5f5;
    border-radius: 6px;
    padding: 0.5rem 0.6rem;
    font: inherit;
    width: 5rem;
  }
  .primary {
    background: #4a90e2;
    color: white;
    border: 0;
    border-radius: 6px;
    padding: 0.6rem 1rem;
    font: inherit;
    flex: 1;
  }
  .primary:disabled {
    opacity: 0.5;
  }
  .result {
    background: #1a2a18;
    color: #c8e7c0;
    border-radius: 8px;
    padding: 0.8rem 1rem;
    margin-top: 1rem;
  }
  .result p {
    margin: 0.2rem 0;
  }
  .warn {
    color: #f0c674;
  }
  .muted {
    color: #888;
    text-align: center;
    padding: 2rem 0;
  }
  .err {
    color: #ff6b6b;
  }
</style>
