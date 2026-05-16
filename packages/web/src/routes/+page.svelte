<script lang="ts">
  import { onMount } from "svelte";

  type Health = { ok: boolean; status?: number; models?: string[] };

  let api = $state<Health | null>(null);
  let db = $state<Health | null>(null);
  let ollama = $state<Health | null>(null);

  onMount(async () => {
    api = await fetch("/health").then((r) => r.json()).catch(() => ({ ok: false }));
    db = await fetch("/health/db").then((r) => r.json()).catch(() => ({ ok: false }));
    ollama = await fetch("/health/ollama").then((r) => r.json()).catch(() => ({ ok: false }));
  });
</script>

<h1>Kitchen</h1>
<p>Self-hosted pantry + recipe planner. M1 scaffold.</p>

<section>
  <h2>System</h2>
  <ul>
    <li>API: {api?.ok ? "ok" : "down"}</li>
    <li>DB: {db?.ok ? "ok" : "down"}</li>
    <li>Ollama: {ollama?.ok ? `ok (${ollama.models?.length ?? 0} models)` : "down"}</li>
  </ul>
</section>

<section>
  <h2>Next</h2>
  <p>Register a user, then seed: <code>SEED_USER_EMAIL=... pnpm db:seed</code></p>
  <p>
    Routes coming online: <code>/inventory</code>, <code>/scan</code>, <code>/cook</code>,
    <code>/settings</code>.
  </p>
</section>

<style>
  h1 { margin-top: 0; }
  section { margin-top: 2rem; }
  code { background: #222; padding: 0.1em 0.4em; border-radius: 4px; }
</style>
