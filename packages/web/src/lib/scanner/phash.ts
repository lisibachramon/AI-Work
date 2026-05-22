// Tiny image fingerprint + motion helpers used by the vision-mode scanner.
// Inputs are always a 64x64 grayscale Uint8Array (4096 bytes). The caller
// (main thread) draws the live <video> onto a 64x64 <canvas> and passes the
// resulting RGBA ImageData; rgbaToGrayscale64 collapses it to one byte/pixel.
//
// All exports here are pure — no DOM, no worker globals — so they run in
// Vitest without ceremony.

export const GRID = 64;
export const BLOCKS = 8;

// A pixel difference above this (0-255) counts as "changed" for motion gating.
export const PIXEL_DIFF_THRESHOLD = 25;

// Fraction of the 64x64 grid that must change for the frame to be "in motion".
export const MOTION_THRESHOLD = 0.025;

// Hamming distance ≤ this within the recent history = the same shot, drop it.
export const PHASH_DUPLICATE_HAMMING = 6;

export function rgbaToGrayscale64(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const n = GRID * GRID;
  if (rgba.length !== n * 4) {
    throw new Error(`rgbaToGrayscale64: expected ${n * 4} bytes, got ${rgba.length}`);
  }
  const out = new Uint8Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    // ITU-R BT.601 luma
    out[j] = (0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!) | 0;
  }
  return out;
}

// Fraction of pixels that differ between two 64x64 grayscale frames by more
// than PIXEL_DIFF_THRESHOLD. 0 = identical, 1 = every pixel differs.
export function motionScore(prev: Uint8Array, curr: Uint8Array): number {
  if (prev.length !== curr.length) {
    throw new Error("motionScore: length mismatch");
  }
  let changed = 0;
  for (let i = 0; i < prev.length; i++) {
    const d = prev[i]! - curr[i]!;
    if ((d < 0 ? -d : d) > PIXEL_DIFF_THRESHOLD) changed++;
  }
  return changed / prev.length;
}

// 64-bit average-hash perceptual fingerprint over an 8x8 block grid.
export function avgHash(grayscale64: Uint8Array): bigint {
  if (grayscale64.length !== GRID * GRID) {
    throw new Error("avgHash: expected 64x64 grayscale");
  }
  const cells = new Uint8Array(BLOCKS * BLOCKS);
  const block = GRID / BLOCKS; // 8
  for (let by = 0; by < BLOCKS; by++) {
    for (let bx = 0; bx < BLOCKS; bx++) {
      let sum = 0;
      const y0 = by * block;
      const x0 = bx * block;
      for (let y = y0; y < y0 + block; y++) {
        for (let x = x0; x < x0 + block; x++) {
          sum += grayscale64[y * GRID + x]!;
        }
      }
      cells[by * BLOCKS + bx] = sum >> 6; // /64
    }
  }
  let total = 0;
  for (let i = 0; i < cells.length; i++) total += cells[i]!;
  const mean = total / cells.length;
  let bits = 0n;
  for (let i = 0; i < cells.length; i++) {
    bits = (bits << 1n) | (cells[i]! > mean ? 1n : 0n);
  }
  return bits;
}

// Hamming distance between two 64-bit fingerprints.
export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  // Split into two 32-bit halves so we can use the SWAR popcount trick.
  const lo = Number(x & 0xffffffffn) >>> 0;
  const hi = Number((x >> 32n) & 0xffffffffn) >>> 0;
  return popcount32(lo) + popcount32(hi);
}

function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (Math.imul(v, 0x01010101) >>> 24) & 0xff;
}
