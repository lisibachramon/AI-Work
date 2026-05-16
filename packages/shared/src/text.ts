// German + Swiss-German text utilities for matching and search.

const UMLAUT_MAP: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  Ä: "Ae",
  Ö: "Oe",
  Ü: "Ue",
  ß: "ss",
};

// Canonicalize for matching: lowercase, expand umlauts, strip diacritics, collapse whitespace.
export function normalizeGerman(input: string): string {
  return input
    .replace(/[äöüÄÖÜß]/g, (c) => UMLAUT_MAP[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Cheap Levenshtein-based similarity in [0, 1] for short strings. For the DB we use pg_trgm;
// this exists for client-side tiebreakers in autocomplete.
export function similarity(a: string, b: string): number {
  const an = normalizeGerman(a);
  const bn = normalizeGerman(b);
  if (an === bn) return 1;
  if (an.length === 0 || bn.length === 0) return 0;
  const dp: number[][] = Array.from({ length: an.length + 1 }, () => new Array(bn.length + 1).fill(0));
  for (let i = 0; i <= an.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= bn.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= an.length; i++) {
    for (let j = 1; j <= bn.length; j++) {
      const cost = an[i - 1] === bn[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  const dist = dp[an.length]![bn.length]!;
  return 1 - dist / Math.max(an.length, bn.length);
}

// Swiss-German diminutive aliases worth seeding alongside Standard German names.
// Lookup is normalized → canonical; canonical is also normalized for storage.
export const SWISS_ALIASES: Record<string, string[]> = {
  petersilie: ["peterli"],
  karotte: ["rueebli", "rüebli"],
  brot: ["broetli", "brötli"],
  haehnchen: ["pouletbrust", "poulet", "hähnchen"],
  zwiebel: ["boelle", "böle"],
  kartoffel: ["herdoepfel", "härdöpfel", "gschwellti"],
};
