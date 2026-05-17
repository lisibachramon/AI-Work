<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { session } from "$lib/session.svelte.ts";

  let { children } = $props();

  const publicRoutes = new Set(["/login/"]);

  onMount(async () => {
    await session.refresh();
    const isPublic = publicRoutes.has(page.url.pathname);
    if (!session.user && !isPublic) {
      goto("/login/", { replaceState: true });
    } else if (session.user && page.url.pathname === "/login/") {
      goto("/inventory/", { replaceState: true });
    }
  });

  async function handleLogout(e: Event) {
    e.preventDefault();
    await session.logout();
    goto("/login/", { replaceState: true });
  }
</script>

<svelte:head>
  <title>Kitchen</title>
</svelte:head>

{#if session.user}
  <header>
    <nav>
      <a href="/inventory/" class:active={page.url.pathname.startsWith("/inventory")}>Pantry</a>
      <a href="/catalog/" class:active={page.url.pathname.startsWith("/catalog")}>Catalog</a>
      <a href="/scan/" class:active={page.url.pathname.startsWith("/scan")}>Scan</a>
      <a href="/cook/" class:active={page.url.pathname.startsWith("/cook")}>Cook</a>
      <a href="/shopping/" class:active={page.url.pathname.startsWith("/shopping")}>Shop</a>
      <a href="/settings/" class:active={page.url.pathname.startsWith("/settings")}>Settings</a>
      <span class="spacer"></span>
      <button onclick={handleLogout} class="logout">Logout</button>
    </nav>
  </header>
{/if}

<main>
  {#if session.loading}
    <p class="loading">Loading…</p>
  {:else}
    {@render children?.()}
  {/if}
</main>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    background: #0a0a0a;
    color: #f5f5f5;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    min-height: 100dvh;
  }
  :global(*) {
    box-sizing: border-box;
  }
  :global(button) {
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  :global(input, select, textarea) {
    font: inherit;
    color: inherit;
  }

  header {
    position: sticky;
    top: 0;
    background: #111;
    border-bottom: 1px solid #222;
    padding: 0.5rem 1rem;
    padding-top: calc(env(safe-area-inset-top, 0) + 0.5rem);
    z-index: 10;
  }
  nav {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    max-width: 720px;
    margin: 0 auto;
  }
  nav a {
    color: #aaa;
    text-decoration: none;
    padding: 0.4rem 0.6rem;
    border-radius: 6px;
  }
  nav a.active {
    color: #fff;
    background: #222;
  }
  .spacer {
    flex: 1;
  }
  .logout {
    background: transparent;
    border: 1px solid #333;
    color: #aaa;
    padding: 0.3rem 0.7rem;
    border-radius: 6px;
  }
  .logout:hover {
    border-color: #555;
    color: #fff;
  }

  main {
    max-width: 720px;
    margin: 0 auto;
    padding: 1rem;
    padding-bottom: calc(env(safe-area-inset-bottom, 0) + 4rem);
  }
  .loading {
    color: #777;
    text-align: center;
    padding: 3rem 0;
  }
</style>
