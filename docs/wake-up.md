# Wake-up note

Two productive sessions while you slept. The first one (M2) shipped the
spine of recipe-cook-shopping. The second one (this morning's batch) added
catalog, ratings, MCP HTTP, embeddings, and the polish that makes the
flow actually feel good.

## What's live now

### Tabs (in nav order)
- **Pantry** — list, expiring-soon filter, location filter, tap quantity to
  edit, +Add, 📷 Photo, big "Cook with N expiring items" CTA at the top
  when items expire within 4 days.
- **Catalog** — all 120+ seeded German/Swiss ingredients grouped by
  category, with a category filter bar. Tap any tile to jump straight to
  add-stock. IngredientSearch at the top with "+ Create" affordance for
  exotic items not yet seeded.
- **Scan** — barcode (ZXing) → OFF lookup + cache → Add → flow handoff.
- **Cook** — recipe list with Suggest panel (max-min/effort/healthiness/
  servings/free-form steer/count), star ratings on the list cards,
  detail with star rating widget + Delete button + "Cooked it"
  decrement.
- **Shop** — shopping list (low essentials, consumed-but-out, recipe gaps)
  plus essentials manager (mark / unmark low, remove, IngredientSearch
  to add new ones).
- **Settings** — account info incl. user UUID for MCP, MCP token create/
  list/revoke (with one-time secret display + copy), "Backfill
  embeddings" action, live API/DB/Ollama health.

### Hidden screens (reachable via flows)
- `/inventory/scan-photo` — multipart upload, Claude vision, redirects to
  proposal review.
- `/inventory/proposals/[id]` — per-item accept/skip with **searchable**
  match picker (IngredientSearch + chips for Claude's top-3 matcher hits +
  inline create when nothing fits).
- `/inventory/add` — manual add with autocomplete; accepts `?gtin=` (scan
  handoff) and `?ingredient_id=&ingredient_name=` (catalog handoff).
- `/cook/[id]` — recipe detail, rating, cook, delete.

### API surfaces
All under `https://kitchen.lisibach.xyz`, session-cookie auth except `/mcp`
which uses Bearer token auth.

- Auth: `/auth/register` (gated by `INVITE_CODE` in prod), `/auth/login`,
  `/auth/logout`, `/auth/me`.
- Ingredients: `GET /api/ingredients/search?q=&semantic=true|false`,
  `GET /api/ingredients?category=`, `POST /api/ingredients`,
  `GET /api/ingredients/:id`.
- Stock: `GET /api/stock?location_id=&expiring_within_days=`,
  `POST /api/stock`, `PATCH /api/stock/:id`, `DELETE /api/stock/:id`.
- Locations: `GET /api/locations`, `POST /api/locations`, `DELETE`.
- Barcode: `GET /api/barcode/:gtin` (cache → OFF, persists).
- Recipes: `POST /api/recipes/suggest`, `GET /api/recipes`,
  `GET /api/recipes/:id`, `PATCH /api/recipes/:id` (rating, title),
  `DELETE /api/recipes/:id`, `POST /api/recipes/:id/cook`.
- Ingest: `POST /api/ingest/photo`, `GET /api/ingest/events`,
  `GET /api/ingest/events/:id`, `POST /api/ingest/events/:id/apply`.
- Essentials: `GET`, `POST`, `DELETE /api/essentials/:ingredient_id`.
- Shopping: `GET /api/shopping-list`.
- Embeddings: `POST /api/embeddings/backfill`.
- MCP tokens: `GET`, `POST`, `DELETE /api/mcp-tokens/:id`.
- MCP transport: `POST /mcp` (JSON-RPC over HTTPS, Bearer auth).

### MCP tools (over both stdio and HTTP)
`list_inventory`, `search_ingredients`, `get_expiring`, `find_recipes`,
`get_recipe`, `get_shopping_list`.

Claude Desktop config for the HTTP transport (no port-forwarding needed,
works from anywhere):
```json
{
  "mcpServers": {
    "kitchen": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-streamable-http",
               "https://kitchen.lisibach.xyz/mcp"],
      "env": { "BEARER_TOKEN": "kmcp_..." }
    }
  }
}
```
(Exact bridge package may vary; or use any MCP client that speaks the
Streamable HTTP transport. The endpoint accepts standard JSON-RPC POSTs.)

## Catalog seed

The starter seed went from 17 to 120 canonical German/Swiss ingredients
across all 11 categories. Swiss-German aliases went from 26 rows to 187
covering dialect forms users actually type (Zucchetti, Gipfeli, Weggli,
Knobli, Rahm, Topfen, Härdöpfel, Süssmost, Crevetten, Spätzli, Glace,
Konfitüre, etc.). If you previously seeded and want the new items, drop
+ reseed:

```sh
docker compose exec postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB" \
  -c "TRUNCATE ingredient_aliases, ingredients RESTART IDENTITY CASCADE;"
docker compose exec -e SEED_USER_EMAIL=r.lisi@me.com api \
  node packages/db/dist/seed.js
```
(This also wipes consumption_events and stock_items because of the CASCADE;
don't run it if you already have stock you care about.)

## Bugs found and fixed during testing

1. **Autocomplete missed obvious queries** ("kart" → no Karotte;
   "milc" → no Vollmilch). Added canonical-name trigram + ILIKE-prefix
   branch and a `to_tsquery(:*)` prefix branch so partial-word queries
   hit inside compound nouns.
2. **Seed alias bug**: `aliasKey()` only handled umlauts, so accented
   keys like `cremefraiche` (for Crème Fraîche) and `gruyere` never
   matched. Extended `aliasKey` with NFKD + diacritic-strip. Alias row
   count went 26 → 187.
3. **Recipe FK risk**: Claude may hallucinate ingredient UUIDs. Added a
   validation pass that nulls out unknown UUIDs before insert.
4. **Cook math edge cases**: defensive guard against non-finite or
   non-positive quantity from Claude (sometimes emits 0 for "to taste").
5. **Build order**: api now depends on `@kitchen/mcp` for the HTTP
   transport. Updated Dockerfile + CI workflow to build mcp before api.

## Verified locally (against pgvector + pg_trgm)

- 13-query autocomplete sweep: kart, milc, oliv, hähn, poul, peterli,
  rüebli, salz, brot, kar, milch, tomat, apfel, jog, zucchetti, gipfeli,
  weggli, knobli, rahm, topfen — all resolve.
- Cook flow cross-unit: recipe asks 240g carrots, stock is 5 pieces
  (typical_piece_weight_g=80), engine takes 3 pieces FIFO from
  earliest-expiry, writes consumption_events in stock units.
- Cook flow with multiple units: 240g + 200g chicken (g stock) — both
  decrement, transaction commits.
- Rate 5 / rate null / delete: round-trip clean.
- Create new ingredient (Topinambur) → POST returns row, search
  immediately returns it canonical match 1.0.
- Essentials: mark Salz as essential → low → shows in shopping-list
  with reason `low_essential`. Tomate that was consumed but isn't in
  stock shows with `consumed_recently` + `recipe_gap`.
- MCP HTTP: create token → unauthenticated POST → 401 with
  `WWW-Authenticate: Bearer`. With token: initialize → handshake;
  tools/list → 6 tools; tools/call get_expiring → empty array.
  After DELETE: subsequent calls 401.
- Auth gating: every authed API route returns 401 without cookie or
  token.
- 10 Vitest cases for the unit converter pass; runs in CI.

## Untested from here (network policy)

- Claude OAuth (`/api/recipes/suggest`, `/api/ingest/photo`) — needs
  CLAUDE_OAUTH_TOKEN set on the server.
- OpenFoodFacts barcode lookups for unknown GTINs.
- Ollama embedding backfill — needs bge-m3 pulled on the host container.

## What you should test first (in order)

1. **`docker compose pull api web && docker compose up -d --force-recreate`** on the server.
2. **Browse `/catalog`** — sanity-check that 120 items rendered, filter by
   category.
3. **Add an item from catalog** — tap any tile, you should land on add
   with the ingredient pre-selected.
4. **Try `Cook with N expiring items` on `/inventory`** — fires Claude.
   - 502 → see `docker compose logs api | tail -50`, almost always a
     `CLAUDE_OAUTH_TOKEN` / model-name issue.
5. **Mint an MCP token in `/settings`** → copy → configure Claude Desktop
   over HTTP. Ask it "Was kann ich heute Abend kochen?" — should call
   `list_inventory` + `find_recipes` against your real pantry.
6. **Run "Backfill embeddings"** in `/settings`. Then search `?semantic=true`
   on something funky like "wurzelgemüse" — should pull up
   Karotte/Sellerie via the cosine path.

## What's still NOT done

- Voice ingestion (Whisper would fight your RTX 2060 with Ollama).
- Live video scanner with vision mode (M3 by design).
- Stock detail screen (only quantity is inline-editable; location/expiry/
  notes need the PATCH endpoint wired into a proper edit form).
- Recipe URL import.
- Multi-user invites UI (the schema is multi-user-ready but there's no
  invite flow).
- Usage-rates materialized view + "you usually have X" panel.

## If something looks wrong

```sh
cd /home/serverlisibachnet/docker/kitchen
docker compose pull api web
docker compose up -d --force-recreate
docker compose logs -f api      # watch what happens

# Auth check
docker compose exec api env | grep -E 'CLAUDE_OAUTH|ANTHROPIC' | sort

# Verify the new tables / data
docker compose exec postgres sh -c \
  'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -c "SELECT count(*) FROM ingredients;"'
```

## What I'd build next

In priority order — call your shots:

1. Stock detail screen with full edit form (location, expiry, notes,
   opened_at).
2. Usage-rates materialized view (nightly refresh) + a "low" indicator
   on shopping list.
3. Recipe URL import (paste a URL, Claude extracts ingredients +
   instructions).
4. Multi-user UX (invites, household sharing).
5. Voice ingestion if you decide to give whisper VRAM.
6. iOS PWA polish (touch targets, native share to add, etc).

Sleep well. Open `/catalog` first thing — it's the most fun. ❤️
