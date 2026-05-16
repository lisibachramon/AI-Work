<script lang="ts">
  import { onMount } from "svelte";
  import { api, ApiError } from "$lib/api.ts";
  import IngredientSearch from "$lib/IngredientSearch.svelte";

  type ShoppingItem = {
    ingredient_id: string;
    name_de: string;
    reasons: string[];
  };

  type Essential = {
    id: string;
    ingredient_id: string;
    ingredient_name: string;
    present: boolean;
    low: boolean;
    updated_at: string;
  };

  let items = $state<ShoppingItem[]>([]);
  let essentialsList = $state<Essential[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  onMount(load);

  async function load() {
    loading = true;
    error = null;
    try {
      const [s, e] = await Promise.all([
        api.get<{ items: ShoppingItem[] }>("/api/shopping-list"),
        api.get<Essential[]>("/api/essentials"),
      ]);
      items = s.items;
      essentialsList = e;
    } catch (err) {
      error = err instanceof ApiError ? err.message : "Failed to load.";
    } finally {
      loading = false;
    }
  }

  function reasonLabel(r: string): string {
    switch (r) {
      case "low_essential":
        return "essential — low";
      case "consumed_recently":
        return "consumed, no stock";
      case "recipe_gap":
        return "needed by recent recipe";
      default:
        return r;
    }
  }

  async function toggleLow(es: Essential) {
    try {
      await api.post("/api/essentials", {
        ingredient_id: es.ingredient_id,
        present: es.present,
        low: !es.low,
      });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Update failed.");
    }
  }

  async function removeEssential(es: Essential) {
    if (!confirm(`Remove "${es.ingredient_name}" from essentials?`)) return;
    try {
      await api.delete(`/api/essentials/${es.ingredient_id}`);
      essentialsList = essentialsList.filter((x) => x.id !== es.id);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Delete failed.");
    }
  }

  let addingEssential = $state(false);

  async function addEssential(m: { id: string; name: string } | null) {
    if (!m) return;
    try {
      await api.post("/api/essentials", {
        ingredient_id: m.id,
        present: true,
        low: false,
      });
      addingEssential = false;
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Add failed.");
    }
  }
</script>

<h1>Shopping</h1>

{#if loading}
  <p class="muted">Loading…</p>
{:else if error}
  <p class="err">{error}</p>
{:else}
  <section>
    <h2>Things to buy</h2>
    {#if items.length === 0}
      <p class="muted">Nothing flagged. Either your pantry is sound or you haven't told the app what counts as essential.</p>
    {:else}
      <ul class="list">
        {#each items as it (it.ingredient_id)}
          <li>
            <span class="name">{it.name_de}</span>
            <span class="reasons">{it.reasons.map(reasonLabel).join(" · ")}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section>
    <div class="header2">
      <h2>Essentials</h2>
      <button class="add" onclick={() => (addingEssential = !addingEssential)}>
        {addingEssential ? "Cancel" : "+ Add"}
      </button>
    </div>
    {#if addingEssential}
      <div class="search-wrap">
        <IngredientSearch onpick={addEssential} placeholder="Find an ingredient to mark essential…" />
      </div>
    {/if}
    {#if essentialsList.length === 0 && !addingEssential}
      <p class="muted">No essentials yet. Mark things you always want on hand — salt, oil, flour — and the shopping list will warn when they run low.</p>
    {:else if essentialsList.length > 0}
      <ul class="list">
        {#each essentialsList as es (es.id)}
          <li>
            <span class="name">{es.ingredient_name}</span>
            <div class="actions">
              <label class="toggle">
                <input type="checkbox" checked={es.low} onchange={() => toggleLow(es)} />
                low
              </label>
              <button class="del" onclick={() => removeEssential(es)} aria-label="Remove">×</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  h1 {
    margin: 0 0 1rem;
  }
  h2 {
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #888;
    margin: 0 0 0.5rem;
  }
  section {
    margin-bottom: 2rem;
  }
  .header2 {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .add {
    background: #222;
    color: #ccc;
    border: 0;
    border-radius: 6px;
    padding: 0.3rem 0.7rem;
    font: inherit;
    font-size: 0.85rem;
  }
  .search-wrap {
    margin: 0.6rem 0;
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    background: #111;
    border-radius: 8px;
  }
  .list li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid #1d1d1d;
    gap: 0.6rem;
  }
  .list li:last-child {
    border-bottom: 0;
  }
  .name {
    font-weight: 500;
  }
  .reasons {
    font-size: 0.8rem;
    color: #888;
    text-align: right;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .toggle {
    color: #aaa;
    font-size: 0.85rem;
    display: flex;
    gap: 0.3rem;
    align-items: center;
  }
  .del {
    background: transparent;
    border: 0;
    color: #555;
    font-size: 1.3rem;
    padding: 0.2rem 0.5rem;
    line-height: 1;
    border-radius: 4px;
  }
  .del:hover {
    color: #ff6b6b;
    background: #2a0c0c;
  }
  .muted {
    color: #888;
  }
  .err {
    color: #ff6b6b;
  }
</style>
