# Deploy

This stack runs as a second compose project alongside the existing
`kitchen` stack on `lisibach.xyz`. Pre-built images are pushed to GHCR
by GitHub Actions; deploys SSH to the server and roll the containers.

## One-time server setup

1. **DNS A record** for `shorts.lisibach.xyz` — must resolve before the
   first deploy or `acme-companion` can't complete the HTTP-01
   challenge.

2. **Verify the `proxy_default` network exists** (the kitchen stack
   already declares it, so this is normally already true):
   ```sh
   docker network ls | grep proxy_default
   ```

3. **GHCR login on the server** with a `read:packages` PAT (one-time;
   the kitchen stack already does this).

Everything else is handled by the first deploy run. The workflow:

- creates `/home/serverlisibachnet/docker/shorts/` if missing,
- SCPs `docker-compose.yml`, `.env.example`, `affiliates.example.yml`,
  and `bootstrap_env.py`,
- on first deploy (when `.env` is missing) runs `bootstrap_env.py` which
  copies `.env.example` → `.env`, generates a fresh
  `POSTGRES_PASSWORD`, and **inherits** the following keys from the
  kitchen stack's `.env`:
    - `LETSENCRYPT_EMAIL`
    - `CLAUDE_OAUTH_TOKEN`
    - `ANTHROPIC_API_KEY`
    - `ANTHROPIC_OAUTH_BETA`
    - `WHISPER_BASE_URL`
    - `OLLAMA_BASE_URL`
- pulls the image and rolls the stack.

After the first deploy, the stack is healthy on `/health` but pipeline
jobs will throw until you populate the remaining placeholders via SSH:

```sh
ssh serverlisibachnet@lisibach.xyz
cd /home/serverlisibachnet/docker/shorts
nano .env   # fill in YOUTUBE_API_KEY, YT_*, optionally PEXELS_API_KEY etc.
docker compose restart api
```

See [runbook.md](runbook.md) for how to mint the YouTube OAuth refresh
token (`YT_REFRESH_TOKEN`).

## GitHub Secrets

In addition to the kitchen stack's `DEPLOY_SSH_*` secrets, add:

| Secret | Value |
|---|---|
| `DEPLOY_PATH_SHORTS` | `/home/serverlisibachnet/docker/shorts` |

## Deploy

Every push to `main` that touches `shorts/**` triggers
`.github/workflows/deploy-shorts.yml`:

1. Builds `shorts-api`, pushes to
   `ghcr.io/lisibachramon/ai-work/shorts-api:latest` and `:<sha>`.
2. SCPs `shorts/deploy/docker-compose.yml` + `shorts/deploy/.env.example`
   to the server.
3. SSHs in, `docker compose pull api`, `docker compose up -d`, prunes.

For ad-hoc deploys, trigger the workflow manually from the Actions tab.

## Smoke test

```sh
curl -sI https://shorts.lisibach.xyz/                  # 200
curl -s  https://shorts.lisibach.xyz/health            # {"ok":true}
curl -s  https://shorts.lisibach.xyz/health/db         # {"ok":true}
curl -s  https://shorts.lisibach.xyz/health/youtube    # {"ok":true}
curl -s  https://shorts.lisibach.xyz/health/whisper    # {"ok":true}
```

Manually trigger one locale to confirm the full pipeline works before
trusting the scheduler:

```sh
curl -X POST 'https://shorts.lisibach.xyz/jobs/run?locale=en-US&dry_run=true'
```

## Logs & ops

```sh
cd /home/serverlisibachnet/docker/shorts
docker compose ps
docker compose logs -f api
docker compose exec postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB"
ls -lt /home/serverlisibachnet/docker/shorts && docker volume inspect shorts_shorts-outbox
```
