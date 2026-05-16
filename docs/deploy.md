# Deployment

This stack runs as a second compose project alongside your existing
`proxy_default` stack on `lisibach.xyz`. Pre-built images are pushed to
GHCR by GitHub Actions; deploys SSH to the server and roll the containers.

## One-time server setup

1. **Pick a vhost.** Default is `kitchen.lisibach.xyz`. Add the DNS A
   record before the first deploy — the letsencrypt-companion needs to
   pass the HTTP-01 challenge.

2. **Choose the deploy path.** This repo assumes
   `/home/serverlisibachnet/docker/kitchen/`. Create it:
   ```sh
   mkdir -p /home/serverlisibachnet/docker/kitchen
   ```

3. **Seed `.env`.** The first deploy will fail with a clear error if
   `.env` is missing — that's intentional, secrets stay out of git.
   ```sh
   cd /home/serverlisibachnet/docker/kitchen
   # After the first CI run, .env.example will be in this folder. Until
   # then, copy it from the repo manually:
   curl -fsSL -o .env.example \
     https://raw.githubusercontent.com/lisibachramon/AI-Work/main/deploy/.env.example
   cp .env.example .env
   $EDITOR .env
   ```
   At minimum fill in: `KITCHEN_VHOST`, `LETSENCRYPT_EMAIL`,
   `POSTGRES_PASSWORD`, `SESSION_SECRET` (`openssl rand -hex 32`),
   `INVITE_CODE` (`openssl rand -hex 16`), `ANTHROPIC_API_KEY`.

4. **Pull the Ollama models on the host's `ollama` container** so the
   API can call them on first request:
   ```sh
   docker exec ollama ollama pull qwen2.5:7b-instruct
   docker exec ollama ollama pull bge-m3
   ```
   `qwen2.5:7b-instruct` at Q4_K_M is ~4.7 GB resident — fits an RTX
   2060 (6 GB) alongside light open-webui usage. If you want headroom,
   drop to `qwen2.5:3b-instruct` and update `OLLAMA_TEXT_MODEL` in `.env`.

5. **GHCR login on the server** (so `docker compose pull` works). Use a
   Personal Access Token with the `read:packages` scope:
   ```sh
   echo "<your-PAT>" | docker login ghcr.io -u <your-github-user> --password-stdin
   ```
   The CI workflow also logs in fresh on each deploy, so this is only
   needed for manual ops on the server.

6. **Verify the `proxy_default` network exists.** Your main stack
   declares it as its default network — `docker network ls | grep
   proxy_default` should show it. The kitchen stack references it as
   external; deploy will fail with a clear error if it's missing.

## GitHub Secrets

Set these at the **repository** level (Settings → Secrets and variables
→ Actions):

| Secret | Value |
|---|---|
| `DEPLOY_SSH_HOST` | `lisibach.xyz` |
| `DEPLOY_SSH_USER` | `serverlisibachnet` |
| `DEPLOY_SSH_PORT` | (optional, defaults to 22) |
| `DEPLOY_SSH_PASSWORD` | the password (temporary; **switch to a key**, see below) |
| `DEPLOY_SSH_KEY` | (optional) PEM-format SSH private key — if set, used instead of password |
| `DEPLOY_PATH` | `/home/serverlisibachnet/docker/kitchen` |

`GITHUB_TOKEN` is auto-provisioned by Actions and used to push images to
GHCR; no manual setup needed.

### Switching to SSH keys (recommended)

Passwords over SSH for CI work but they're rough — every deploy
authenticates from a different runner IP, and the secret sits in
GitHub. After the first successful deploy, generate a key dedicated to
deploys:

```sh
# on your laptop
ssh-keygen -t ed25519 -f kitchen-deploy -N "" -C "kitchen-ci@$(hostname)"
# install the public half on the server
ssh-copy-id -i kitchen-deploy.pub serverlisibachnet@lisibach.xyz
# paste the private half into the DEPLOY_SSH_KEY GitHub secret
cat kitchen-deploy
# then clear DEPLOY_SSH_PASSWORD in the secret UI (or remove it from the workflow)
# and rotate the original password on the server
passwd # on the server
```

## Deploy

Every push to `main` triggers `.github/workflows/deploy.yml`:

1. Builds `kitchen-api` and `kitchen-web` images, pushes to
   `ghcr.io/lisibachramon/ai-work/kitchen-api:latest` and `:<sha>`.
2. SCP's `deploy/docker-compose.yml` + `deploy/.env.example` to the
   server (overwriting the previous compose file; `.env` is left alone).
3. SSHs in, `docker compose pull api web`, `docker compose up -d`,
   prunes unused images.

For ad-hoc deploys (e.g. you only changed the compose file), trigger
the workflow manually from the Actions tab.

The first request after a deploy that touched the schema runs the
migration (the api container's CMD is `migrate && server`), so deploys
are zero-extra-step for migrations.

## Smoke test after first deploy

```sh
curl -sI https://kitchen.lisibach.xyz/ | head -1            # 200 OK
curl -s   https://kitchen.lisibach.xyz/health               # {"ok":true}
curl -s   https://kitchen.lisibach.xyz/health/db            # {"ok":true}
curl -s   https://kitchen.lisibach.xyz/health/ollama        # {"ok":true,"models":[...]}
```

Open the vhost in a browser; you should see the SPA shell. Register
your first user (paste the `INVITE_CODE` you set in `.env` into the
registration form). Once you're in, rotate `INVITE_CODE` or clear it to
disable further registrations.

## Logs & ops

```sh
cd /home/serverlisibachnet/docker/kitchen
docker compose ps
docker compose logs -f api
docker compose logs -f web
docker compose exec postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

## Restore from backup

```sh
cd /home/serverlisibachnet/docker/kitchen
docker compose stop api
docker run --rm -v kitchen_kitchen-backups:/b alpine ls -lt /b/db | head
docker run --rm -i -v kitchen_kitchen-backups:/b \
  --network kitchen_kitchen-internal \
  -e PGPASSWORD="$POSTGRES_PASSWORD" \
  postgres:16-alpine sh -c \
  "gunzip -c /b/db/dump-YYYYMMDD-HHMMSS.sql.gz | psql -h postgres -U $POSTGRES_USER $POSTGRES_DB"
docker compose start api
```
