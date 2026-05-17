<script lang="ts">
  import { onMount } from "svelte";
  import { api, ApiError } from "$lib/api.ts";
  import { session } from "$lib/session.svelte.ts";

  type Health = { ok: boolean; status?: number; models?: string[] };
  type Token = {
    id: string;
    name: string;
    last_used_at: string | null;
    revoked_at: string | null;
    created_at: string;
  };

  let api_h = $state<Health | null>(null);
  let db_h = $state<Health | null>(null);
  let ollama_h = $state<Health | null>(null);
  let tokens = $state<Token[]>([]);
  let tokenError = $state<string | null>(null);

  let newName = $state("");
  let creating = $state(false);
  let createdSecret = $state<{ name: string; token: string } | null>(null);

  let backfillBusy = $state(false);
  let backfillResult = $state<string | null>(null);

  async function loadHealth() {
    [api_h, db_h, ollama_h] = await Promise.all([
      fetch("/health").then((r) => r.json()).catch(() => ({ ok: false })),
      fetch("/health/db").then((r) => r.json()).catch(() => ({ ok: false })),
      fetch("/health/ollama").then((r) => r.json()).catch(() => ({ ok: false })),
    ]);
  }

  async function loadTokens() {
    try {
      tokens = await api.get<Token[]>("/api/mcp-tokens");
    } catch (err) {
      tokenError = err instanceof ApiError ? err.message : "Failed to load tokens.";
    }
  }

  onMount(() => {
    loadHealth();
    loadTokens();
  });

  async function createToken(e: Event) {
    e.preventDefault();
    if (creating || !newName.trim()) return;
    creating = true;
    tokenError = null;
    try {
      const created = await api.post<{ name: string; token: string }>(
        "/api/mcp-tokens",
        { name: newName.trim() },
      );
      createdSecret = { name: created.name, token: created.token };
      newName = "";
      await loadTokens();
    } catch (err) {
      tokenError = err instanceof ApiError ? err.message : "Create failed.";
    } finally {
      creating = false;
    }
  }

  async function revokeToken(t: Token) {
    if (!confirm(`Revoke "${t.name}"?`)) return;
    try {
      await api.delete(`/api/mcp-tokens/${t.id}`);
      await loadTokens();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Revoke failed.");
    }
  }

  async function copySecret() {
    if (!createdSecret) return;
    try {
      await navigator.clipboard.writeText(createdSecret.token);
      alert("Copied.");
    } catch {
      alert("Couldn't copy — select the text and copy manually.");
    }
  }

  async function backfillEmbeddings() {
    if (backfillBusy) return;
    backfillBusy = true;
    backfillResult = null;
    try {
      const r = await api.post<{ updated: number; skipped: number }>(
        "/api/embeddings/backfill",
      );
      backfillResult = `Updated ${r.updated}, skipped ${r.skipped} (already populated).`;
    } catch (err) {
      backfillResult =
        err instanceof ApiError
          ? err.message === "ollama_failed"
            ? "Ollama unreachable. Check OLLAMA_BASE_URL on the server and that bge-m3 is pulled."
            : err.message
          : "Backfill failed.";
    } finally {
      backfillBusy = false;
    }
  }
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
      <small>(use as <code>KITCHEN_USER_ID</code> in the MCP stdio config)</small>
    </dd>
  </dl>
</section>

