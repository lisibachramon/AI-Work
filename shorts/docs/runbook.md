# Runbook

## One-time: YouTube OAuth refresh token

The uploader needs a refresh token. Do this once on your workstation, not
in the container:

1. In Google Cloud Console (same project as your `YOUTUBE_API_KEY`):
   - Enable the **YouTube Data API v3**.
   - Create an **OAuth 2.0 Client ID** of type **Desktop**. Save the
     client id + secret.
2. On your workstation:
   ```sh
   pip install google-auth-oauthlib
   python - <<'PY'
   from google_auth_oauthlib.flow import InstalledAppFlow
   flow = InstalledAppFlow.from_client_config(
       {"installed": {
           "client_id": "YOUR_CLIENT_ID",
           "client_secret": "YOUR_CLIENT_SECRET",
           "redirect_uris": ["http://localhost"],
           "auth_uri": "https://accounts.google.com/o/oauth2/auth",
           "token_uri": "https://oauth2.googleapis.com/token",
       }},
       scopes=["https://www.googleapis.com/auth/youtube.upload"],
   )
   creds = flow.run_local_server(port=0)
   print("REFRESH:", creds.refresh_token)
   PY
   ```
3. Paste the printed token into `YT_REFRESH_TOKEN` in
   `/home/serverlisibachnet/docker/shorts/.env`, then
   `docker compose up -d api` to pick it up.

## Soak schedule for a fresh channel

YouTube hands out strikes fast on a new account. Bring the stack up in
phases:

| Day | `YT_UPLOAD_PRIVACY` | What you're checking |
|---|---|---|
| 1–2 | `private` | Renders look right; captions readable; durations < 60s |
| 3–4 | `unlisted` | Audio levels; click-through on the title card |
| 5+ | `public` | Watch CMS for Content-ID claims for 7 days |

If you get a Content-ID claim, **don't dispute it from the worker** — open
YouTube Studio, look at what triggered it (usually source audio leaking
through despite `-an`), tighten the limit in `shorts/.env`
(`MAX_SOURCE_CLIP_SECONDS=6` etc.), redeploy, and try again.

## Manual operations

Force a run for one locale:
```sh
curl -X POST 'https://shorts.lisibach.xyz/jobs/run?locale=de'
```

Inspect the queue:
```sh
curl -s https://shorts.lisibach.xyz/queue | jq .
```

Inspect history:
```sh
curl -s https://shorts.lisibach.xyz/history | jq .
```

Mark a candidate as skipped (e.g. to avoid re-rendering after a manual
edit):
```sh
docker compose exec postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB" -c \
  "UPDATE candidates SET status='skipped' WHERE source_id='abc123';"
```

## Pulling rendered bundles for cross-posting

```sh
docker run --rm -v shorts_shorts-outbox:/o alpine ls -lt /o
# pick a bundle:
docker run --rm -v shorts_shorts-outbox:/o alpine \
  tar -czf - -C /o 2026-05-21/abc123-some-slug | \
  ssh me@laptop 'tar -xzf - -C ~/Downloads/shorts/'
```

The bundle contains `final.mp4`, `captions.srt`, `metadata.json`, and
`script.txt` — everything needed to upload manually to TikTok / IG.

## Restore from backup

```sh
cd /home/serverlisibachnet/docker/shorts
docker compose stop api
docker run --rm -v shorts_shorts-backups:/b alpine ls -lt /b/db | head
docker run --rm -i -v shorts_shorts-backups:/b \
  --network shorts_shorts-internal \
  -e PGPASSWORD="$POSTGRES_PASSWORD" \
  postgres:16-alpine sh -c \
  "gunzip -c /b/db/dump-YYYYMMDD-HHMMSS.sql.gz | psql -h postgres -U $POSTGRES_USER $POSTGRES_DB"
docker compose start api
```
