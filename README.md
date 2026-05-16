# Kitchen

Self-hosted kitchen inventory + AI recipe planner. German/Swiss-first. Runs entirely in Docker on a home server; reuses the host's existing Ollama for embeddings and cheap structured parsing; calls Claude for vision and recipe generation; exposes the pantry to Claude Desktop / Claude Code via MCP.

## Layout

- `packages/shared` — Zod schemas, units, German text utils. Shared by api/mcp/web.
- `packages/db` — Drizzle schema, migrations, seed, the ingredient matcher.
- `packages/api` — Fastify app: auth, ingredients, locations, stock, barcode, ingestion, recipes (later).
- `packages/mcp` — MCP server exposing the pantry as tools (stdio first; HTTP in M3).
- `packages/web` — SvelteKit PWA, installs to iOS home screen via mkcert HTTPS.
- `services/whisper` — whisper.cpp HTTP service on the host GPU.
- `deploy/` — production compose stack + `.env.example` for the home-server deployment.
- `.github/workflows/` — CI (build & typecheck on every push) and Deploy (build → push to GHCR → SSH-roll the server on push to `main`).
- `docs/runbook.md` — local LAN setup with mkcert HTTPS.
- `docs/deploy.md` — public-web deployment via your existing nginx-proxy / letsencrypt-companion stack, with the GitHub Secrets list.

## Milestones

- **M1** — Pantry that works: schema, auth, manual quick-add with autocomplete, barcode scan + OpenFoodFacts cache, full compose stack.
- **M2** — AI ingestion + recipes: voice + photo ingestion, ingestion-proposal review UI, recipe suggestion + cook flow.
- **M3** — Live video + MCP: live-video barcode/vision scanner, MCP HTTP transport + tokens, usage stats, shopping list.

See `/root/.claude/plans/prepare-everything-for-my-velvety-summit.md` for the full plan.

## Dev

```sh
pnpm install
docker compose up -d postgres   # just the db
pnpm --filter @kitchen/db migrate
pnpm --filter @kitchen/api dev
pnpm --filter @kitchen/web dev
```
