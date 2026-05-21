# Roadmap

The revenue-focused features that are NOT yet built. Sorted by expected
revenue lift × build effort. Numbers are honest estimates, not promises.

## Tier 1 — likely to ship next

### Long-form companion auto-spawn
**Lift:** ~10–50× per-video revenue when a short pops. Long-form RPM is
$3–$15 vs. Shorts at $0.05–$0.15. **Effort:** ~2 days.
**How:** when a `Published` row crosses `LONGFORM_VIEW_THRESHOLD` (e.g.
25k views in 48h, queried via Performance), enqueue a `longform`
pipeline run. Same source, longer Claude script (700–1500 words),
extended B-roll plan, 16:9 1080p render, `#shorts` removed from title.

### Rising-trend discovery (first-mover bonus)
**Lift:** ~2–5× pickup rate when you publish *before* a topic peaks.
**Effort:** ~1 day.
**How:** add `discovery/trends.py` that pulls Reddit `/r/all/rising`
posts + Google Trends daily-trending RSS, and merges into the candidate
queue with a `rising_score` overriding view-velocity for content < 6h
old.

### TikTok Content Posting API
**Lift:** doubles distribution surface; TikTok Creator Rewards pays
$0.40–$1.00 per 1k views on eligible content. **Effort:** ~3 days
(includes app review).
**How:** `uploaders/tiktok.py` using the Content Posting API. Reuses the
existing 9:16 render — already in the outbox bundle.

## Tier 2 — quality-of-life multipliers

### Comment auto-engagement
**Lift:** comments are a heavy algorithm signal — replying within the
first hour boosts feed surfacing. **Effort:** ~1 day.
**How:** subscribe to YouTube PubSubHubbub for new comments on owned
videos; Claude drafts a friendly reply; auto-post via `commentThreads`
when the reply scores high on a safety check.

### Newsletter capture funnel
**Lift:** owned audience is the only revenue independent of platform
algorithm whims. **Effort:** half a day.
**How:** the `cta_comment_template` already wires up; add a beehiiv /
Substack subscribe endpoint proxy at `/subscribe` so the CTA URL points
in-house and clicks are logged like affiliates.

### Sponsor-fit detector
**Lift:** opens direct deal revenue once you have >10k subs/locale.
**Effort:** ~1 day.
**How:** when discovery hits a topic, embed-search a `sponsors.yml`
(brand → vertical) and flag a sponsorship opportunity row for the
operator.

## Tier 3 — would be cool, not load-bearing

- **Programmatic thumbnail A/B:** generate 3 thumbnail candidates, swap
  every 24h via `videos.update`, keep the winner. Currently we just
  ship the best single thumbnail.
- **Voice clone bank per locale:** different host voice per locale to
  match the audience's expected accent. Already supported via
  `HOST_VOICE_SAMPLE_PATH`; just needs per-locale env wiring.
- **Background music selection by emotion:** Claude tags the script's
  mood, looks up a matching royalty-free bed from a tagged library.
- **Real-time CTR / retention dashboard:** an HTMX page on `/dashboard`
  charting `performance` by day.

## Explicitly NOT planned

- **Mass-reuploading.** This is what triggers channel termination
  inside two weeks. The fair-use posture in `docs/fair-use.md` is the
  business model — there is no path to abandoning it that ends well.
- **Buying views / subs.** YouTube purges synthetic views every quarter
  and the cleanup often takes monetization with it.
- **Auto-disputing Content-ID strikes.** Disputes go to the rights
  holder. Automation here is a fast track to termination.
