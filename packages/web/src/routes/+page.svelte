<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { session } from "$lib/session.svelte.ts";

  onMount(() => {
    // Layout already redirected unauthenticated users to /login.
    // If we're here authenticated, send them to the pantry.
    if (session.user) goto("/inventory/", { replaceState: true });
  });
</script>
