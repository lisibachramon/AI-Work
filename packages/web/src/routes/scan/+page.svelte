<script lang="ts">
  import { onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { BrowserMultiFormatReader } from "@zxing/browser";
  import { BarcodeFormat, DecodeHintType } from "@zxing/library";
  import { api, ApiError, type Barcode } from "$lib/api.ts";
  import { VisionSession } from "$lib/scanner/vision-session.svelte.ts";

  type Mode = "barcode" | "vision";
  type RecentBarcode = {
    gtin: string;
    name: string | null;
    autoAdded: boolean;
    error?: string;
    ts: number;
  };

  let mode = $state<Mode>("barcode");
  let videoEl: HTMLVideoElement;
  let error = $state<string | null>(null);

  // Barcode mode
  let reader: BrowserMultiFormatReader | null = null;
  let controls: { stop: () => void } | null = null;
  let scanning = $state(false);
  let autoAdd = $state(false);
  let lastSeen = $state<{ gtin: string; at: number } | null>(null);
  let recent = $state<RecentBarcode[]>([]);
  let stats = $state({ autoAdded: 0, unknown: 0 });
  const DEDUPE_MS = 5000;

  // Vision mode
  const vision = new VisionSession();
  let videoStream: MediaStream | null = null;

  $effect(() => {
    void mode;
    void switchMode();
  });

  onDestroy(() => {
    teardownBarcode();
    void teardownVision();
  });

  async function switchMode() {
    error = null;
    teardownBarcode();
    await teardownVision();
    if (mode === "barcode") await startBarcode();
    else await startVision();
  }

  // -------- Barcode mode --------

  async function startBarcode() {
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
        void handleHit(gtin);
      });
      scanning = true;
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not start camera.";
    }
  }

  function teardownBarcode() {
    controls?.stop();
    controls = null;
    reader = null;
    scanning = false;
  }

  async function handleHit(gtin: string) {
    try {
      const b = await api.get<Barcode>(`/api/barcode/${gtin}`);
      const label = b.brand
        ? `${b.brand} — ${b.product_name ?? ""}`.trim()
        : (b.product_name ?? "Unknown");
      if (autoAdd && b.ingredient_id) {
        await tryAutoAdd(gtin, label);
      } else {
        recent = [
          { gtin, name: label, autoAdded: false, ts: Date.now() },
          ...recent,
        ].slice(0, 6);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        stats.unknown++;
        recent = [
          { gtin, name: null, autoAdded: false, ts: Date.now() },
          ...recent,
        ].slice(0, 6);
      } else {
        console.warn(err);
      }
    }
  }

  async function tryAutoAdd(gtin: string, label: string) {
    try {
      await api.post("/api/stock/from-gtin", { gtin });
      stats.autoAdded++;
      recent = [
        { gtin, name: label, autoAdded: true, ts: Date.now() },
        ...recent,
      ].slice(0, 6);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message === "unknown_gtin"
            ? "Not linked — tap to add manually"
            : err.message
          : "Add failed";
      recent = [
        { gtin, name: label, autoAdded: false, error: msg, ts: Date.now() },
        ...recent,
      ].slice(0, 6);
    }
  }

  function openAdd(gtin: string) {
    teardownBarcode();
    goto(`/inventory/add/?gtin=${encodeURIComponent(gtin)}`);
  }

  // -------- Vision mode --------

  async function startVision() {
    if (!navigator.mediaDevices?.getUserMedia) {
      error = "Camera API not available on this device.";
      return;
    }
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      videoEl.srcObject = videoStream;
      await videoEl.play().catch(() => undefined);
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not start camera.";
    }
  }

  async function teardownVision() {
    if (vision.active) await vision.end();
    if (videoStream) {
      for (const t of videoStream.getTracks()) t.stop();
      videoStream = null;
      if (videoEl) videoEl.srcObject = null;
    }
  }

  function startSession() {
    vision.start(videoEl);
  }

  async function endSession() {
    const eventId = await vision.finalize();
    await vision.end();
    if (eventId) {
      goto(`/inventory/proposals/${eventId}/`);
    }
  }
</script>

<h1>Scan</h1>

<div class="tabs">
  <button
    class="tab"
    class:active={mode === "barcode"}
    onclick={() => (mode = "barcode")}
  >Barcode</button>
  <button
    class="tab"
    class:active={mode === "vision"}
    onclick={() => (mode = "vision")}
  >Vision</button>
