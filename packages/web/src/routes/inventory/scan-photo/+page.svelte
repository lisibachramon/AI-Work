<script lang="ts">
  import { goto } from "$app/navigation";
  import { ApiError } from "$lib/api.ts";

  let busy = $state(false);
  let error = $state<string | null>(null);
  let progressText = $state<string | null>(null);
  let fileInput: HTMLInputElement;

  async function onFile(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file || busy) return;
    busy = true;
    error = null;
    progressText = "Uploading + analyzing…";
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/ingest/photo", {
        method: "POST",
        body,
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `http ${res.status}` }));
        throw new ApiError(res.status, data, data.error ?? `http ${res.status}`);
      }
      const data = await res.json();
      goto(`/inventory/proposals/${data.event_id}/`);
    } catch (err) {
      error =
        err instanceof ApiError
          ? err.message === "vision_failed"
            ? "Vision API failed — Claude OAuth may not be configured on the server."
            : err.message
          : "Upload failed.";
      progressText = null;
    } finally {
      busy = false;
    }
  }
</script>

<a href="/inventory/" class="back">← Back</a>
<h1>Photo</h1>

<p class="lead">
  Take a photo of your fridge or pantry shelf. Claude vision will list what it sees and you confirm.
</p>

<div class="dropzone">
  <input
    bind:this={fileInput}
    type="file"
    accept="image/*"
    capture="environment"
    onchange={onFile}
    disabled={busy}
  />
  <button
    onclick={() => fileInput?.click()}
    class="primary"
    disabled={busy}
  >
    {busy ? "Working…" : "Choose / take photo"}
  </button>
  {#if progressText}
    <p class="progress">{progressText}</p>
  {/if}
  {#if error}
    <p class="err">{error}</p>
  {/if}
</div>

<p class="hint">
  Tip: clear, well-lit shots work best. Avoid tilting; keep labels facing the camera. The image is downscaled to ≤1568px before being sent to Claude.
</p>

<style>
  .back {
    color: #888;
    text-decoration: none;
    font-size: 0.9rem;
  }
  h1 {
    margin: 0.5rem 0 1rem;
  }
  .lead {
    color: #ccc;
    line-height: 1.5;
  }
  .dropzone {
    background: #111;
    border: 1px dashed #333;
    border-radius: 8px;
    padding: 2rem 1rem;
    text-align: center;
    margin: 1.5rem 0;
  }
  .dropzone input {
    display: none;
  }
  .primary {
    background: #4a90e2;
    color: white;
    border: 0;
    border-radius: 6px;
    padding: 0.7rem 1.4rem;
    font: inherit;
    font-size: 1rem;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .progress {
    color: #aaa;
    margin-top: 1rem;
  }
  .err {
    color: #ff6b6b;
    margin-top: 1rem;
  }
  .hint {
    color: #777;
    font-size: 0.85rem;
    line-height: 1.5;
  }
</style>
