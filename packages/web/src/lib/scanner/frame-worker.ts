// Vision-mode frame filter. Lives in a Web Worker so motion + pHash run off
// the main thread, leaving the camera preview and UI smooth on phones.
//
// Protocol (main thread sends, worker replies):
//
//   { type: "reset" }             — clear last-frame and history
//   { type: "process", rgba: ArrayBuffer (64*64*4 RGBA bytes), ts: number }
//   ← { type: "result", survived, motionScore, phashHex, hamming, callId }
//
// The main thread transfers the rgba buffer to avoid a copy. The worker keeps
// `lastGrayscale` and a 30-second rolling phash history.

import {
  GRID,
  MOTION_THRESHOLD,
  PHASH_DUPLICATE_HAMMING,
  avgHash,
  hamming,
  motionScore,
  rgbaToGrayscale64,
} from "./phash.ts";

const HISTORY_TTL_MS = 30_000;

interface Entry {
  phash: bigint;
  ts: number;
}

let lastGrayscale: Uint8Array | null = null;
let history: Entry[] = [];

interface ProcessMessage {
  type: "process";
  rgba: ArrayBuffer;
  ts: number;
  callId: number;
}

interface ResetMessage {
  type: "reset";
}

type IncomingMessage = ProcessMessage | ResetMessage;

self.onmessage = (e: MessageEvent<IncomingMessage>) => {
  const msg = e.data;
  if (msg.type === "reset") {
    lastGrayscale = null;
    history = [];
    return;
  }

  const view = new Uint8ClampedArray(msg.rgba);
  if (view.length !== GRID * GRID * 4) {
    self.postMessage({
      type: "result",
      callId: msg.callId,
      survived: false,
      error: "bad_frame_size",
    });
    return;
  }

  const grayscale = rgbaToGrayscale64(view);
  const score = lastGrayscale ? motionScore(lastGrayscale, grayscale) : 1;
  const isFirst = lastGrayscale === null;
  lastGrayscale = grayscale;

  const phash = avgHash(grayscale);
  const now = msg.ts;
  history = history.filter((h) => now - h.ts < HISTORY_TTL_MS);
  let minHam = Infinity;
  for (const h of history) {
    const d = hamming(h.phash, phash);
    if (d < minHam) minHam = d;
  }

  // First frame: pretend there was motion (so the first survivor lands), but
  // still subject to history dedupe (history is empty on session start).
  const inMotion = isFirst || score >= MOTION_THRESHOLD;
  const isDuplicate = Number.isFinite(minHam) && minHam <= PHASH_DUPLICATE_HAMMING;
  const survived = inMotion && !isDuplicate;
  if (survived) history.push({ phash, ts: now });

  self.postMessage({
    type: "result",
    callId: msg.callId,
    survived,
    motionScore: score,
    phashHex: phash.toString(16).padStart(16, "0"),
    hamming: Number.isFinite(minHam) ? minHam : null,
  });
};