</div>

{#if error}
  <p class="err">{error}</p>
  <p class="hint">
    iOS Safari requires HTTPS for camera access and may need permission via
    Settings → Safari → Camera.
  </p>
{/if}

<div class="viewport">
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={videoEl} autoplay playsinline muted></video>
  {#if mode === "barcode" && scanning}
    <div class="overlay">Hold barcode in frame</div>
  {/if}
  {#if mode === "vision" && vision.active}
    <div class="overlay">
      Session live · {vision.framesSurvived}/{vision.framesCaptured} frames ·
      {vision.callsUsed}/{vision.callsMax} calls
      {#if vision.inFlight}· uploading…{/if}
    </div>
  {/if}
</div>

{#if mode === "barcode"}
  <label class="toggle">
    <input type="checkbox" bind:checked={autoAdd} />
    Scan-and-add-all (auto-adds known GTINs as you scan)
  </label>
  {#if autoAdd}
    <p class="stats">
      Auto-added: <strong>{stats.autoAdded}</strong> · Unknown:
      <strong>{stats.unknown}</strong>
    </p>
  {/if}

  {#if recent.length}
    <h2>Recent</h2>
    <ul class="recent">
      {#each recent as r (r.ts)}
        <li>
          <div class="meta">
            <span class="gtin">{r.gtin}</span>
            <span class="name">{r.name ?? "Unknown — tap to register"}</span>
            {#if r.error}<span class="row-err">{r.error}</span>{/if}
          </div>
          {#if r.autoAdded}
            <span class="badge ok">Added</span>
          {:else}
            <button onclick={() => openAdd(r.gtin)}>Add →</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
{:else}
  <div class="vision-controls">
    {#if !vision.active}
      <button class="primary" onclick={startSession}>Start vision session</button>
      <p class="hint">
        Move the camera over a shelf or the fridge. Claude proposes items in
        batches. Frame dedupe + a hard call cap keep cost predictable.
      </p>
    {:else}
      <button class="primary" onclick={endSession} disabled={vision.inFlight}>
        End session → Review {vision.itemsInSession} item{vision.itemsInSession === 1 ? "" : "s"}
      </button>
      {#if vision.capReached}
        <p class="err">Cost cap reached ({vision.callsMax} calls). End session to review.</p>
      {/if}
      {#if vision.error}
        <p class="err">Last upload failed: {vision.error}</p>
      {/if}
    {/if}
  </div>

  {#if vision.items.length}
    <h2>Detected this session</h2>
    <ul class="recent">
      {#each vision.items as it (it.proposal_id)}
        <li>
          <div class="meta">
            <span class="name">{it.name}</span>
            <span class="gtin">
              {it.quantity ?? "?"} {it.unit ?? ""}
            </span>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
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
  .tabs {
    display: flex;
    gap: 0.4rem;
    margin-bottom: 1rem;
  }
  .tab {
    background: #111;
    color: #aaa;
    border: 1px solid #222;
    border-radius: 6px;
    padding: 0.45rem 1rem;
    font: inherit;
    font-size: 0.9rem;
  }
  .tab.active {
    background: #1d2a3a;
    color: #fff;
    border-color: #2d4a6a;
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
  .toggle {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 1rem 0 0.5rem;
    color: #ddd;
    font-size: 0.9rem;
  }
  .stats {
    color: #aaa;
    font-size: 0.9rem;
    margin: 0.2rem 0 1rem;
  }
  .stats strong {
    color: #eee;
  }
  .vision-controls {
    margin: 1rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .primary {
    background: #4a90e2;
    color: white;
    border: 0;
    border-radius: 6px;
    padding: 0.7rem 1.2rem;
    font: inherit;
    font-size: 1rem;
    align-self: flex-start;
  }
  .primary:disabled {
    opacity: 0.5;
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
  .row-err {
    color: #ff9b6b;
    font-size: 0.75rem;
  }
  button {
    background: #4a90e2;
    color: white;
    border: 0;
    border-radius: 6px;
    padding: 0.4rem 0.8rem;
  }
  .badge {
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    background: #1f3a1f;
    color: #8fdc8f;
  }
  .err {
    color: #ff6b6b;
  }
  .hint {
    color: #888;
    font-size: 0.85rem;
  }
</style>