<section>
  <div class="head-row">
    <h2>MCP tokens</h2>
  </div>
  <p class="lead">
    Use a bearer token to connect Claude Desktop, Claude Code, or any other
    MCP client to <code>https://kitchen.lisibach.xyz/mcp</code> via Streamable HTTP.
    The plaintext token is shown <strong>once</strong> at creation — copy it
    immediately. You can have multiple tokens (e.g. one per device) and revoke
    any of them.
  </p>

  {#if createdSecret}
    <div class="secret">
      <div>
        New token <strong>{createdSecret.name}</strong>:
      </div>
      <code class="secret-value">{createdSecret.token}</code>
      <div class="secret-actions">
        <button onclick={copySecret}>Copy</button>
        <button class="dismiss" onclick={() => (createdSecret = null)}>I've copied it</button>
      </div>
    </div>
  {/if}

  <form onsubmit={createToken} class="token-form">
    <input
      type="text"
      bind:value={newName}
      placeholder="Token name (e.g. iPhone, Claude Desktop)"
      maxlength="60"
    />
    <button type="submit" disabled={creating || !newName.trim()}>
      {creating ? "…" : "Create"}
    </button>
  </form>

  {#if tokenError}
    <p class="err">{tokenError}</p>
  {/if}

  {#if tokens.length > 0}
    <ul class="tokens">
      {#each tokens as t (t.id)}
        <li class:revoked={t.revoked_at}>
          <div class="t-name">{t.name}</div>
          <div class="t-meta">
            {#if t.revoked_at}
              <span class="muted">revoked {new Date(t.revoked_at).toLocaleDateString()}</span>
            {:else if t.last_used_at}
              last used {new Date(t.last_used_at).toLocaleString()}
            {:else}
              never used
            {/if}
          </div>
          {#if !t.revoked_at}
            <button class="revoke" onclick={() => revokeToken(t)}>Revoke</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section>
  <h2>Semantic search</h2>
  <p class="lead">
    Backfill <code>bge-m3</code> embeddings for your ingredient catalogue. The
    matcher uses these for fuzzy semantic queries when the lexical match
    isn't confident (queries ≥4 chars). Safe to re-run — already-embedded
    rows are skipped.
  </p>
  <button onclick={backfillEmbeddings} disabled={backfillBusy} class="action">
    {backfillBusy ? "Running…" : "Backfill embeddings"}
  </button>
  {#if backfillResult}
    <p class="result">{backfillResult}</p>
  {/if}
</section>

<section>
  <h2>System</h2>
  <ul class="status">
    <li>API: <span class:ok={api_h?.ok} class:bad={api_h && !api_h.ok}>{api_h?.ok ? "ok" : "down"}</span></li>
    <li>DB: <span class:ok={db_h?.ok} class:bad={db_h && !db_h.ok}>{db_h?.ok ? "ok" : "down"}</span></li>
    <li>
      Ollama:
      <span class:ok={ollama_h?.ok} class:bad={ollama_h && !ollama_h.ok}>
        {ollama_h?.ok ? `ok (${ollama_h.models?.length ?? 0} models)` : "down"}
      </span>
      {#if ollama_h?.models?.length}
        <div class="models">
          {#each ollama_h.models as m (m)}
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
  .lead {
    color: #aaa;
    font-size: 0.9rem;
    line-height: 1.5;
    margin: 0 0 0.8rem;
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
  .head-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .token-form {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.8rem;
  }
  .token-form input {
    flex: 1;
    background: #0a0a0a;
    border: 1px solid #2a2a2a;
    color: #f5f5f5;
    border-radius: 6px;
    padding: 0.5rem 0.7rem;
    font: inherit;
  }
  .token-form button {
    background: #4a90e2;
    color: white;
    border: 0;
    border-radius: 6px;
    padding: 0.5rem 1rem;
    font: inherit;
  }
  .tokens {
    list-style: none;
    padding: 0;
    margin: 0;
    background: #0a0a0a;
    border-radius: 6px;
  }
  .tokens li {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 0.6rem;
    align-items: center;
    padding: 0.6rem 0.8rem;
    border-bottom: 1px solid #1a1a1a;
  }
  .tokens li:last-child {
    border-bottom: 0;
  }
  .tokens li.revoked {
    opacity: 0.5;
  }
  .t-name {
    font-weight: 500;
  }
  .t-meta {
    font-size: 0.8rem;
    color: #888;
  }
  .revoke {
    background: transparent;
    border: 1px solid #2a2a2a;
    color: #888;
    padding: 0.3rem 0.7rem;
    border-radius: 6px;
    font: inherit;
    font-size: 0.85rem;
  }
  .revoke:hover {
    color: #ff6b6b;
    border-color: #663030;
  }
  .secret {
    background: #1f2a18;
    border: 1px solid #2a3a18;
    color: #c8e7c0;
    padding: 0.8rem;
    border-radius: 6px;
    margin-bottom: 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .secret-value {
    background: #0a1408;
    color: #e8f7e0;
    padding: 0.6rem 0.8rem;
    border-radius: 4px;
    word-break: break-all;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
  }
  .secret-actions {
    display: flex;
    gap: 0.5rem;
  }
  .secret-actions button {
    background: #2a3a18;
    color: #c8e7c0;
    border: 0;
    border-radius: 6px;
    padding: 0.4rem 0.8rem;
    font: inherit;
  }
  .secret-actions .dismiss {
    background: transparent;
    border: 1px solid #2a3a18;
  }
  .action {
    background: #4a90e2;
    color: white;
    border: 0;
    border-radius: 6px;
    padding: 0.5rem 1rem;
    font: inherit;
  }
  .action:disabled {
    opacity: 0.5;
  }
  .result {
    margin: 0.6rem 0 0;
    color: #aaa;
    font-size: 0.9rem;
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
  .muted {
    color: #888;
  }
  .err {
    color: #ff6b6b;
    font-size: 0.9rem;
  }
  .models {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-top: 0.5rem;
  }
</style>
