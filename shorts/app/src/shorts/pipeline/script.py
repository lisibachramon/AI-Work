"""Commentary script generation via Claude.

The provider router mirrors the kitchen stack: prefer CLAUDE_OAUTH_TOKEN
(subscription billing), fall back to ANTHROPIC_API_KEY. If neither is
set, raise — there's no sensible Ollama fallback for tight 30s on-camera
copy.
"""

from __future__ import annotations

from dataclasses import dataclass

import anthropic

from shorts.config import Settings

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


SYSTEM = """You write short-form commentary scripts for YouTube Shorts.

Output JSON only, with keys: title, body, description, tags.

Constraints:
- The "body" is a voice-over script in the requested language. Aim for
  90–140 spoken words (≈20–40 seconds at normal pace). Tight, opinionated,
  fair-use commentary — NOT a re-narration of the source. Open with a hook,
  give your take in 2–3 beats, end with a kicker.
- The "title" must be ≤80 characters and end with " #shorts".
- "description" cites the source (channel + URL) and ends with the line
  "Commentary, criticism & news — fair use.".
- "tags" is 5–10 lowercase strings, no '#'.
"""


class ScriptWriter:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = _make_client(settings)
        self.model = settings.anthropic_script_model

    async def write(
        self,
        *,
        locale: str,
        source_title: str,
        source_channel: str,
        source_url: str,
    ) -> CommentaryScript:
        lang = LOCALE_LANGUAGE.get(locale, "English")
        user = (
            f"Source title: {source_title}\n"
            f"Source channel: {source_channel}\n"
            f"Source URL: {source_url}\n"
            f"Target language: {lang}\n"
            f"Write the JSON now."
        )
        msg = await self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            system=SYSTEM,
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

    # Be tolerant — Claude occasionally wraps JSON in a code fence.
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
    title = str(data["title"]).strip()
    if "#shorts" not in title.lower():
        title = f"{title} #shorts"
    return CommentaryScript(
        title=title[:90],
        body=str(data["body"]).strip(),
        description=description,
        tags=[str(t).lstrip("#").lower() for t in data.get("tags", [])][:12],
    )
