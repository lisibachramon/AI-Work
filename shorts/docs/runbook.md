# Runbook

## One-time: YouTube OAuth refresh token (uploads + comments + thumbnails)

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

The uploader actually requests these two scopes by default:
- `youtube.upload` — `videos.insert`
- `youtube.force-ssl` — `commentThreads.insert` (pinned-CTA comment) +
  `thumbnails.set` (custom thumbnail)

If you ever re-mint the token, change the `scopes=[...]` list in the
snippet above to:
```python
scopes=[
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.force-ssl",
]
```

## Re-mint for analytics (unlocks the feedback loop)

The script writer learns from past performance via the
`/jobs/analytics-sync` job, but that needs additional scopes the
upload-only token doesn't have. To turn this on:

1. Re-run the OAuth script with these scopes:
   ```python
   scopes=[
       "https://www.googleapis.com/auth/youtube.upload",
       "https://www.googleapis.com/auth/youtube.force-ssl",
       "https://www.googleapis.com/auth/yt-analytics.readonly",
       "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
   ]
   ```
2. Replace `YT_REFRESH_TOKEN` in `.env` with the new value.
3. Set `YT_ANALYTICS_ENABLED=true`.
4. `docker compose up -d api`, then trigger a one-off sync:
   ```sh
   curl -X POST https://shorts.lisibach.xyz/jobs/analytics-sync
   ```
5. After a few uploads have collected real metrics, hit
   `https://shorts.lisibach.xyz/revenue` for the per-locale rollup.

## Affiliate setup (passive revenue layer)

1. Get an Amazon Associates account (https://affiliate-program.amazon.com)
   and put your tag (e.g. `lisi-20`) into `AMAZON_TAG`.
2. Drop a populated `affiliates.yml` into the `shorts-assets` volume.
   Local copy first:
   ```sh
   scp shorts/deploy/affiliates.example.yml \
       serverlisibachnet@lisibach.xyz:/tmp/affiliates.yml
   ```
   Then copy it into the volume via a one-shot container:
   ```sh
   docker run --rm -v shorts_shorts-assets:/a -v /tmp/affiliates.yml:/in:ro \
     alpine sh -c "cp /in /a/affiliates.yml && chmod 644 /a/affiliates.yml"
   ```
   The file is hot-loaded on every render — no restart required.
3. Set `LINK_REDIRECT_DOMAIN=https://shorts.lisibach.xyz` so emitted
   short links route through `/go/<slug>` and get click-logged.
4. View clicks at `https://shorts.lisibach.xyz/revenue` →
   `affiliate_clicks`.

## Host-voice cloning (consistent channel identity)

1. Record a 6–10 second clean WAV of your voice (no music, minimal
   noise). Sample rate doesn't matter — XTTS resamples.
2. Drop it into the `shorts-assets` volume as `host_voice.wav`:
   ```sh
   docker run --rm -v shorts_shorts-assets:/a -v /tmp/voice.wav:/in:ro \
     alpine cp /in /a/host_voice.wav
   ```
3. `HOST_VOICE_SAMPLE_PATH=/assets/host_voice.wav` is the default in
   `.env.example`. Leave empty to fall back to the built-in XTTS speaker.

## Multi-channel routing (niche channels = higher RPM)

By default all locales upload to the same channel. To split per locale
(e.g. a separate German news channel from the English entertainment
channel), do the OAuth dance once per channel and put the results in
`YT_CHANNELS_JSON`:

```bash
YT_CHANNELS_JSON='{"de":{"client_id":"...","client_secret":"...","refresh_token":"..."},"en-US":{"refresh_token":"..."}}'
```

Locales not in the dict fall through to the global `YT_*` values. The
analytics sync respects the same routing — each locale's videos query
that locale's channel.

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
