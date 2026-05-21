# Fair-use posture

This pipeline produces **transformative commentary shorts** about
trending YouTube and TikTok content, plus optional B-roll filler from a
personal Plex library. The aim is to stay within YouTube's
[Fair Use guidelines](https://support.google.com/youtube/answer/9783148)
indefinitely, not "until we get caught."

The posture is encoded in code so the renderer fails closed rather than
relying on operator discipline:

| Constraint | Where it lives |
|---|---|
| ≤8 seconds of any single source clip | `shorts/app/src/shorts/pipeline/clipper.py::cut` (raises `ClipTooLong`) |
| Source audio always dropped | same file — `-an` is hard-coded on the ffmpeg command |
| Original voice-over track is mandatory | `shorts/app/src/shorts/jobs/worker.py` — render fails if VO synthesis fails |
| Music-content title blocklist | `shorts/app/src/shorts/pipeline/rank.py::is_blocked` |
| Source attribution baked into the description | `shorts/app/src/shorts/pipeline/script.py::_parse` |
| Source attribution baked on-screen (end card) | `shorts/app/src/shorts/pipeline/compose.py` — `drawtext` overlay |
| Fair-use disclaimer line in description | same `_parse` — always appended |

## Plex content specifically

Plex content is **never** the subject of a short — it's used only as
visual filler under unrelated commentary VO, and audio is always
dropped. Even so, you assume some risk by including it; the
`PLEX_BASE_URL` / `PLEX_TOKEN` env vars are optional and the pipeline
runs fine without them.

## When this posture is not enough

- **Music videos / official audio.** Content-ID will hit you regardless
  of clip length or commentary. The title blocklist tries to filter
  them at discovery; if one slips through, set the candidate's
  `status='skipped'` manually and the worker will skip it next run.
- **DMCA strikes from rights-holders.** Disable uploads for the affected
  locale (`LOCALES=` env), do not dispute the strike from the worker —
  open YouTube Studio manually.
- **Repeat offenders or a "third strike" warning.** Set
  `YT_UPLOAD_PRIVACY=private`, redeploy, and reassess the source
  blocklist before re-enabling public uploads.

## What this posture is NOT

It is not legal advice. The constraints above approximate the
**substantiality** and **transformative purpose** prongs of US fair use
and YouTube's working interpretation thereof; the **market harm** prong
is the one you can't encode in ffmpeg flags. If you ever monetise or
target a market that's actively going after creators, get a lawyer.
