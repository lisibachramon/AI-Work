<script lang="ts">
  import { api, ApiError, type IngredientMatch } from "./api.ts";

  type Props = {
    onpick: (m: { id: string; name: string } | null) => void;
    placeholder?: string;
  };
  let { onpick, placeholder = "Search ingredient…" }: Props = $props();

  let query = $state("");
  let results = $state<IngredientMatch[]>([]);
  let highlight = $state(0);
  let open = $state(false);
  let pending = 0;
  let inputEl: HTMLInputElement;

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
</style>
