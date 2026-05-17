<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { api, ApiError } from "$lib/api.ts";
  import IngredientSearch from "$lib/IngredientSearch.svelte";

  type CatalogEntry = {
    id: string;
    canonical_name_de: string;
    canonical_name_en: string | null;
    category: string;
    default_unit: string;
    shelf_life_days: number | null;
  };

  const CATEGORIES = [
    { value: "all", label: "All" },
    { value: "produce", label: "Produce" },
    { value: "dairy", label: "Dairy" },
    { value: "meat", label: "Meat" },
    { value: "fish", label: "Fish" },
    { value: "bakery", label: "Bakery" },
    { value: "dry_goods", label: "Dry goods" },
    { value: "spices", label: "Spices" },
    { value: "beverages", label: "Beverages" },
    { value: "frozen", label: "Frozen" },
    { value: "condiments", label: "Condiments" },
    { value: "other", label: "Other" },
  ];

  let items = $state<CatalogEntry[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let category = $state<string>("all");

  const filtered = $derived(
    category === "all" ? items : items.filter((it) => it.category === category),
  );

  const grouped = $derived(
    filtered.reduce<Record<string, CatalogEntry[]>>((acc, it) => {
      (acc[it.category] ??= []).push(it);
      return acc;
    }, {}),
  );

  onMount(load);

  async function load() {
    loading = true;
    error = null;
    try {
      items = await api.get<CatalogEntry[]>("/api/ingredients?limit=500");
    } catch (err) {
      error = err instanceof ApiError ? err.message : "Failed to load.";
    } finally {
      loading = false;
    }
  }

  function add(id: string, name: string) {
    goto(
      `/inventory/add/?ingredient_id=${encodeURIComponent(id)}&ingredient_name=${encodeURIComponent(name)}`,
    );
  }

  function pick(m: { id: string; name: string } | null) {
    if (!m) return;
    add(m.id, m.name);
  }
</script>

<h1>Catalog</h1>
<p class="lead">
  {items.length} ingredients in your catalogue. Search to add directly, or
  browse below by category. Don't see what you want? Type it into the search
  and use "+ Create" to add it.
</p>

<div class="search">
  <IngredientSearch onpick={pick} placeholder="z.B. Spinat, Käse, Couscous…" />
</div>

<div class="filters">
  {#each CATEGORIES as c (c.value)}
    <button
      class="cat"
      class:active={category === c.value}
      onclick={() => (category = c.value)}
    >{c.label}</button>
  {/each}
</div>

{#if loading}
  <p class="muted">Loading…</p>
{:else if error}
  <p class="err">{error}</p>
{:else if filtered.length === 0}
  <p class="muted">Nothing in this category yet.</p>
{:else}
  {#each Object.keys(grouped).sort() as cat (cat)}
    <section>
      <h2>{cat.replace("_", " ")} ({grouped[cat]!.length})</h2>
      <ul class="grid">
        {#each grouped[cat]! as it (it.id)}
          <li>
            <button class="entry" onclick={() => add(it.id, it.canonical_name_de)}>
              <span class="name">{it.canonical_name_de}</span>
              <span class="unit">{it.default_unit}</span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
{/if}

<style>
  h1 {
    margin: 0 0 0.5rem;
  }
  h2 {
    margin: 1.5rem 0 0.5rem;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #888;
  }
  .lead {
    color: #aaa;
    font-size: 0.9rem;
    line-height: 1.5;
  }
  .search {
    margin: 1rem 0;
  }
  .filters {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin-bottom: 1rem;
  }
  .cat {
    background: #161616;
    border: 1px solid #2a2a2a;
    color: #aaa;
    padding: 0.35rem 0.7rem;
    border-radius: 999px;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .cat:hover {
    background: #1a1a1a;
  }
  .cat.active {
    background: #1f2a3a;
    color: #fff;
    border-color: #2a3a5a;
  }
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 0.4rem;
  }
  .entry {
    width: 100%;
    text-align: left;
    background: #111;
    color: #eee;
    border: 0;
    padding: 0.55rem 0.8rem;
    border-radius: 6px;
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.4rem;
  }
  .entry:hover {
    background: #1a1a1a;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .unit {
    color: #666;
    font-size: 0.75rem;
    flex-shrink: 0;
  }
  .muted {
    color: #888;
  }
  .err {
    color: #ff6b6b;
  }
</style>
