# shorts — viral commentary YouTube Shorts pipeline

A self-hosted pipeline that:

1. **Discovers** trending content across DE / EN-US / ES / IN markets
   several times per day from three signal sources: YouTube
   most-popular, TikTok trending (via Apify), and rising topics from
   Reddit + Google Trends (resolved to recent YouTube videos for
   first-mover pickup).
2. **Pulls** random scenes from a Plex library for additional B-roll
   (optional; audio always dropped).
3. **Writes** a 20–40s transformative commentary script with Claude,
   including **N title variants** and **N hook variants** so the worker
   can A/B-test what wins.
4. **Renders** 1080×1920 9:16 shorts with TTS voice-over (locale-aware,
   optional host voice cloning), burned-in karaoke captions, ducked
   royalty-free music bed, ≤8s source cutaway under attribution.
5. **Re-exports** 1×1 and 16×9 siblings so the same render ships to IG
   feed and X / YouTube long-form companion without re-encoding.
6. **Generates** a custom 1280×720 thumbnail with bold title overlay
   from the most cinematic frame.
7. **Injects** affiliate links matching the script's product mentions
   into the description, routing through `/go/<slug>` for click tracking.
8. **Uploads** to YouTube Shorts via the Data API v3 (per-locale
   channel routing if you want niche channels for higher RPM), sets
   the custom thumbnail, optionally posts a CTA top-comment.
9. **Saves** the rendered bundle (mp4 in 3 aspects + srt + per-platform
   metadata files) to an outbox volume for hand-uploading elsewhere.
10. **Learns**: a daily YouTube Analytics sync feeds recent winners
    back to the script writer as few-shot examples, so each new script
    is informed by what's already working on this channel.
11. **Doubles down**: when a Short crosses a configurable view
    threshold, a daily dispatcher auto-spawns a 5–10 minute 1920×1080
    long-form companion essay on the same topic — chapter-structured,
    with auto-detected YouTube chapter timestamps in the description,
    and a "watch the short version" cross-link. Long-form RPM on
    YouTube is 10–50× Shorts RPM, so this is the single
    highest-leverage automation in the project.

Deploys to `shorts.lisibach.xyz` as a separate compose project alongside
the existing kitchen stack on the shared `proxy_default`
nginx-proxy + acme-companion network.

## Why commentary, not re-uploads

Mass re-uploading viral videos gets Content-ID striked within days, and
commercial Plex content is even worse. Transformative commentary with
clear attribution, original voice-over, and ≤8s of source per short is
the only durable posture. The limits are encoded in code (see
`pipeline/clipper.py`) and the policy is in
[`docs/fair-use.md`](docs/fair-use.md).

## Revenue features at a glance

| Feature | Knob in `.env` | What it does |
|---|---|---|
| Title + hook A/B variants | `TITLE_VARIANTS`, `HOOK_VARIANTS` | Each script ships with N alternates, stored in `published.variants_json` |
| Custom thumbnails | `UPLOAD_CUSTOM_THUMBNAIL`, `CHANNEL_NAME` | Pillow-composited 1280×720 thumb attached on upload |
| Multi-aspect bundle | `RENDER_ASPECTS=9x16,1x1,16x9` | 1:1 and 16:9 siblings saved to the outbox |
| Per-platform metadata | (always on) | `tiktok.json`, `instagram.json`, `twitter.json`, `linkedin.json` per video |
| Performance feedback loop | `YT_ANALYTICS_ENABLED=true` | Daily sync of views/retention/revenue; recent winners injected into the script prompt |
| Affiliate link injection | `AFFILIATES_YAML_PATH`, `AMAZON_TAG`, `LINK_REDIRECT_DOMAIN` | Rule-based, click-logged via `/go/<slug>` |
| Pinned CTA comment | `POST_PINNED_COMMENT`, `CTA_COMMENT_TEMPLATE` | Auto-post a top-level comment with your newsletter / sponsor link |
| Voice cloning | `HOST_VOICE_SAMPLE_PATH` | 6–10s host sample → consistent channel identity |
| Per-locale channel routing | `YT_CHANNELS_JSON` | Niche channel per locale = higher RPM |
| Rising-trend discovery | `RISING_TRENDS_ENABLED` | Reddit /rising + Google Trends → YouTube candidates, ranked above mature trending |
| Long-form companion auto-spawn | `LONGFORM_ENABLED`, `LONGFORM_TRIGGER_VIEWS` | Popping Short → 5–10 min essay on same topic at 10–50× the RPM |

See [`ROADMAP.md`](ROADMAP.md) for what's coming next (TikTok direct
upload, comment auto-engagement, programmatic thumbnail A/B).

## Quick start (local dev)

```sh
cd shorts
cp deploy/.env.example app/.env
docker compose -f compose.yml up -d postgres
cd app && uv sync && uv run alembic upgrade head
uv run python -m shorts.jobs.worker --dry-run --locale en-US
```

A dry run skips upload and writes the bundle (mp4-free; metadata only)
to `data/outbox/dry/`.

See [`docs/deploy.md`](docs/deploy.md) for production deploy and
[`docs/runbook.md`](docs/runbook.md) for day-to-day ops including the
one-time YouTube OAuth dance (and how to re-mint with analytics scopes).
