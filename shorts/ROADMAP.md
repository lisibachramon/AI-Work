# Roadmap

The revenue-focused features that are NOT yet built. Sorted by expected
revenue lift × build effort. Numbers are honest estimates, not promises.

## Done

- ✅ Title + hook A/B variants
- ✅ Custom thumbnails
- ✅ YouTube Analytics feedback loop (winners → script prompt)
- ✅ Affiliate link injection + click tracking
- ✅ Multi-aspect bundle (9:16 + 1:1 + 16:9 + per-platform JSON)
- ✅ Per-locale channel routing (niche channels)
- ✅ Pinned CTA top-comment
- ✅ Voice cloning (XTTS speaker_wav)
- ✅ **Rising-trend discovery** (Reddit `/r/<country>/rising` + Google Trends daily RSS, normalised + merged + resolved to YouTube videos, ranked above mature trending content via combined-score)
- ✅ **Long-form companion auto-spawn** (daily dispatcher: any Short that crosses `LONGFORM_TRIGGER_VIEWS` within `LONGFORM_TRIGGER_DAYS` triggers a chapter-structured 5–10 min essay render at 1920×1080, with auto-detected YouTube chapter timestamps in the description and an explicit "watch the short version" cross-link)

## Tier 1 — likely to ship next

### TikTok Content Posting API
**Lift:** doubles distribution surface; TikTok Creator Rewards pays
$0.40–$1.00 per 1k views on eligible content. **Effort:** ~3 days
(includes app review, which is the long pole).
**How:** `uploaders/tiktok.py` using the Content Posting API. Reuses the
existing 9:16 render — already in the outbox bundle.

### Comment auto-engagement
**Lift:** comments are a heavy algorithm signal — replying within the
first hour boosts feed surfacing. **Effort:** ~1 day.
**How:** subscribe to YouTube PubSubHubbub for new comments on owned
videos; Claude drafts a friendly reply; auto-post via `commentThreads`
when the reply scores high on a safety check.

### Programmatic thumbnail A/B
**Lift:** CTR delta is real but second-order to having a custom
thumbnail at all (already done). **Effort:** ~1 day.
**How:** generate 3 thumbnail candidates at render time, swap every
24h via `videos.update`, score by per-window CTR from the analytics
sync, keep the winner.

## Tier 2 — quality-of-life multipliers

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
