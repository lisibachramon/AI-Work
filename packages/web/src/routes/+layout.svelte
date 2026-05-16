<script lang="ts">
  let { children } = $props();
</script>

<svelte:head>
  <title>Kitchen</title>
</svelte:head>

<main>
  {@render children?.()}
</main>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    background: #0a0a0a;
    color: #f5f5f5;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    min-height: 100vh;
  }
  main {
    max-width: 720px;
    margin: 0 auto;
    padding: 1rem;
    padding-top: env(safe-area-inset-top, 1rem);
    padding-bottom: env(safe-area-inset-bottom, 1rem);
  }
</style>
