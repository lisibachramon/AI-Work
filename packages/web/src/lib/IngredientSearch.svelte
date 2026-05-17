<script lang="ts">
  import { api, ApiError, type IngredientMatch, type StorageUnit } from "./api.ts";

  type Props = {
    onpick: (m: { id: string; name: string } | null) => void;
    placeholder?: string;
    allowCreate?: boolean;
  };
  let { onpick, placeholder = "Search ingredient…", allowCreate = true }: Props = $props();

  let query = $state("");
  let results = $state<IngredientMatch[]>([]);
  let highlight = $state(0);
  let open = $state(false);
  let pending = 0;
  let inputEl: HTMLInputElement;

  // Inline "create new" panel state.
  let createOpen = $state(false);
  let createBusy = $state(false);
  let createCategory = $state<
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
    | "other"
  >("produce");
  let createUnit = $state<StorageUnit>("piece");
  let createError = $state<string | null>(null);

  // Show "Create new" prompt when user typed something with ≥2 chars and
  // there are no high-confidence matches (top score below 0.6).
  const showCreatePrompt = $derived(
    allowCreate &&
      open &&
      query.trim().length >= 2 &&
      (results.length === 0 || (results[0]?.score ?? 0) < 0.6) &&
      !createOpen,
  );

  async function runSearch(q: string) {
    if (q.trim().length < 2) {
      results = [];
      return;
    }
    const seq = ++pending;
    try {
      const data = await api.get<{ results: IngredientMatch[] }>(
        `/api/ingredients/search?q=${encodeURIComponent(q)}&limit=8`,
      );
      // Drop stale responses.
      if (seq !== pending) return;
      results = data.results;
      highlight = 0;
    } catch (err) {
      if (seq !== pending) return;
      results = [];
      if (!(err instanceof ApiError && err.status === 401)) console.warn(err);
    }
  }

  let debounce: ReturnType<typeof setTimeout> | null = null;
  function onInput() {
    open = true;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => runSearch(query), 120);
  }

  function pick(m: IngredientMatch) {
    onpick({ id: m.ingredient_id, name: m.canonical_name_de });
    query = m.canonical_name_de;
    open = false;
  }

  function onKey(e: KeyboardEvent) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlight = (highlight + 1) % results.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlight = (highlight - 1 + results.length) % results.length;
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(results[highlight]!);
    } else if (e.key === "Escape") {
      open = false;
    }
  }

  export function focus() {
    inputEl?.focus();
  }

  async function createNew() {
    if (createBusy) return;
    const name = query.trim();
    if (name.length < 2) return;
    createBusy = true;
    createError = null;
    try {
      const created = await api.post<{ id: string; canonical_name_de: string }>(
        "/api/ingredients",
        {
          canonical_name_de: name,
          category: createCategory,
          default_unit: createUnit,
        },
      );
      onpick({ id: created.id, name: created.canonical_name_de });
      query = created.canonical_name_de;
      open = false;
      createOpen = false;
    } catch (err) {
      createError = err instanceof ApiError ? err.message : "Create failed.";
    } finally {
      createBusy = false;
    }
  }
</script>

