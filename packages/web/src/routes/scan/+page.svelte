<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { BrowserMultiFormatReader } from "@zxing/browser";
  import { BarcodeFormat, DecodeHintType } from "@zxing/library";
  import { api, ApiError, type Barcode } from "$lib/api.ts";

  let videoEl: HTMLVideoElement;
  let reader: BrowserMultiFormatReader | null = null;
  let controls: { stop: () => void } | null = null;

  let lastSeen = $state<{ gtin: string; at: number } | null>(null);
  let recent = $state<Array<{ gtin: string; name: string | null; ts: number }>>([]);
  let error = $state<string | null>(null);
  let scanning = $state(false);

  const DEDUPE_MS = 5000;

  onMount(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      error = "Camera API not available on this device.";
      return;
    }
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.QR_CODE,
    ]);
    reader = new BrowserMultiFormatReader(hints);

    try {
      controls = await reader.decodeFromVideoDevice(undefined, videoEl, (result) => {
        if (!result) return;
        const gtin = result.getText();
        const now = Date.now();
        if (lastSeen && lastSeen.gtin === gtin && now - lastSeen.at < DEDUPE_MS) return;
        lastSeen = { gtin, at: now };
        if ("vibrate" in navigator) navigator.vibrate?.(40);
        handleHit(gtin);
      });
      scanning = true;
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not start camera.";
    }
  });

  onDestroy(() => {
    controls?.stop();
  });

  async function handleHit(gtin: string) {
    try {
      const b = await api.get<Barcode>(`/api/barcode/${gtin}`);
      const label = b.brand
        ? `${b.brand} — ${b.product_name ?? ""}`.trim()
        : (b.product_name ?? "Unknown");
      recent = [{ gtin, name: label, ts: Date.now() }, ...recent].slice(0, 6);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        recent = [{ gtin, name: null, ts: Date.now() }, ...recent].slice(0, 6);
      } else {
        console.warn(err);
      }
    }
  }

  function openAdd(gtin: string) {
    controls?.stop();
    goto(`/inventory/add/?gtin=${encodeURIComponent(gtin)}`);
  }
</script>

<h1>Scan</h1>

{#if error}
  <p class="err">{error}</p>
  <p class="hint">
    iOS Safari requires HTTPS for camera access and may need permission via Settings → Safari → Camera.
  </p>
{/if}

<div class="viewport">
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={videoEl} autoplay playsinline muted></video>
  {#if scanning}
    <div class="overlay">Hold barcode in frame</div>
  {/if}
</div>

{#if recent.length}
  <h2>Recent</h2>
  <ul class="recent">
    {#each recent as r (r.ts)}
      <li>
        <div class="meta">
          <span class="gtin">{r.gtin}</span>
          <span class="name">{r.name ?? "Unknown — tap to register"}</span>
        </div>
        <button onclick={() => openAdd(r.gtin)}>Add →</button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  h1 {
    margin: 0 0 1rem;
  }
  h2 {
    margin: 1.5rem 0 0.5rem;
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #888;
  }
  .viewport {
    position: relative;
    background: #000;
    border-radius: 10px;
    overflow: hidden;
    aspect-ratio: 4 / 3;
    max-height: 60vh;
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .overlay {
    position: absolute;
    inset: auto 0 0.6rem 0;
    text-align: center;
    color: #fff;
    font-size: 0.85rem;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    pointer-events: none;
  }
  .recent {
    list-style: none;
    margin: 0;
    padding: 0;
    background: #111;
    border-radius: 8px;
    overflow: hidden;
  }
  .recent li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid #1d1d1d;
  }
  .recent li:last-child {
    border-bottom: 0;
  }
  .meta {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .gtin {
    font-size: 0.75rem;
    color: #666;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .name {
    color: #eee;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button {
    background: #4a90e2;
    color: white;
    border: 0;
    border-radius: 6px;
    padding: 0.4rem 0.8rem;
  }
  .err {
    color: #ff6b6b;
  }
  .hint {
    color: #888;
    font-size: 0.85rem;
  }
</style>
