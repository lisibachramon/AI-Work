# Wake-up note

You're now at M2. Here's what changed while you slept, what works, what
to test first, and what to do if something's wrong.

## What landed (latest commit `ce9b62e`)

Three CI rounds ran cleanly. The deploy workflow pushed:

- `kitchen-api:latest` + `kitchen-web:latest` to GHCR.
- New compose stays the same — `docker compose pull && docker compose
  up -d` on the server picks up the M2 code.

## New routes & UI

- **/cook** — recipe list with a "Suggest" panel. Set filters
  (max_minutes, effort, healthiness, servings) and a free-form prompt
  hint ("vegetarian today", "use the spinach"), hit Generate, Claude
  Sonnet writes 1-8 recipes against your pantry. Each suggestion is
  persisted regardless of whether you cook it so the catalogue grows.
- **/cook/[id]** — full recipe with ingredient list (unlinked items
  badged) and instructions. Servings stepper lets you scale. Big
  "Cooked it — decrement pantry" button runs the real engine: FIFO by
  expiry date, cross-unit conversion via density / typical piece
  weight, transactional decrement + `consumption_events` + soft-delete
  at 0 + `times_cooked++`. Returns missing items if you were short.
- **/inventory/scan-photo** — file picker with capture=environment so
  iOS opens the camera directly. Image is downscaled to ≤1568px JPEG
  q82, posted to `/api/ingest/photo`, which calls Claude Sonnet vision
  with a strict JSON schema, resolves each proposed name against your
  ingredient catalogue (top-3 candidates), and persists proposals.
- **/inventory/proposals/[id]** — review screen. Per-item: accept
  toggle, match dropdown (pre-selected when match score ≥ 0.6),
  quantity/unit/location/expiry editors. Apply writes accepted items
  to stock with `source=photo` and `source_event_id` pointing back at
  the event — every batch is reversible at the DB level if needed.
- **/inventory** quantity adjust — tap a quantity in any row to change
  it via a prompt. Setting 0 soft-deletes. Useful when you eat half a
  bag of carrots and want to keep the pantry honest without cooking a
  whole recipe.
- **Banner** on /inventory when there are needs_review events
  outstanding so you don't lose track of photo runs.

## API additions

- `POST /api/recipes/suggest` (Claude OAuth required)
- `GET /api/recipes` (list, last 50)
- `GET /api/recipes/:id` (full detail)
- `POST /api/recipes/:id/cook`
- `POST /api/ingest/photo` (multipart; Claude OAuth required)
- `GET /api/ingest/events` (needs_review queue)
- `GET /api/ingest/events/:id`
- `POST /api/ingest/events/:id/apply`
- `GET /api/shopping-list` — low essentials + recently-consumed-but-out
  + recent-recipe gaps
- `PATCH /api/stock/:id` — quantity / expiry / location / notes

## MCP tools (for Claude Desktop)

New tools available on top of the M1 read-only set:

- `find_recipes(query?, effort?, max_minutes?, limit?)` — search your
  saved recipes
- `get_recipe(recipe_id)` — full instructions + ingredients
- `get_shopping_list()` — same three buckets as the API

So in Claude Desktop you can now actually plan a meal end-to-end without
opening the web app.

## Bugs I fixed during testing

Spun up a local postgres+pgvector+pg_trgm here in the sandbox and ran
real curl flows against the api. Found and fixed:

1. **Autocomplete missed obvious queries.** "kart" didn't match
   "Karotte", "milc" didn't match "Vollmilch", "poul" didn't match
   "Hähnchenbrust". The old matcher only ran trigram on aliases (not
   canonical names) and German FTS doesn't accept prefixes. Added a
   canonical trigram + ILIKE-prefix branch plus a `to_tsquery(:*)`
   branch so partial-word queries hit inside compound nouns. Final
   sweep of 13 queries all resolve correctly.

2. **Seed alias bug.** `SWISS_ALIASES` keys like `"haehnchen"` didn't
   match the normalized canonical names ("haehnchenbrust") my seed
   computed, so Hähnchenbrust never got Pouletbrust / Poulet / Huhn
   aliases. Realigned keys, added more useful surface forms
   (Vollmilch ← "Milch", plural forms, common typos).

3. **Recipe suggestion FK risk.** Claude may hallucinate ingredient
   UUIDs that don't exist in your catalogue. Added a validation pass:
   we now query the user's ingredients table for which proposed UUIDs
   are real, null out the rest before insert. Hallucinated items
   appear in the cook detail as "unlinked" and get skipped cleanly by
   the cook engine.

