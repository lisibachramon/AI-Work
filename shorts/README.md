# shorts — viral commentary YouTube Shorts pipeline

A self-hosted pipeline that:

1. Discovers trending YouTube + TikTok content across DE / EN-US / ES / IN
   markets several times per day.
2. Pulls random scenes from a Plex library for additional B-roll.
3. Has Claude write a 20–40s **commentary script** in the target language.
4. Renders a 1080×1920 9:16 short with TTS voice-over, burned-in captions,
   royalty-free music bed, attribution end card, and an optional ≤8s
   cutaway of the source.
5. Uploads to YouTube Shorts via the Data API v3 and **saves the rendered
   `.mp4` + `.srt` + `metadata.json` to an outbox volume** so the same
   bundle can be hand-uploaded to TikTok / Instagram / etc. later.

Deploys to `shorts.lisibach.xyz` as a separate compose project alongside
the existing kitchen stack on the shared `proxy_default`
nginx-proxy + acme-companion network.

## Why commentary, not re-uploads

Mass re-uploading viral videos gets Content-ID striked within days, and
commercial Plex content is even worse. Transformative commentary with
clear attribution, original voice-over, and ≤8s of source per short is
the only durable posture. The limits are encoded in code (see
`pipeline/clipper.py`) and the policy is written up in
[`docs/fair-use.md`](docs/fair-use.md).

## Quick start (local dev)

```sh
cd shorts
cp deploy/.env.example app/.env
docker compose -f compose.yml up -d postgres
cd app && uv sync && uv run alembic upgrade head
uv run python -m shorts.jobs.worker --dry-run --locale en-US
```

A dry run skips upload and writes the bundle to `data/outbox/dry/`.

See [`docs/deploy.md`](docs/deploy.md) for production deploy and
[`docs/runbook.md`](docs/runbook.md) for day-to-day ops.
