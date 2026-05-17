// Vision-mode session controller. Owns:
//   - the 64x64 sampling canvas and the larger 1568-px upload canvas
//   - the frame worker (motion + pHash filter)
//   - the upload batch (1..N survived frames per /api/ingest/video-frames POST)
//   - the rolling counters surfaced to the UI
//
// Lifecycle: `start(video)` → `tick()` runs on a setInterval → `end()` cleans
// up. `start` (re)creates the worker and resets its state.

import FrameWorker from "./frame-worker.ts?worker";
import { GRID } from "./phash.ts";

const CAPTURE_INTERVAL_MS = 1000;
const UPLOAD_MAX_FRAMES = 3;
const UPLOAD_DEBOUNCE_MS = 6000;
const UPLOAD_JPEG_QUALITY = 0.7;
const UPLOAD_MAX_SIDE = 1024; // pre-server downscale; server further trims to 1568
const FRAME_MIME = "image/jpeg";

export interface SessionItem {
  proposal_id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  ts: number;
}

interface UploadResponse {
  session_id: string;
  event_id: string;
  calls_used: number;
  max: number;
  items_in_session: number;
  new_items: Array<{
    id: string;
    proposed_action: {
      item?: { name_de?: string; quantity?: number | null; unit?: string | null };
    };
  }>;
}

export class VisionSession {
  sessionId = $state<string>("");
  eventId = $state<string | null>(null);
  active = $state(false);
  capturing = $state(false);
  framesCaptured = $state(0);
  framesSurvived = $state(0);
  callsUsed = $state(0);
  callsMax = $state(30);
  itemsInSession = $state(0);
  items = $state<SessionItem[]>([]);
  inFlight = $state(false);
  error = $state<string | null>(null);
  capReached = $derived(this.callsUsed >= this.callsMax);

  private worker: Worker | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private video: HTMLVideoElement | null = null;
  private sampleCanvas: HTMLCanvasElement | null = null;
  private uploadCanvas: HTMLCanvasElement | null = null;
  private batch: Blob[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private nextCallId = 0;
  private pending = new Map<number, (r: { survived: boolean }) => void>();

  start(video: HTMLVideoElement) {
    this.end();
    this.sessionId = crypto.randomUUID();
    this.eventId = null;
    this.active = true;
    this.framesCaptured = 0;
    this.framesSurvived = 0;
    this.callsUsed = 0;
    this.itemsInSession = 0;
    this.items = [];
    this.error = null;
    this.video = video;

    this.sampleCanvas = document.createElement("canvas");
    this.sampleCanvas.width = GRID;
    this.sampleCanvas.height = GRID;
    this.uploadCanvas = document.createElement("canvas");

    this.worker = new FrameWorker();
    this.worker.onmessage = (e: MessageEvent) => {
      const { callId, survived } = e.data as { callId: number; survived: boolean };
      const cb = this.pending.get(callId);
      if (cb) {
        this.pending.delete(callId);
        cb({ survived });
      }
    };
    this.worker.postMessage({ type: "reset" });

    this.interval = setInterval(() => void this.tick(), CAPTURE_INTERVAL_MS);
  }

  async end() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    if (this.batch.length > 0) {
      // Flush the last partial batch on the way out.
      try {
        await this.flush();
      } catch (err) {
        console.warn("vision session: final flush failed", err);
      }
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pending.clear();
    this.active = false;
    this.capturing = false;
    this.video = null;
    this.sampleCanvas = null;
    this.uploadCanvas = null;
    this.batch = [];
  }

  private async tick() {
    if (!this.active || this.capReached) return;
    const v = this.video;
    const sample = this.sampleCanvas;
    const worker = this.worker;
    if (!v || !sample || !worker) return;
    if (v.readyState < 2 || v.videoWidth === 0) return;
    if (this.capturing) return; // skip if previous tick is still in flight
    this.capturing = true;

    try {
      const ctx = sample.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, GRID, GRID);
      const data = ctx.getImageData(0, 0, GRID, GRID).data;
      this.framesCaptured++;

      const callId = ++this.nextCallId;
      const buf = data.buffer.slice(0);
      const result = await new Promise<{ survived: boolean }>((resolve) => {
        this.pending.set(callId, resolve);
        worker.postMessage(
          { type: "process", rgba: buf, ts: Date.now(), callId },
          [buf],
        );
      });
      if (!result.survived) return;
      this.framesSurvived++;

      // Encode a higher-res JPEG for upload (no need for full sensor res).
      const blob = await this.encodeForUpload();
      if (!blob) return;
      this.batch.push(blob);
      this.scheduleFlush();
    } finally {
      this.capturing = false;
    }
  }

  private async encodeForUpload(): Promise<Blob | null> {
    const v = this.video;
    const c = this.uploadCanvas;
    if (!v || !c) return null;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh) return null;
    const scale = Math.min(1, UPLOAD_MAX_SIDE / Math.max(vw, vh));
    c.width = Math.max(1, Math.round(vw * scale));
    c.height = Math.max(1, Math.round(vh * scale));
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    return new Promise((resolve) =>
      c.toBlob((b) => resolve(b), FRAME_MIME, UPLOAD_JPEG_QUALITY),
    );
  }

  private scheduleFlush() {
    if (this.batch.length >= UPLOAD_MAX_FRAMES) {
      void this.flush();
      return;
    }
    if (this.batchTimer) return;
    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      void this.flush();
    }, UPLOAD_DEBOUNCE_MS);
  }

  private async flush() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    if (this.batch.length === 0 || this.inFlight) return;
    const frames = this.batch.splice(0, UPLOAD_MAX_FRAMES);
    this.inFlight = true;
    try {
      const fd = new FormData();
      fd.append("session_id", this.sessionId);
      frames.forEach((f, i) => fd.append(`frame_${i}`, f, `frame_${i}.jpg`));
      const res = await fetch("/api/ingest/video-frames", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as {
          calls_used?: number;
          max?: number;
        };
        if (body.calls_used !== undefined) this.callsUsed = body.calls_used;
        if (body.max !== undefined) this.callsMax = body.max;
        return;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`video-frames ${res.status}: ${txt}`);
      }
      const data = (await res.json()) as UploadResponse;
      this.eventId = data.event_id;
      this.callsUsed = data.calls_used;
      this.callsMax = data.max;
      this.itemsInSession = data.items_in_session;
      const now = Date.now();
      for (const p of data.new_items) {
        const item = p.proposed_action.item ?? {};
        this.items = [
          {
            proposal_id: p.id,
            name: item.name_de ?? "?",
            quantity: item.quantity ?? null,
            unit: item.unit ?? null,
            ts: now,
          },
          ...this.items,
        ].slice(0, 30);
      }
    } catch (err) {
      console.warn("video-frames upload failed", err);
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.inFlight = false;
    }
  }

  async finalize(): Promise<string | null> {
    if (!this.sessionId) return null;
    if (this.batch.length > 0) {
      try {
        await this.flush();
      } catch {
        // already logged
      }
    }
    try {
      const res = await fetch(
        `/api/ingest/video-frames/${this.sessionId}/finalize`,
        { method: "POST", credentials: "include" },
      );
      if (res.ok) {
        const data = (await res.json()) as { event_id: string };
        this.eventId = data.event_id;
        return data.event_id;
      }
    } catch (err) {
      console.warn("finalize failed", err);
    }
    return this.eventId;
  }
}
