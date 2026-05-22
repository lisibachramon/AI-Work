"""Rule-based affiliate link injection.

A small YAML config maps keywords/regexes to affiliate URL templates. When
the script body or source title mentions a matching product, we append a
short link to the description so the click revenue stacks on top of ad
revenue. Links route through /go/<slug> on the public vhost so clicks are
logged in the affiliate_clicks table.

YAML format (see deploy/affiliates.example.yml):

    rules:
      - slug: gopro-hero
        match: ["gopro", "action camera"]
        amazon_asin: "B0BFP3PCQ4"
      - slug: claude-pro
        match: ["claude", "anthropic"]
        url: "https://claude.ai/referral/your-code"

Amazon links are built from AMAZON_TAG; everything else is a literal URL.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass(slots=True)
class AffiliateRule:
    slug: str
    patterns: list[re.Pattern]
    url: str  # the final affiliate URL (Amazon tag already substituted)


@dataclass(slots=True)
class AffiliateMatch:
    slug: str
    keyword: str  # the surface form that matched
    affiliate_url: str
    short_url: str  # the /go/<slug> route on the public vhost


def load_rules(yaml_path: Path | str, *, amazon_tag: str = "") -> list[AffiliateRule]:
    """Parse the affiliates YAML. Missing file → empty rules list (no-op)."""
    p = Path(yaml_path)
    if not p.exists():
        return []
    raw = yaml.safe_load(p.read_text()) or {}
    rules: list[AffiliateRule] = []
    for entry in raw.get("rules", []):
        slug = str(entry["slug"]).strip()
        url = _resolve_url(entry, amazon_tag=amazon_tag)
        if not url:
            continue
        patterns = [
            re.compile(rf"\b{re.escape(m)}\b", re.IGNORECASE)
            for m in entry.get("match", [])
            if isinstance(m, str) and m.strip()
        ]
        if not patterns:
            continue
        rules.append(AffiliateRule(slug=slug, patterns=patterns, url=url))
    return rules


def _resolve_url(entry: dict, *, amazon_tag: str) -> str:
    if "amazon_asin" in entry:
        asin = entry["amazon_asin"].strip()
        if not amazon_tag:
            return ""  # silently drop if the user hasn't set their tag yet
        return f"https://www.amazon.com/dp/{asin}?tag={amazon_tag}"
    return str(entry.get("url", "")).strip()


class AffiliateInjector:
    def __init__(self, rules: list[AffiliateRule], *, redirect_domain: str = "") -> None:
        self.rules = rules
        self.redirect_domain = redirect_domain.rstrip("/")

    def find(self, *haystacks: str) -> list[AffiliateMatch]:
        """Return matches in source-text order, de-duped by slug."""
        seen: set[str] = set()
        matches: list[AffiliateMatch] = []
        text = "\n".join(haystacks)
        for rule in self.rules:
            if rule.slug in seen:
                continue
            for pat in rule.patterns:
                m = pat.search(text)
                if m:
                    matches.append(
                        AffiliateMatch(
                            slug=rule.slug,
                            keyword=m.group(0),
                            affiliate_url=rule.url,
                            short_url=self._short(rule.slug, rule.url),
                        )
                    )
                    seen.add(rule.slug)
                    break
        return matches

    def _short(self, slug: str, fallback: str) -> str:
        if not self.redirect_domain:
            return fallback
        return f"{self.redirect_domain}/go/{slug}"

    def description_block(self, matches: Iterable[AffiliateMatch]) -> str:
        """Format matches as a YouTube-description-friendly link list."""
        m = list(matches)
        if not m:
            return ""
        lines = ["Featured (affiliate):"] + [f"• {x.keyword.title()} — {x.short_url}" for x in m]
        return "\n".join(lines)
