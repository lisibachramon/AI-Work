<script lang="ts">
  import { onMount } from "svelte";
  import { api, ApiError } from "$lib/api.ts";

  type RecipeSummary = {
    id: string;
    title: string;
    summary: string | null;
    effort: "quick" | "medium" | "involved";
    time_minutes: number;
    healthiness: "light" | "balanced" | "hearty" | "indulgent";
    servings: number;
    cuisine: string | null;
    times_cooked: number;
    last_cooked_at: string | null;
    rating: number | null;
    source: "ai" | "user" | "imported";
    created_at: string;
  };

  let recipes = $state<RecipeSummary[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Suggest panel
  let suggestOpen = $state(false);
  let suggestBusy = $state(false);
  let suggestError = $state<string | null>(null);
  let filters = $state({
    max_minutes: "" as string,
    effort: "" as "" | "quick" | "medium" | "involved",
    healthiness: "" as "" | "light" | "balanced" | "hearty" | "indulgent",
    servings: 2,
    prompt_hint: "",
    count: 3,
  });

  onMount(load);

  async function load() {
    loading = true;
    error = null;
    try {
      recipes = await api.get<RecipeSummary[]>("/api/recipes");
    } catch (err) {
      error = err instanceof ApiError ? err.message : "Failed to load.";
    } finally {
      loading = false;
    }
  }

  async function suggest(e: Event) {
    e.preventDefault();
    if (suggestBusy) return;
    suggestBusy = true;
    suggestError = null;
    try {
      const body: Record<string, unknown> = { count: filters.count };
      const f: Record<string, unknown> = {};
      if (filters.max_minutes) f.max_minutes = parseInt(filters.max_minutes, 10);
      if (filters.effort) f.effort = filters.effort;
      if (filters.healthiness) f.healthiness = filters.healthiness;
      if (filters.servings) f.servings = filters.servings;
      if (Object.keys(f).length > 0) body.filters = f;
      if (filters.prompt_hint.trim()) body.prompt_hint = filters.prompt_hint.trim();

      await api.post<{ recipes: unknown[] }>("/api/recipes/suggest", body);
      suggestOpen = false;
      await load();
    } catch (err) {
      suggestError =
        err instanceof ApiError
          ? err.message === "pantry_empty"
            ? "Add some stock first."
            : err.message === "llm_failed"
              ? "LLM call failed — check ANTHROPIC/OAUTH config on the server."
              : err.message
          : "Suggest failed.";
    } finally {
      suggestBusy = false;
    }
  }
</script>

<div class="header">
  <h1>Cook</h1>
  <button class="primary" onclick={() => (suggestOpen = !suggestOpen)}>
    {suggestOpen ? "Cancel" : "Suggest"}
  </button>
</div>

{#if suggestOpen}
  <form class="suggest" onsubmit={suggest}>
    <div class="row">
      <label class="grow">
        Max minutes
        <input
          type="number"
          min="5"
          max="180"
          bind:value={filters.max_minutes}
          placeholder="any"
        />
      </label>
      <label>
        Effort
        <select bind:value={filters.effort}>
          <option value="">any</option>
          <option value="quick">quick</option>
          <option value="medium">medium</option>
          <option value="involved">involved</option>
        </select>
      </label>
      <label>
        Servings
        <input type="number" min="1" max="20" bind:value={filters.servings} />
      </label>
    </div>
    <div class="row">
      <label class="grow">
        Healthiness
        <select bind:value={filters.healthiness}>
          <option value="">any</option>
          <option value="light">light</option>
          <option value="balanced">balanced</option>
          <option value="hearty">hearty</option>
          <option value="indulgent">indulgent</option>
        </select>
      </label>
      <label>
        How many?
        <input type="number" min="1" max="8" bind:value={filters.count} />
      </label>
    </div>
    <label>
      Steer (optional)
      <input
        type="text"
        bind:value={filters.prompt_hint}
        placeholder="vegetarian, mediterranean, use the spinach…"
      />
    </label>
    {#if suggestError}
      <p class="err">{suggestError}</p>
    {/if}
    <button type="submit" class="primary" disabled={suggestBusy}>
      {suggestBusy ? "Asking Claude…" : "Generate"}
    </button>
  </form>
{/if}

{#if loading}
  <p class="muted">Loading…</p>
{:else if error}
  <p class="err">{error}</p>
{:else if recipes.length === 0}
  <p class="muted">No recipes yet. Tap Suggest above to ask Claude.</p>
{:else}
  <ul class="recipes">
    {#each recipes as r (r.id)}
      <li>
        <a href={`/cook/${r.id}/`} class="card">
          <div class="row1">
            <span class="title">{r.title}</span>
            <span class="badge {r.effort}">{r.effort}</span>
          </div>
          <p class="summary">{r.summary ?? ""}</p>
          <div class="meta">
            <span>{r.time_minutes} min</span>
            <span>·</span>
            <span>{r.healthiness}</span>
            <span>·</span>
            <span>{r.servings} servings</span>
            {#if r.times_cooked > 0}
              <span>·</span>
              <span class="cooked">cooked {r.times_cooked}×</span>
            {/if}
            {#if r.rating}
              <span>·</span>
              <span class="rating">{"★".repeat(r.rating)}</span>
            {/if}
          </div>
        </a>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }
  h1 {
    margin: 0;
  }
  .primary {
    background: #4a90e2;
    color: white;
    border: 0;
    border-radius: 6px;
    padding: 0.5rem 0.9rem;
    font: inherit;
  }
  .primary:disabled {
    opacity: 0.5;
  }
  .suggest {
    background: #111;
    border-radius: 8px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    margin-bottom: 1.5rem;
  }
  .suggest .row {
    display: flex;
    gap: 0.6rem;
  }
  .suggest .grow {
    flex: 1;
  }
  .suggest label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    color: #aaa;
    font-size: 0.85rem;
    flex: 1;
  }
  .suggest input,
  .suggest select {
    background: #0a0a0a;
    border: 1px solid #2a2a2a;
    color: #f5f5f5;
    border-radius: 6px;
    padding: 0.5rem 0.6rem;
    font: inherit;
  }
  .recipes {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .card {
    display: block;
    background: #111;
    border-radius: 8px;
    padding: 0.8rem 1rem;
    text-decoration: none;
    color: inherit;
  }
  .card:hover {
    background: #161616;
  }
  .row1 {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }
  .title {
    font-weight: 500;
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
  .summary {
    margin: 0.3rem 0;
    color: #aaa;
    font-size: 0.9rem;
    line-height: 1.4;
  }
  .meta {
    display: flex;
    gap: 0.4rem;
    font-size: 0.8rem;
    color: #777;
  }
  .cooked {
    color: #6ec38a;
  }
  .rating {
    color: #f0c674;
    letter-spacing: 0.1em;
  }
  .muted {
    color: #888;
    text-align: center;
    padding: 2rem 0;
  }
  .err {
    color: #ff6b6b;
    margin: 0;
  }
</style>
