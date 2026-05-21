"""Commentary script generation via Claude.

The provider router mirrors the kitchen stack: prefer CLAUDE_OAUTH_TOKEN
(subscription billing), fall back to ANTHROPIC_API_KEY. If neither is
set, raise — there's no sensible Ollama fallback for tight 30s on-camera
copy.

Each generation returns N title variants + N hook (first-3s) variants in
addition to the chosen body, so the worker can A/B and the analytics
feedback loop can rank what works.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import anthropic

from shorts.config import Settings

if TYPE_CHECKING:
    from shorts.analytics.feedback import Winner


LOCALE_LANGUAGE = {
    "de": "German",
    "en-US": "American English",
    "es": "Spanish",
    "in": "Hindi (Devanagari script)",
}


@dataclass(slots=True)
class CommentaryScript:
    title: str  # YouTube title, ≤90 chars, must include #shorts
    body: str  # the spoken VO, 20–40s of speech
    description: str  # YouTube description with attribution
    tags: list[str]
    hook: str  # the chosen first-3s opener (also the first sentence of body)
    title_variants: list[str] = field(default_factory=list)
    hook_variants: list[str] = field(default_factory=list)


def _system(*, n_titles: int, n_hooks: int) -> str:
    return f"""You write short-form commentary scripts for YouTube Shorts.

Output JSON only, with keys: title, body, description, tags, title_variants, hook_variants.

Constraints:
- "body" is a voice-over script in the requested language. 90–140 spoken
  words (≈20–40 seconds). Open with a 3-second hook that earns the swipe
  away, then 2–3 punchy beats, then a kicker. Tight, opinionated,
  transformative commentary — NOT a re-narration of the source.
- "title" is ≤80 characters and ends with " #shorts".
- "title_variants" is exactly {n_titles} alternative titles, each ≤80
  chars, each ending with " #shorts". Use distinctly different angles
  (curiosity, list-style, controversy, payoff-promise).
- "hook_variants" is exactly {n_hooks} alternative first sentences for
  the body — each one designed as a 3-second swipe-stopper. Pick varied
  patterns: a counterintuitive claim, a contrarian question, a number-
  stat surprise, a "you've been lied to" reveal.
- "description" cites the source (channel + URL) and ends with the line
  "Commentary, criticism & news — fair use.".
- "tags" is 5–10 lowercase strings, no '#'.

The first sentence of "body" MUST be one of the entries in "hook_variants".
"""


class ScriptWriter:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = _make_client(settings)
        self.model = settings.anthropic_script_model
        self.n_titles = max(1, settings.title_variants)
        self.n_hooks = max(1, settings.hook_variants)

    async def write(
        self,
        *,
        locale: str,
        source_title: str,
        source_channel: str,
        source_url: str,
        winners: list[Winner] | None = None,
    ) -> CommentaryScript:
        from shorts.analytics.feedback import format_for_prompt

        lang = LOCALE_LANGUAGE.get(locale, "English")
        winners_block = format_for_prompt(winners or [])
        user = (
            f"Source title: {source_title}\n"
            f"Source channel: {source_channel}\n"
            f"Source URL: {source_url}\n"
            f"Target language: {lang}\n"
            + (f"\n{winners_block}\n" if winners_block else "")
            + "\nWrite the JSON now."
        )
        msg = await self.client.messages.create(
            model=self.model,
            max_tokens=1500,
            system=_system(n_titles=self.n_titles, n_hooks=self.n_hooks),
            messages=[{"role": "user", "content": user}],
        )
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        return _parse(text, fallback_attribution=(source_channel, source_url))


def _make_client(s: Settings) -> anthropic.AsyncAnthropic:
    if s.claude_oauth_token:
        return anthropic.AsyncAnthropic(
            auth_token=s.claude_oauth_token,
            default_headers={"anthropic-beta": s.anthropic_oauth_beta},
        )
    if s.anthropic_api_key:
        return anthropic.AsyncAnthropic(api_key=s.anthropic_api_key)
    raise RuntimeError(
        "Neither CLAUDE_OAUTH_TOKEN nor ANTHROPIC_API_KEY is set; "
        "cannot generate commentary scripts."
    )


def _parse(text: str, *, fallback_attribution: tuple[str, str]) -> CommentaryScript:
    import json

    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        cleaned = cleaned.removeprefix("json").strip()
    data = json.loads(cleaned)
    channel, url = fallback_attribution
    description = str(data.get("description", "")).strip()
    if channel not in description or url not in description:
        description = f"{description}\n\nSource: {channel} — {url}".strip()
    if "fair use" not in description.lower():
        description = f"{description}\n\nCommentary, criticism & news — fair use."
    title = _ensure_shorts(str(data["title"]).strip())[:90]
    body = str(data["body"]).strip()
    title_variants = [
        _ensure_shorts(str(t).strip())[:90] for t in data.get("title_variants", []) if t
    ]
    hook_variants = [str(h).strip() for h in data.get("hook_variants", []) if h]
    hook = hook_variants[0] if hook_variants else body.split(".")[0]
    return CommentaryScript(
        title=title,
        body=body,
        description=description,
        tags=[str(t).lstrip("#").lower() for t in data.get("tags", [])][:12],
        hook=hook,
        title_variants=title_variants,
        hook_variants=hook_variants,
    )


def _ensure_shorts(title: str) -> str:
    return title if "#shorts" in title.lower() else f"{title} #shorts"
