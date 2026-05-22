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


ScriptKind = str  # "short" | "longform"


@dataclass(slots=True)
class Chapter:
    title: str
    body: str  # spoken text for this chapter


@dataclass(slots=True)
class CommentaryScript:
    title: str  # YouTube title
    body: str  # the spoken VO (concatenation of chapters for long-form)
    description: str  # YouTube description with attribution
    tags: list[str]
    hook: str
    kind: ScriptKind = "short"
    title_variants: list[str] = field(default_factory=list)
    hook_variants: list[str] = field(default_factory=list)
    chapters: list[Chapter] = field(default_factory=list)


def _system_short(*, n_titles: int, n_hooks: int) -> str:
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


def _system_longform(*, n_titles: int) -> str:
    return f"""You write long-form video essay scripts (5–10 minutes spoken) for YouTube.

Output JSON only, with keys: title, chapters, description, tags, title_variants.

Constraints:
- "chapters" is an array of 5–8 chapter objects. Each object has:
    "title" (≤60 chars; reads cleanly in a description timestamp)
    "body" (the spoken VO for that chapter, 80–180 words)
  Together the chapters should total roughly 700–1500 words.
- The first chapter is an intro with a strong hook. The last chapter is
  a conclusion / call-to-subscribe.
- Tight, opinionated commentary in the requested language. Do NOT
  re-narrate the source — interpret, contextualise, take positions.
- "title" is ≤80 characters. Do NOT include "#shorts".
- "title_variants" is exactly {n_titles} alternative titles, ≤80 chars
  each, no "#shorts". Different framings (curiosity, list-style, deep-
  dive, controversy).
- "description" cites the source (channel + URL), includes the line
  "Commentary, criticism & news — fair use.", and ends with the marker
  "[CHAPTERS]" on its own line — the worker fills in chapter
  timestamps after it knows the VO timing. Don't add timestamps yourself.
- "tags" is 8–15 lowercase strings, no '#'.
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
        kind: ScriptKind = "short",
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
        system = (
            _system_longform(n_titles=self.n_titles)
            if kind == "longform"
            else _system_short(n_titles=self.n_titles, n_hooks=self.n_hooks)
        )
        max_tokens = 8000 if kind == "longform" else 1500
        msg = await self.client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        return _parse(text, fallback_attribution=(source_channel, source_url), kind=kind)


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


def _parse(
    text: str, *, fallback_attribution: tuple[str, str], kind: ScriptKind = "short"
) -> CommentaryScript:
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

    if kind == "longform":
        chapters_raw = data.get("chapters", [])
        chapters = [
            Chapter(title=str(c.get("title", "")).strip()[:60], body=str(c.get("body", "")).strip())
            for c in chapters_raw
            if c.get("body")
        ]
        body = "\n\n".join(c.body for c in chapters).strip()
        title = str(data["title"]).strip()[:80]
        title_variants = [str(t).strip()[:80] for t in data.get("title_variants", []) if t]
        hook = chapters[0].body.split(".")[0] if chapters else body.split(".")[0]
        return CommentaryScript(
            title=title,
            body=body,
            description=description,
            tags=[str(t).lstrip("#").lower() for t in data.get("tags", [])][:15],
            hook=hook,
            kind="longform",
            title_variants=title_variants,
            chapters=chapters,
        )

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
        kind="short",
        title_variants=title_variants,
        hook_variants=hook_variants,
    )


def _ensure_shorts(title: str) -> str:
    return title if "#shorts" in title.lower() else f"{title} #shorts"