<div class="combo">
  <input
    bind:this={inputEl}
    type="text"
    bind:value={query}
    oninput={onInput}
    onfocus={() => (open = true)}
    onblur={() => setTimeout(() => (open = false), 150)}
    onkeydown={onKey}
    {placeholder}
    autocomplete="off"
    autocorrect="off"
    spellcheck="false"
  />
  {#if open && results.length > 0}
    <ul class="results">
      {#each results as r, i (r.ingredient_id)}
        <li
          class:hl={i === highlight}
          onmousedown={(e) => {
            e.preventDefault();
            pick(r);
          }}
          onmouseenter={() => (highlight = i)}
          role="option"
          aria-selected={i === highlight}
        >
          <span class="name">{r.canonical_name_de}</span>
          <span class="via">{r.matched_via}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if showCreatePrompt}
    <button
      type="button"
      class="create-prompt"
      onmousedown={(e) => {
        e.preventDefault();
        createOpen = true;
      }}
    >
      + Create "<strong>{query.trim()}</strong>" as a new ingredient
    </button>
  {/if}

  {#if createOpen}
    <div class="create-form" onmousedown={(e) => e.stopPropagation()} role="dialog">
      <div class="create-row">
        <label class="grow">
          Category
          <select bind:value={createCategory}>
            <option value="produce">produce</option>
            <option value="dairy">dairy</option>
            <option value="meat">meat</option>
            <option value="fish">fish</option>
            <option value="bakery">bakery</option>
            <option value="dry_goods">dry goods</option>
            <option value="spices">spices</option>
            <option value="beverages">beverages</option>
            <option value="frozen">frozen</option>
            <option value="condiments">condiments</option>
            <option value="other">other</option>
          </select>
        </label>
        <label>
          Default unit
          <select bind:value={createUnit}>
            <option value="g">g</option>
            <option value="ml">ml</option>
            <option value="piece">piece</option>
            <option value="bunch">bunch</option>
            <option value="pack">pack</option>
            <option value="slice">slice</option>
          </select>
        </label>
      </div>
      {#if createError}<p class="err">{createError}</p>{/if}
      <div class="create-actions">
        <button type="button" class="cancel" onclick={() => (createOpen = false)}>Cancel</button>
        <button type="button" class="confirm" onclick={createNew} disabled={createBusy}>
          {createBusy ? "Saving…" : `Create "${query.trim()}"`}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .combo {
    position: relative;
  }
  input {
    width: 100%;
    background: #111;
    border: 1px solid #2a2a2a;
    color: #f5f5f5;
    border-radius: 6px;
    padding: 0.6rem 0.7rem;
    font-size: 1rem;
  }
  input:focus {
    outline: none;
    border-color: #4a90e2;
  }
  .results {
    list-style: none;
    margin: 0.3rem 0 0;
    padding: 0;
    position: absolute;
    inset: 100% 0 auto 0;
    background: #161616;
    border: 1px solid #2a2a2a;
    border-radius: 6px;
    z-index: 20;
    max-height: 280px;
    overflow-y: auto;
  }
  li {
    padding: 0.55rem 0.7rem;
    cursor: pointer;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    border-bottom: 1px solid #1d1d1d;
  }
  li:last-child {
    border-bottom: 0;
  }
  li.hl {
    background: #1f2a3a;
  }
  .name {
    flex: 1;
  }
  .via {
    font-size: 0.7rem;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .create-prompt {
    display: block;
    margin-top: 0.3rem;
    width: 100%;
    text-align: left;
    background: #1a2030;
    border: 1px dashed #2a3a4a;
    color: #aac8e7;
    padding: 0.55rem 0.7rem;
    border-radius: 6px;
    font: inherit;
  }
  .create-prompt:hover {
    background: #1f2840;
  }
  .create-form {
    margin-top: 0.3rem;
    background: #161616;
    border: 1px solid #2a2a2a;
    border-radius: 6px;
    padding: 0.7rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .create-row {
    display: flex;
    gap: 0.5rem;
  }
  .create-row label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    color: #aaa;
    font-size: 0.8rem;
    flex: 1;
  }
  .create-row .grow {
    flex: 1.4;
  }
  .create-row select {
    background: #0a0a0a;
    border: 1px solid #2a2a2a;
    color: #f5f5f5;
    border-radius: 6px;
    padding: 0.45rem 0.55rem;
    font: inherit;
  }
  .create-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }
  .cancel,
  .confirm {
    border: 0;
    border-radius: 6px;
    padding: 0.5rem 0.9rem;
    font: inherit;
  }
  .cancel {
    background: #222;
    color: #ccc;
  }
  .confirm {
    background: #4a90e2;
    color: white;
  }
  .confirm:disabled {
    opacity: 0.5;
  }
  .err {
    color: #ff6b6b;
    font-size: 0.85rem;
    margin: 0;
  }
</style>
