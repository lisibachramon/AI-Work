<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { api, ApiError, type Location, type StorageUnit } from "$lib/api.ts";

  type StockItemFull = {
    id: string;
    quantity: string;
    unit: StorageUnit;
    expiry_date: string | null;
    opened_at: string | null;
    notes: string | null;
    confidence: string;
    source: string;
    ingredient: { id: string; canonical_name_de: string; category: string };
    location: { id: string; name: string; kind: Location["kind"] };
  };

  let item = $state<StockItemFull | null>(null);
  let locations = $state<Location[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let saving = $state(false);

  // Editable fields, hydrated on load.
  let quantity = $state("");
  let locationId = $state("");
  let expiryDate = $state("");
  let openedAt = $state("");
  let notes = $state("");

  const id = $derived(page.params.id);

  onMount(load);

  async function load() {
    loading = true;
    error = null;
    try {
      const [all, locs] = await Promise.all([
        api.get<StockItemFull[]>("/api/stock"),
        api.get<Location[]>("/api/locations"),
      ]);
      const found = all.find((it) => it.id === id);
      if (!found) {
        error = "Item not found (may have been removed).";
        return;
      }
      item = found;
      locations = locs;
      quantity = found.quantity;
      locationId = found.location.id;
      expiryDate = found.expiry_date ?? "";
      openedAt = found.opened_at ? found.opened_at.slice(0, 10) : "";
      notes = found.notes ?? "";
    } catch (err) {
      error = err instanceof ApiError ? err.message : "Failed to load.";
    } finally {
      loading = false;
    }
  }

  async function save() {
    if (saving || !item) return;
    saving = true;
    error = null;
    try {
      const update: Record<string, unknown> = {};
      const q = parseFloat(quantity);
      if (Number.isFinite(q) && q > 0 && q.toString() !== item.quantity) {
        update.quantity = q;
      }
      if (locationId && locationId !== item.location.id) update.location_id = locationId;
      const newExpiry = expiryDate || null;
      if (newExpiry !== item.expiry_date) update.expiry_date = newExpiry;
      const newOpened = openedAt ? new Date(openedAt + "T00:00:00Z").toISOString() : null;
      if (newOpened !== item.opened_at) update.opened_at = newOpened;
      const newNotes = notes.trim() || null;
      if (newNotes !== item.notes) update.notes = newNotes;

      if (Object.keys(update).length === 0) {
        goto("/inventory/");
        return;
      }
      await api.patch(`/api/stock/${id}`, update);
      goto("/inventory/", { replaceState: true });
    } catch (err) {
      error = err instanceof ApiError ? err.message : "Save failed.";
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!item) return;
    if (!confirm(`Remove ${item.ingredient.canonical_name_de}?`)) return;
    try {
      await api.delete(`/api/stock/${id}`);
      goto("/inventory/", { replaceState: true });
    } catch (err) {
      error = err instanceof ApiError ? err.message : "Delete failed.";
    }
  }
</script>

<a href="/inventory/" class="back">← Back</a>

{#if loading}
  <p class="muted">Loading…</p>
{:else if error && !item}
  <p class="err">{error}</p>
{:else if item}
  <h1>{item.ingredient.canonical_name_de}</h1>
  <p class="meta">
    {item.unit} · added via {item.source}
  </p>

  <form onsubmit={(e) => { e.preventDefault(); save(); }}>
    <label>
      Quantity
      <input type="number" step="0.01" min="0.01" bind:value={quantity} required />
    </label>

    <label>
      Location
      <select bind:value={locationId}>
        {#each locations as l (l.id)}
          <option value={l.id}>{l.name}</option>
        {/each}
      </select>
    </label>

    <label>
      Expiry date
      <input type="date" bind:value={expiryDate} />
    </label>

    <label>
      Opened on
      <input type="date" bind:value={openedAt} />
    </label>

    <label>
      Notes
      <textarea bind:value={notes} rows="3" maxlength="500" placeholder="e.g. half eaten, store in airtight tin"></textarea>
    </label>

    {#if error}
      <p class="err">{error}</p>
    {/if}

    <div class="actions">
      <button type="button" class="del" onclick={remove}>Remove</button>
      <button type="submit" class="primary" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  </form>
{/if}

<style>
  .back {
    color: #888;
    text-decoration: none;
    font-size: 0.9rem;
  }
  h1 {
    margin: 0.5rem 0 0.3rem;
  }
  .meta {
    color: #888;
    font-size: 0.85rem;
    margin: 0 0 1.5rem;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    color: #aaa;
    font-size: 0.9rem;
  }
  input,
  select,
  textarea {
    background: #111;
    border: 1px solid #2a2a2a;
    color: #f5f5f5;
    border-radius: 6px;
    padding: 0.6rem 0.7rem;
    font: inherit;
    resize: vertical;
  }
  input:focus,
  select:focus,
  textarea:focus {
    outline: none;
    border-color: #4a90e2;
  }
  .actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 0.5rem;
  }
  .primary {
    background: #4a90e2;
    color: white;
    border: 0;
    border-radius: 6px;
    padding: 0.7rem 1.2rem;
    font: inherit;
    flex: 1;
  }
  .primary:disabled {
    opacity: 0.5;
  }
  .del {
    background: transparent;
    border: 1px solid #2a2a2a;
    color: #aaa;
    padding: 0.7rem 1.2rem;
    border-radius: 6px;
    font: inherit;
  }
  .del:hover {
    border-color: #663030;
    color: #ff6b6b;
  }
  .err {
    color: #ff6b6b;
  }
  .muted {
    color: #888;
  }
</style>
