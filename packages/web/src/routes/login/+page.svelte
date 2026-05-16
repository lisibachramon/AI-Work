<script lang="ts">
  import { goto } from "$app/navigation";
  import { ApiError } from "$lib/api.ts";
  import { session } from "$lib/session.svelte.ts";

  let email = $state("");
  let password = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    error = null;
    try {
      await session.login(email, password);
      goto("/inventory/", { replaceState: true });
    } catch (err) {
      if (err instanceof ApiError) {
        error =
          err.message === "invalid_credentials"
            ? "Invalid email or password."
            : `Error: ${err.message}`;
      } else {
        error = "Network error.";
      }
    } finally {
      busy = false;
    }
  }
</script>

<div class="wrap">
  <h1>Kitchen</h1>
  <form onsubmit={handleSubmit}>
    <label>
      Email
      <input type="email" bind:value={email} required autocomplete="email" autofocus />
    </label>
    <label>
      Password
      <input
        type="password"
        bind:value={password}
        required
        autocomplete="current-password"
        minlength="10"
      />
    </label>
    {#if error}
      <p class="err">{error}</p>
    {/if}
    <button type="submit" disabled={busy}>{busy ? "…" : "Log in"}</button>
  </form>
</div>

<style>
  .wrap {
    max-width: 360px;
    margin: 4rem auto 0;
  }
  h1 {
    text-align: center;
    margin-bottom: 2rem;
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
    font-size: 0.9rem;
    color: #aaa;
  }
  input {
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
  button {
    background: #4a90e2;
    color: white;
    border: 0;
    border-radius: 6px;
    padding: 0.7rem;
    font-size: 1rem;
    font-weight: 500;
  }
  button:disabled {
    opacity: 0.5;
  }
  .err {
    color: #ff6b6b;
    font-size: 0.9rem;
    margin: 0;
  }
</style>
