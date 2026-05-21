# Deploy

This stack runs as a second compose project alongside the existing
`kitchen` stack on `lisibach.xyz`. Pre-built images are pushed to GHCR
by GitHub Actions; deploys SSH to the server and roll the containers.

## One-time server setup

1. **DNS A record** for `shorts.lisibach.xyz` — must resolve before the
   first deploy or `acme-companion` can't complete the HTTP-01
   challenge.

2. **Deploy path**:
   ```sh
   ssh serverlisibachnet@lisibach.xyz \
     'mkdir -p /home/serverlisibachnet/docker/shorts'
   ```

3. **Seed `.env`**:
   ```sh
   cd /home/serverlisibachnet/docker/shorts
   curl -fsSL -o .env.example \
     https://raw.githubusercontent.com/lisibachramon/AI-Work/main/shorts/deploy/.env.example
   cp .env.example .env
   $EDITOR .env
   ```
   At minimum fill in: `SHORTS_VHOST`, `LETSENCRYPT_EMAIL`,
   `POSTGRES_PASSWORD`, `YOUTUBE_API_KEY`,
   `YT_CLIENT_ID` / `YT_CLIENT_SECRET` / `YT_REFRESH_TOKEN`
   (see [runbook.md](runbook.md) for the one-time OAuth dance), and
   **one of** `CLAUDE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`.

4. **Verify the `proxy_default` network exists** — same one the kitchen
   stack uses:
   ```sh
   docker network ls | grep proxy_default
   ```

5. **GHCR login on the server** with a `read:packages` PAT (already done
   for the kitchen stack; same login works repo-wide).

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
