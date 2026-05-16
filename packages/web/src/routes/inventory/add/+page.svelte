<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { api, ApiError, type Location, type StorageUnit, type Barcode } from "$lib/api.ts";
  import IngredientSearch from "$lib/IngredientSearch.svelte";

  type IngredientDetail = {
    id: string;
    canonical_name_de: string;
    default_unit: StorageUnit;
    shelf_life_days: number | null;
  };

  let locations = $state<Location[]>([]);
  let picked = $state<{ id: string; name: string } | null>(null);
  let detail = $state<IngredientDetail | null>(null);
  let locationId = $state<string>("");
  let quantity = $state<string>("1");
  let unit = $state<StorageUnit>("piece");
  let expiry = $state<string>("");
  let prefillBarcode = $state<string | null>(null);
  let prefillProduct = $state<string | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      locations = await api.get<Location[]>("/api/locations");
      if (locations[0]) locationId = locations[0].id;
    } catch (err) {
      error = err instanceof ApiError ? err.message : "Could not load locations.";
    }

    // Optional ?gtin=... handoff from /scan.
    const gtin = page.url.searchParams.get("gtin");
    if (gtin) {
      prefillBarcode = gtin;
      try {
        const b = await api.get<Barcode>(`/api/barcode/${gtin}`);
        prefillProduct = b.brand
          ? `${b.brand} — ${b.product_name ?? ""}`.trim()
          : b.product_name;
        if (b.package_quantity) quantity = b.package_quantity;
        if (b.package_unit) unit = b.package_unit;
        // Auto-search by product name to surface a candidate.
        // The user still has to confirm the link.
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          // Unknown barcode — user enters the ingredient manually.
        } else {
          error = err instanceof ApiError ? err.message : "Barcode lookup failed.";
        }
      }
    }
  });

  async function loadDetail(id: string) {
    try {
      const d = await api.get<IngredientDetail>(`/api/ingredients/${id}`);
      detail = d;
      unit = d.default_unit;
      if (d.shelf_life_days && !expiry) {
        const dt = new Date();
        dt.setDate(dt.getDate() + d.shelf_life_days);
        expiry = dt.toISOString().slice(0, 10);
      }
    } catch (err) {
      console.warn("ingredient detail load failed:", err);
    }
  }

  function onPick(m: { id: string; name: string } | null) {
    picked = m;
    if (m) loadDetail(m.id);
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (busy) return;
    if (!picked || !locationId || !quantity) {
      error = "Pick an ingredient and a location.";
      return;
    }
    const n = parseFloat(quantity);
    if (!Number.isFinite(n) || n <= 0) {
      error = "Quantity must be a positive number.";
      return;
    }
    busy = true;
    error = null;
    try {
      await api.post("/api/stock", {
        ingredient_id: picked.id,
        location_id: locationId,
        quantity: n,
        unit,
        expiry_date: expiry || null,
        barcode: prefillBarcode,
        source: prefillBarcode ? "barcode" : "manual",
        confidence: 1,
      });
      goto("/inventory/", { replaceState: true });
    } catch (err) {
      error = err instanceof ApiError ? err.message : "Save failed.";
    } finally {
      busy = false;
    }
  }
</script>

<a href="/inventory/" class="back">← Back</a>
<h1>Add to pantry</h1>

{#if prefillProduct}
  <div class="hint">From scan: <strong>{prefillProduct}</strong> ({prefillBarcode})</div>
{:else if prefillBarcode}
  <div class="hint">
    Unknown barcode <code>{prefillBarcode}</code> — pick a matching ingredient and we'll cache it for next time.
  </div>
{/if}

<form onsubmit={handleSubmit}>
  <label>
    Ingredient
    <IngredientSearch onpick={onPick} placeholder="z.B. Karotte, Peterli, Milch…" />
    {#if picked}
      <small class="picked">✓ {picked.name}</small>
    {/if}
  </label>

  <div class="row">
    <label class="grow">
      Quantity
      <input type="number" step="0.01" min="0.01" bind:value={quantity} required />
    </label>
    <label>
      Unit
      <select bind:value={unit}>
        <option value="g">g</option>
        <option value="ml">ml</option>
        <option value="piece">piece</option>
        <option value="bunch">bunch</option>
        <option value="pack">pack</option>
        <option value="slice">slice</option>
      </select>
    </label>
  </div>

  <label>
    Location
    <select bind:value={locationId} required>
      {#each locations as loc (loc.id)}
        <option value={loc.id}>{loc.name}</option>
      {/each}
    </select>
  </label>

  <label>
    Expiry date (optional)
    <input type="date" bind:value={expiry} />
  </label>

  {#if error}
    <p class="err">{error}</p>
  {/if}

  <button type="submit" disabled={busy || !picked}>{busy ? "…" : "Save"}</button>
</form>

<style>
  .back {
    color: #888;
    text-decoration: none;
    font-size: 0.9rem;
  }
  h1 {
    margin: 0.5rem 0 1.5rem;
  }
  .hint {
    background: #1f2a3a;
    border: 1px solid #2a3a4a;
    padding: 0.6rem 0.8rem;
    border-radius: 6px;
    font-size: 0.9rem;
    color: #ccc;
    margin-bottom: 1rem;
  }
  .hint code {
    background: #0e1620;
    padding: 0.1em 0.4em;
    border-radius: 4px;
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
  .row {
    display: flex;
    gap: 0.8rem;
  }
  .grow {
    flex: 1;
  }
  .picked {
    color: #4a90e2;
    font-size: 0.85rem;
  }
  input,
  select {
    background: #111;
    border: 1px solid #2a2a2a;
    color: #f5f5f5;
    border-radius: 6px;
    padding: 0.6rem 0.7rem;
    font-size: 1rem;
  }
  input:focus,
  select:focus {
    outline: none;
    border-color: #4a90e2;
  }
  button {
    background: #4a90e2;
    color: white;
    border: 0;
    border-radius: 6px;
    padding: 0.8rem;
    font-size: 1rem;
    font-weight: 500;
    margin-top: 0.5rem;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .err {
    color: #ff6b6b;
    font-size: 0.9rem;
    margin: 0;
  }
</style>
