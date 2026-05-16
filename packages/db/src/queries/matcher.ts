// Resolve a free-text ingredient name to a canonical ingredient row.
// Used by manual autocomplete, voice/photo/video ingestion, barcode resolution,
// and the MCP search_ingredients tool.
//
// Order:
//   1. exact canonical match on ingredients.canonical_name_de (unaccented)
//   2. exact alias hit on ingredient_aliases
//   3. trigram similarity on alias + tsvector match on canonical_name_de,
//      ranked by greatest(similarity, ts_rank); threshold 0.2
//   4. (optional) embedding cosine search if a query embedding is supplied
//
// Callers decide whether to auto-link (score >= AUTO_LINK_THRESHOLD) or surface review.

import { sql } from "drizzle-orm";
import type { DbClient } from "../client.js";
import { ingredients } from "../schema/index.js";

export interface MatchCandidate {
  ingredient_id: string;
  canonical_name_de: string;
  score: number;
  matched_via: "canonical" | "alias" | "trigram" | "tsv" | "prefix" | "embedding";
}

export interface MatchOptions {
  userId: string;
  query: string;
  queryEmbedding?: number[];
  limit?: number;
}

export async function matchIngredient(
  db: DbClient,
  opts: MatchOptions,
): Promise<MatchCandidate[]> {
  const limit = opts.limit ?? 10;
  const q = opts.query.trim();
  if (q.length === 0) return [];

  const exact = await db
    .select({ id: ingredients.id, name: ingredients.canonical_name_de })
    .from(ingredients)
    .where(
      sql`${ingredients.user_id} = ${opts.userId} AND lower(unaccent(${ingredients.canonical_name_de})) = lower(unaccent(${q}))`,
    )
    .limit(1);
  if (exact[0]) {
    return [
      {
        ingredient_id: exact[0].id,
        canonical_name_de: exact[0].name,
        score: 1,
        matched_via: "canonical",
      },
    ];
  }

  // The query combines four match strategies and takes the best score per
  // ingredient:
  //   - alias trigram + alias exact ILIKE
  //   - canonical-name trigram + canonical-name prefix ILIKE
  //   - tsvector match via the german_unaccent FTS config (whole-word)
  // pg_trgm's % operator uses pg_trgm.similarity_threshold (default 0.3);
  // we also explicitly score with similarity() so prefix-only hits like
  // "kart" → "Karotte" rank reasonably.
  const prefix = `${q.replace(/[%_]/g, "\\$&")}%`;
  const rows = await db.execute<{
    ingredient_id: string;
    canonical_name_de: string;
    score: number;
    matched_via: "trigram" | "tsv" | "alias" | "prefix";
  }>(sql`
    WITH alias_match AS (
      SELECT
        a.ingredient_id,
        i.canonical_name_de,
        GREATEST(
          similarity(unaccent(a.alias), unaccent(${q})),
          CASE WHEN unaccent(a.alias) ILIKE unaccent(${q}) THEN 1.0 ELSE 0 END
        ) AS score,
        CASE WHEN unaccent(a.alias) ILIKE unaccent(${q}) THEN 'alias' ELSE 'trigram' END AS matched_via
      FROM ingredient_aliases a
      JOIN ingredients i ON i.id = a.ingredient_id
      WHERE i.user_id = ${opts.userId}
        AND (unaccent(a.alias) % unaccent(${q}) OR unaccent(a.alias) ILIKE unaccent(${q}))
    ),
    canonical_match AS (
      SELECT
        i.id AS ingredient_id,
        i.canonical_name_de,
        GREATEST(
          similarity(unaccent(i.canonical_name_de), unaccent(${q})),
          CASE WHEN unaccent(i.canonical_name_de) ILIKE unaccent(${prefix}) THEN 0.85 ELSE 0 END
        ) AS score,
        CASE WHEN unaccent(i.canonical_name_de) ILIKE unaccent(${prefix}) THEN 'prefix' ELSE 'trigram' END AS matched_via
      FROM ingredients i
      WHERE i.user_id = ${opts.userId}
        AND (
          unaccent(i.canonical_name_de) % unaccent(${q})
          OR unaccent(i.canonical_name_de) ILIKE unaccent(${prefix})
        )
    ),
    fts_match AS (
      SELECT
        i.id AS ingredient_id,
        i.canonical_name_de,
        ts_rank(i.name_tsv, websearch_to_tsquery('german_unaccent', ${q})) AS score,
        'tsv' AS matched_via
      FROM ingredients i
      WHERE i.user_id = ${opts.userId}
        AND i.name_tsv @@ websearch_to_tsquery('german_unaccent', ${q})
    ),
    fts_prefix_match AS (
      -- to_tsquery's :* operator does prefix matching on tokens, which
      -- catches "milc" → "Vollmilch" (token "milch" prefix-matches "milc").
      -- websearch_to_tsquery doesn't support :* so we build the query
      -- manually after sanitizing: trim, drop empty/short tokens.
      SELECT
        i.id AS ingredient_id,
        i.canonical_name_de,
        0.5 AS score,
        'tsv' AS matched_via
      FROM ingredients i
      WHERE i.user_id = ${opts.userId}
        AND length(trim(${q})) >= 2
        AND i.name_tsv @@ to_tsquery(
          'german_unaccent',
          regexp_replace(trim(${q}), '\s+', ':* & ', 'g') || ':*'
        )
    ),
    combined AS (
      SELECT * FROM alias_match
      UNION ALL
      SELECT * FROM canonical_match
      UNION ALL
      SELECT * FROM fts_match
      UNION ALL
      SELECT * FROM fts_prefix_match
    )
    SELECT ingredient_id, canonical_name_de, MAX(score) AS score,
           (ARRAY_AGG(matched_via ORDER BY score DESC))[1] AS matched_via
    FROM combined
    GROUP BY ingredient_id, canonical_name_de
    HAVING MAX(score) >= 0.2
    ORDER BY score DESC
    LIMIT ${limit}
  `);

  const candidates: MatchCandidate[] = rows.map((r) => ({
    ingredient_id: r.ingredient_id,
    canonical_name_de: r.canonical_name_de,
    score: Number(r.score),
    matched_via: r.matched_via,
  }));

  if (opts.queryEmbedding && opts.queryEmbedding.length > 0) {
    const vec = `[${opts.queryEmbedding.join(",")}]`;
    const embedRows = await db.execute<{
      ingredient_id: string;
      canonical_name_de: string;
      score: number;
    }>(sql`
      SELECT i.id AS ingredient_id, i.canonical_name_de,
             1 - (i.embedding <=> ${vec}::vector) AS score
      FROM ingredients i
      WHERE i.user_id = ${opts.userId}
        AND i.embedding IS NOT NULL
      ORDER BY i.embedding <=> ${vec}::vector
      LIMIT ${limit}
    `);
    for (const r of embedRows) {
      const score = Number(r.score);
      if (score < 0.7) continue;
      const existing = candidates.find((c) => c.ingredient_id === r.ingredient_id);
      if (existing) {
        if (score > existing.score) {
          existing.score = score;
          existing.matched_via = "embedding";
        }
      } else {
        candidates.push({
          ingredient_id: r.ingredient_id,
          canonical_name_de: r.canonical_name_de,
          score,
          matched_via: "embedding",
        });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
  }

  return candidates.slice(0, limit);
}

export const AUTO_LINK_THRESHOLD = 0.9;
export const SUGGEST_THRESHOLD = 0.4;
