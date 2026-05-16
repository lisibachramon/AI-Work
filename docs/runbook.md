# Runbook

LAN-only deployment. Everything in Docker. Ollama stays on the host.

## First boot

1. Install prerequisites on the home server: Docker, NVIDIA Container Toolkit (for the whisper GPU service), and `mkcert`.

2. Pull the Ollama models the api expects:
   ```sh
   ollama pull qwen2.5:14b-instruct
   ollama pull bge-m3
   ollama pull qwen2.5vl:7b   # optional, only if you flip vision to ollama
   ```

3. Generate a trusted local cert:
   ```sh
   mkcert -install
   mkdir -p data/certs
   # Replace the IP with your home server's LAN IP. Include the hostname too.
   mkcert -cert-file data/certs/kitchen.pem \
          -key-file  data/certs/kitchen-key.pem \
          kitchen.local "*.kitchen.local" 192.168.1.10
   ```

4. Install the mkcert root cert on every device that should use the app (especially the iPhone, otherwise the camera APIs refuse to run):
   - Copy `$(mkcert -CAROOT)/rootCA.pem` to the phone via AirDrop / email.
   - iOS: Settings → General → VPN & Device Management → install profile.
   - iOS: Settings → General → About → Certificate Trust Settings → enable trust for "mkcert".

5. Download the whisper model:
   ```sh
   docker volume create kitchen_whisper-models
   docker run --rm -v kitchen_whisper-models:/models curlimages/curl:8 \
     -L -o /models/ggml-large-v3.bin \
     https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin
   ```

6. Copy `.env.example` to `.env` and edit. At minimum set `POSTGRES_PASSWORD`, `SESSION_SECRET` (`openssl rand -hex 32`), and `ANTHROPIC_API_KEY`. Update `DATABASE_URL` to match `POSTGRES_PASSWORD`.

7. Bring the stack up:
   ```sh
   docker compose up -d --build
   ```

8. Verify health:
   ```sh
   curl -k https://<lan-ip>:8443/health        # api
   curl -k https://<lan-ip>:8443/health/db     # postgres reachable
   curl -k https://<lan-ip>:8443/health/ollama # host Ollama visible from api
   ```

9. Open `https://<lan-ip>:8443/` on your phone and "Add to Home Screen" — that's the PWA install.

## Common ops

**Register the first user.** Use the web UI (`/auth/register` POST) — there's no admin account.

**Seed starter ingredients** for that user:
```sh
docker compose exec -e SEED_USER_EMAIL=you@example.com api node packages/db/dist/seed.js
```

**Tail logs**:
```sh
docker compose logs -f api
docker compose logs -f web
```

**Restore from backup**:
```sh
# DB
docker compose stop api
gunzip -c data/backups/db/dump-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose exec -T postgres psql -U $POSTGRES_USER $POSTGRES_DB
# Uploads
rsync -a data/backups/uploads/ data/uploads/
docker compose start api
```

## MCP

**Claude Desktop stdio (laptop, not server)**: install `kitchen-mcp` from this monorepo (`pnpm --filter @kitchen/mcp build`), then add to your Claude Desktop config:
```json
{
  "mcpServers": {
    "kitchen": {
      "command": "node",
      "args": ["/abs/path/to/ai-work/packages/mcp/dist/stdio.js"],
      "env": {
        "DATABASE_URL": "postgres://kitchen:...@<lan-ip>:5432/kitchen",
        "KITCHEN_USER_ID": "<your-uuid>"
      }
    }
  }
}
```

Postgres must be reachable from the laptop — easiest is to also expose `5432` in `compose.yml` when you're on a trusted LAN, or tunnel via SSH.

**HTTP MCP transport** lands in M3 with token auth.
