<script lang="ts">
  import { session } from "$lib/session.svelte.ts";

  type Health = { ok: boolean; status?: number; models?: string[] };

  let api = $state<Health | null>(null);
  let db = $state<Health | null>(null);
  let ollama = $state<Health | null>(null);

  async function load() {
    [api, db, ollama] = await Promise.all([
      fetch("/health").then((r) => r.json()).catch(() => ({ ok: false })),
      fetch("/health/db").then((r) => r.json()).catch(() => ({ ok: false })),
      fetch("/health/ollama").then((r) => r.json()).catch(() => ({ ok: false })),
    ]);
  }
  load();
</script>

<h1>Settings</h1>

<section>
  <h2>Account</h2>
  <dl>
    <dt>Email</dt>
    <dd>{session.user?.email ?? "—"}</dd>
    <dt>User ID</dt>
    <dd>
      <code>{session.user?.id ?? "—"}</code>
      <small>(use this as <code>KITCHEN_USER_ID</code> in the MCP stdio config)</small>
    </dd>
  </dl>
</section>

<section>
  <h2>System</h2>
  <ul class="status">
    <li>API: <span class:ok={api?.ok} class:bad={api && !api.ok}>{api?.ok ? "ok" : "down"}</span></li>
    <li>DB: <span class:ok={db?.ok} class:bad={db && !db.ok}>{db?.ok ? "ok" : "down"}</span></li>
    <li>
      Ollama:
      <span class:ok={ollama?.ok} class:bad={ollama && !ollama.ok}>
        {ollama?.ok ? `ok (${ollama.models?.length ?? 0} models)` : "down"}
      </span>
      {#if ollama?.models?.length}
        <div class="models">
          {#each ollama.models as m (m)}
            <code>{m}</code>
          {/each}
        </div>
      {/if}
    </li>
  </ul>
</section>

<style>
  h1 {
    margin: 0 0 1.5rem;
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
    background: #111;
    border-radius: 8px;
    padding: 1rem;
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.4rem 1rem;
  }
  dt {
    color: #888;
    font-size: 0.85rem;
  }
  dd {
    margin: 0;
    word-break: break-all;
  }
  dd small {
    display: block;
    color: #666;
    font-size: 0.8rem;
    margin-top: 0.2rem;
  }
  code {
    background: #1a1a1a;
    padding: 0.1em 0.4em;
    border-radius: 4px;
    font-size: 0.85em;
  }
  ul.status {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .ok {
    color: #6ec38a;
  }
  .bad {
    color: #ff6b6b;
  }
  .models {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-top: 0.5rem;
  }
</style>