4. **Cook flow cross-unit.** Verified the converter end-to-end: recipe
   says 240 g of Karotten, stock is 5 pieces (typical_piece_weight_g
   = 80 g), engine takes 3 pieces FIFO from earliest expiry, records
   consumption in stock units. Vitest covers 10 unit-converter cases
   incl. the impossible ones (piece→ml without density).

## What you should test first

In rough order of "tells you a lot if it works":

1. **Login** → /inventory shows your 2 stock items (probably) and the 4
   seeded locations. If 502 / blank, the deploy didn't finish or
   `.env` regressed.

2. **Suggest a recipe** — /cook → Suggest → leave defaults → Generate.
   This is the biggest "did Claude OAuth actually wire up" moment.
   - **Works** → you get 3 recipes with ingredient lists. Open one.
   - **502 "LLM call failed"** → `docker compose logs api | tail -50`
     on the server. Look for the exact error. Most likely culprits:
     - `CLAUDE_OAUTH_TOKEN` not set or stale → re-run `claude
       setup-token` and paste the new value
     - Model name wrong → check `ANTHROPIC_*_MODEL` env vs what your
       Claude.ai account has access to
     - `anthropic-beta` header rejected → bump
       `ANTHROPIC_OAUTH_BETA` in `.env` if Anthropic announced a
       newer version

3. **Cook a recipe** — open any recipe, hit "Cooked it". Check
   /inventory after — quantities should have dropped, expired items
   FIFO'd first.

4. **Photo ingestion** — /inventory → "📷 Photo" → take a fridge or
   shelf photo. Same OAuth dependency as #2. Returns proposals; review
   them on the next screen. Apply moves the accepted ones into stock.

5. **Scan a real product** — /scan with a Migros / Coop / Volg item.
   First scan goes to OFF; ~50-60% hit rate. The rest you link
   manually via "Add →" + autocomplete, and we cache the GTIN so the
   next scan is instant.

6. **Shopping list** — /shopping screen. Mark items as essentials (top
   bar "+ Add"), toggle "low" on any. The shopping list combines three
   buckets: low essentials, things consumed in the last 14 days that
   you no longer have, and ingredients in your recent recipes you're
   missing.

## Pending work (transparent about what's NOT done)

- **No voice ingestion.** Whisper.cpp sidecar would fight the RTX
  2060 with your existing Ollama. Deferred until you decide whether to
  trade Ollama VRAM for live-voice or run whisper on CPU.

- **No live video scanner with vision mode.** M3 by design; barcode
  scanner already works (M1).

- **MCP HTTP transport.** Still stdio-only. M3.

- **Embedding backfill** for `ingredients.embedding`. The fuzzy
  matcher already works well without it (verified across 13 query
  variants); the embedding column is just unused. Easy to backfill
  later with a one-shot script against your local Ollama bge-m3.

- **Stock screen edit (full)** — quantity is editable inline via
  prompt(); location/expiry/notes need a proper detail screen.

## If something looks wrong

Server-side:

```sh
cd /home/serverlisibachnet/docker/kitchen
docker compose pull api web       # ensure :latest
docker compose up -d --force-recreate
docker compose logs -f api        # watch what happens on requests
```

If the api crashes on boot with a migration error, the schema fix from
earlier should have stuck — but if you're seeing it, drop the
`__drizzle_migrations` table and let it re-run. The Drizzle migration
is idempotent at the table-creation level (every CREATE has `IF NOT
EXISTS` via the bootstrap SQL).

If Claude calls fail consistently, isolate auth:

```sh
docker compose exec api env | grep -E 'CLAUDE_OAUTH|ANTHROPIC' | sort
```

A token of the form `sk-ant-oat01-...` is OAuth. Make sure
`CLAUDE_OAUTH_TOKEN` is set (the api prefers it over
`ANTHROPIC_API_KEY` when both are present).

## What I'd build next session

In priority order (call your shots when you're back):

1. Embedding backfill job + nightly refresh.
2. Stock detail screen with proper edit form (location/expiry/notes
   beyond just quantity).
3. MCP HTTP transport + token UI in /settings (so you don't need a
   port forward to use kitchen-mcp from anywhere).
4. Recipe rating + ditching bad suggestions.
5. Voice ingestion (only if you're willing to give whisper VRAM).

That's it. Coffee, then go press Suggest.
