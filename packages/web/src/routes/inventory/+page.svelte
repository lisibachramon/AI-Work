<script lang="ts">
  import { onMount } from "svelte";
  import { api, ApiError, type StockItem, type Location } from "$lib/api.ts";

  let items = $state<StockItem[]>([]);
  let locations = $state<Location[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let locationFilter = $state<string | "all">("all");
  let expiringFilter = $state(false);

  const filtered = $derived(
    items.filter((it) => {
      if (locationFilter !== "all" && it.location.id !== locationFilter) return false;
      if (expiringFilter) {
        if (!it.expiry_date) return false;
        const days = (new Date(it.expiry_date).getTime() - Date.now()) / 86400000;
        if (days > 7) return false;
      }
      return true;
    }),
  );

  // Group by location for the rendering.
  const grouped = $derived(
    filtered.reduce<Record<string, StockItem[]>>((acc, it) => {
      const key = it.location.id;
      (acc[key] ??= []).push(it);
      return acc;
    }, {}),
  );

  onMount(load);

  async function load() {
    loading = true;
    error = null;
    try {
      [items, locations] = await Promise.all([
        api.get<StockItem[]>("/api/stock"),
        api.get<Location[]>("/api/locations"),
      ]);
    } catch (err) {
      error = err instanceof ApiError ? err.message : "Failed to load.";
    } finally {
      loading = false;
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this item?")) return;
    try {
      await api.delete(`/api/stock/${id}`);
      items = items.filter((it) => it.id !== id);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Delete failed.");
    }
  }

  function daysUntil(d: string | null): number | null {
    if (!d) return null;
    return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
  }

  function formatQuantity(q: string, unit: string): string {
    const n = parseFloat(q);
    return `${Number.isInteger(n) ? n : n.toFixed(2).replace(/\.?0+$/, "")} ${unit}`;
  }
</script>

<div class="header">
  <h1>Pantry</h1>
  <a href="/inventory/add/" class="add-btn">+ Add</a>
</div>

<div class="filters">
  <select bind:value={locationFilter}>
    <option value="all">All locations</option>
    {#each locations as loc (loc.id)}
      <option value={loc.id}>{loc.name}</option>
    {/each}
  </select>
  <label class="toggle">
    <input type="checkbox" bind:checked={expiringFilter} />
    Expiring soon
  </label>
</div>

{#if loading}
  <p class="muted">Loading…</p>
{:else if error}
  <p class="err">{error}</p>
{:else if filtered.length === 0}
  <p class="muted">
    {items.length === 0 ? "Pantry is empty. Tap + Add or Scan." : "No items match the filter."}
  </p>
{:else}
  {#each locations as loc (loc.id)}
    {#if grouped[loc.id]?.length}
      <section>
        <h2>{loc.name}</h2>
        <ul>
          {#each grouped[loc.id]! as it (it.id)}
            {@const d = daysUntil(it.expiry_date)}
            <li>
              <div class="name">{it.ingredient.canonical_name_de}</div>
              <div class="meta">
                <span class="qty">{formatQuantity(it.quantity, it.unit)}</span>
                {#if d !== null}
                  <span
                    class="expiry"
                    class:soon={d <= 4}
                    class:imminent={d <= 1}
                    class:past={d < 0}
                  >
                    {#if d < 0}{Math.abs(d)}d ago{:else if d === 0}today{:else}{d}d{/if}
                  </span>
                {/if}
              </div>
              <button onclick={() => handleDelete(it.id)} class="del" aria-label="Remove">×</button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/each}
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
    font-size: 1.6rem;
  }
  .add-btn {
    background: #4a90e2;
    color: white;
    border-radius: 6px;
    padding: 0.5rem 0.9rem;
    text-decoration: none;
    font-weight: 500;
  }
  .filters {
    display: flex;
    gap: 0.8rem;
    align-items: center;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }
  select {
    background: #111;
    border: 1px solid #2a2a2a;
    color: #f5f5f5;
    border-radius: 6px;
    padding: 0.4rem 0.6rem;
  }
  .toggle {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    color: #aaa;
    font-size: 0.9rem;
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
    font-weight: 600;
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
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 0.9rem;
    border-bottom: 1px solid #1d1d1d;
  }
  li:last-child {
    border-bottom: 0;
  }
  .name {
    font-weight: 500;
  }
  .meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.15rem;
    font-size: 0.85rem;
  }
  .qty {
    color: #ccc;
  }
  .expiry {
    font-size: 0.75rem;
    color: #888;
    padding: 0.05rem 0.4rem;
    border-radius: 4px;
    background: #1a1a1a;
  }
  .expiry.soon {
    color: #f0c674;
    background: #3a2e10;
  }
  .expiry.imminent,
  .expiry.past {
    color: #ff8888;
    background: #3a1010;
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
    text-align: center;
    padding: 2rem 0;
  }
  .err {
    color: #ff6b6b;
  }
</style>
