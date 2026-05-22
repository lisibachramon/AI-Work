<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { api, ApiError, type Location } from "$lib/api.ts";
  import IngredientSearch from "$lib/IngredientSearch.svelte";

  type IngredientMatch = {
    ingredient_id: string;
    name: string;
    score: number;
    matched_via: string;
  };

  type ProposedItem = {
    name_de: string;
    quantity: number | null;
    unit: string | null;
    location_hint: string | null;
    confidence: number;
    note?: string | null;
  };

  type Proposal = {
    id: string;
    event_id: string;
    proposed_action: {
      item: ProposedItem;
      matches: IngredientMatch[];
      auto?: boolean;
    };
    chosen: boolean | null;
    applied_stock_item_id: string | null;
  };

  type Event = {
    id: string;
    kind: string;
    status: string;
    input_blob_path: string | null;
    metadata?: { vision_calls?: number } | null;
  };

  let evt = $state<Event | null>(null);
  let proposals = $state<Proposal[]>([]);
  let locations = $state<Location[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let busy = $state(false);

  // Per-proposal decisions.
  let picks = $state<Record<string, {
    accepted: boolean;
    ingredient_id: string | null;
    ingredient_label: string;
    location_id: string;
    quantity: string;
    unit: string;
    expiry_date: string;
  }>>({});

  const eventId = $derived(page.params.id);

  onMount(load);

  async function load() {
    loading = true;
    error = null;
    try {
      const [data, locs] = await Promise.all([
        api.get<{ event: Event; proposals: Proposal[] }>(`/api/ingest/events/${eventId}`),
        api.get<Location[]>("/api/locations"),
      ]);
      evt = data.event;
      proposals = data.proposals;
      locations = locs;

      // Seed picks per proposal.
      const newPicks: typeof picks = {};
      for (const p of proposals) {
        const topMatch = p.proposed_action.matches[0];
        const locForHint = locs.find(
          (l) =>
            l.name.toLowerCase() === (p.proposed_action.item.location_hint ?? "").toLowerCase(),
        );
        newPicks[p.id] = {
          accepted: topMatch ? topMatch.score >= 0.6 : false,
          ingredient_id: topMatch?.ingredient_id ?? null,
          ingredient_label: topMatch?.name ?? p.proposed_action.item.name_de,
          location_id: locForHint?.id ?? locs[0]?.id ?? "",
          quantity: (p.proposed_action.item.quantity ?? 1).toString(),
          unit: p.proposed_action.item.unit ?? "piece",
          expiry_date: "",
        };
      }
      picks = newPicks;
    } catch (err) {
      error = err instanceof ApiError ? err.message : "Failed to load.";
    } finally {
      loading = false;
    }
  }

  async function apply() {
    if (busy) return;
    busy = true;
    error = null;
    try {
      const accepted: Array<Record<string, unknown>> = [];
      const rejected: string[] = [];
      for (const p of proposals) {
        const d = picks[p.id];
        if (!d || !d.accepted) {
          rejected.push(p.id);
          continue;
        }
        if (!d.ingredient_id || !d.location_id) {
          throw new Error(
            `Pick an ingredient and location for "${p.proposed_action.item.name_de}".`,
          );
        }
        const q = parseFloat(d.quantity);
        if (!Number.isFinite(q) || q <= 0) {
          throw new Error(
            `Quantity for "${p.proposed_action.item.name_de}" must be positive.`,
          );
        }
        accepted.push({
          proposal_id: p.id,
          ingredient_id: d.ingredient_id,
          location_id: d.location_id,
          quantity: q,
          unit: d.unit,
          expiry_date: d.expiry_date || null,
        });
      }
      const result = await api.post<{ applied: number }>(
        `/api/ingest/events/${eventId}/apply`,
        { accepted, rejected },
      );
      alert(`Added ${result.applied} item${result.applied === 1 ? "" : "s"}.`);
      goto("/inventory/");
    } catch (err) {
      error = err instanceof Error ? err.message : "Apply failed.";
    } finally {
      busy = false;
    }
  }
</script>

<a href="/inventory/" class="back">← Cancel</a>
<h1>
  Review proposals
  {#if evt?.kind === "video_frame"}
    <span class="event-badge">
      Video session · {evt.metadata?.vision_calls ?? 0} Claude call{(evt.metadata?.vision_calls ?? 0) === 1 ? "" : "s"}
    </span>
  {:else if evt?.kind === "photo"}
    <span class="event-badge">Photo</span>
  {/if}
</h1>

{#if loading}
  <p class="muted">Loading…</p>
{:else if error}
  <p class="err">{error}</p>
{:else if proposals.length === 0}
  <p class="muted">No proposals on this event.</p>
{:else}
  <p class="lead">
    Claude found {proposals.length} item{proposals.length === 1 ? "" : "s"}. Confirm or skip each.
  </p>

  <div class="list">
    {#each proposals as p (p.id)}
      {@const d = picks[p.id]}
      {@const item = p.proposed_action.item}
      <article class:disabled={!d?.accepted}>
        <header>
          <label class="acc">
            <input type="checkbox" bind:checked={picks[p.id]!.accepted} />
            <span class="name">{item.name_de}</span>
          </label>
          <span class="conf">conf {(item.confidence * 100).toFixed(0)}%</span>
        </header>

        <label>
          Match
          {#if picks[p.id]?.ingredient_id}
            <div class="picked-row">
              <span class="picked-name">{picks[p.id]?.ingredient_label}</span>
              <button
                type="button"
                class="picked-change"
                onclick={() => {
                  picks[p.id]!.ingredient_id = null;
                }}
              >change</button>
            </div>
          {:else}
            <IngredientSearch
              onpick={(m) => {
                if (m) {
                  picks[p.id]!.ingredient_id = m.id;
                  picks[p.id]!.ingredient_label = m.name;
                }
              }}
              placeholder={`Search or create ingredient (Claude said: ${item.name_de})`}
              allowCreate={true}
            />
            {#if p.proposed_action.matches.length > 0}
              <div class="suggested">
                Suggested:
                {#each p.proposed_action.matches as m (m.ingredient_id)}
                  <button
                    type="button"
                    class="chip"
                    onclick={() => {
                      picks[p.id]!.ingredient_id = m.ingredient_id;
                      picks[p.id]!.ingredient_label = m.name;
                    }}
                  >{m.name} <span class="score">{(m.score * 100).toFixed(0)}%</span></button>
                {/each}
              </div>
            {/if}
          {/if}
        </label>

        <div class="row">
          <label class="grow">
            Quantity
            <input type="number" step="0.01" min="0.01" bind:value={picks[p.id]!.quantity} />
          </label>
          <label>
            Unit
            <select bind:value={picks[p.id]!.unit}>
              <option value="g">g</option>
              <option value="ml">ml</option>
              <option value="piece">piece</option>
              <option value="bunch">bunch</option>
              <option value="pack">pack</option>
              <option value="slice">slice</option>
            </select>
          </label>
          <label>
            Location
            <select bind:value={picks[p.id]!.location_id}>
              {#each locations as l (l.id)}
                <option value={l.id}>{l.name}</option>
              {/each}
            </select>
          </label>
        </div>

        <label>
          Expiry (optional)
          <input type="date" bind:value={picks[p.id]!.expiry_date} />
        </label>
      </article>
    {/each}
  </div>

  {#if error}
    <p class="err">{error}</p>
  {/if}
  <div class="actions">
    <button onclick={apply} class="primary" disabled={busy}>
      {busy ? "Applying…" : "Apply selected"}
    </button>
  </div>
{/if}

<style>
  .back {
    color: #888;
    text-decoration: none;
    font-size: 0.9rem;
  }
  h1 {
    margin: 0.5rem 0 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .event-badge {
    font-size: 0.7rem;
    font-weight: 500;
    background: #1d2a3a;
    color: #9bb8d4;
    border: 1px solid #2d4a6a;
    border-radius: 4px;
    padding: 0.15rem 0.45rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .lead {
    color: #aaa;
    margin-bottom: 1rem;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  article {
    background: #111;
    border-radius: 8px;
    padding: 0.8rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  article.disabled {
    opacity: 0.45;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .acc {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 500;
  }
  .name {
    font-size: 1rem;
  }
  .conf {
    font-size: 0.75rem;
    color: #888;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    color: #aaa;
    font-size: 0.85rem;
  }
  .row {
    display: flex;
    gap: 0.5rem;
  }
  .row .grow {
    flex: 1;
  }
  input,
  select {
    background: #0a0a0a;
    border: 1px solid #2a2a2a;
    color: #f5f5f5;
    border-radius: 6px;
    padding: 0.5rem 0.6rem;
    font: inherit;
  }
  .warn {
    color: #f0c674;
    font-size: 0.85rem;
    margin: 0;
  }
  .picked-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #0a0a0a;
    border: 1px solid #2a2a2a;
    border-radius: 6px;
    padding: 0.5rem 0.7rem;
  }
  .picked-name {
    color: #f5f5f5;
  }
  .picked-change {
    background: transparent;
    border: 0;
    color: #888;
    font: inherit;
    font-size: 0.85rem;
    text-decoration: underline;
    cursor: pointer;
  }
  .suggested {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.4rem;
    align-items: center;
    color: #888;
    font-size: 0.8rem;
  }
  .chip {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    color: #ddd;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .chip:hover {
    background: #1f2a3a;
  }
  .score {
    color: #888;
    margin-left: 0.3rem;
  }
  .actions {
    margin-top: 1rem;
  }
  .primary {
    background: #4a90e2;
    color: white;
    border: 0;
    border-radius: 6px;
    padding: 0.8rem 1.4rem;
    font: inherit;
    width: 100%;
  }
  .primary:disabled {
    opacity: 0.5;
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
