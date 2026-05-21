from pathlib import Path

from shorts.monetization import AffiliateInjector, load_rules


def _write_rules(tmp_path: Path) -> Path:
    p = tmp_path / "affiliates.yml"
    p.write_text(
        """
rules:
  - slug: gopro
    match: ["gopro", "action camera"]
    amazon_asin: "B0BFP3PCQ4"
  - slug: claude
    match: ["claude"]
    url: "https://claude.ai/referral/abc"
  - slug: missing
    match: ["nothing here"]
    amazon_asin: "ZZ999"
"""
    )
    return p


def test_load_rules_skips_amazon_when_tag_missing(tmp_path: Path):
    rules = load_rules(_write_rules(tmp_path), amazon_tag="")
    # GoPro is amazon-only with no tag → dropped. Claude has a literal URL → kept.
    slugs = [r.slug for r in rules]
    assert "gopro" not in slugs
    assert "claude" in slugs


def test_load_rules_substitutes_amazon_tag(tmp_path: Path):
    rules = load_rules(_write_rules(tmp_path), amazon_tag="lisi-20")
    gopro = next(r for r in rules if r.slug == "gopro")
    assert "tag=lisi-20" in gopro.url
    assert "B0BFP3PCQ4" in gopro.url


def test_matcher_de_dupes_by_slug(tmp_path: Path):
    rules = load_rules(_write_rules(tmp_path), amazon_tag="lisi-20")
    inj = AffiliateInjector(rules, redirect_domain="https://example.com")
    matches = inj.find(
        "I used my GoPro again on this trip. Then my gopro broke. I love Claude.",
        "Action camera review",
    )
    slugs = [m.slug for m in matches]
    assert slugs == ["gopro", "claude"]
    # Each match short_url goes through /go/<slug>
    assert matches[0].short_url == "https://example.com/go/gopro"


def test_description_block_renders_when_matches(tmp_path: Path):
    rules = load_rules(_write_rules(tmp_path), amazon_tag="lisi-20")
    inj = AffiliateInjector(rules, redirect_domain="https://example.com")
    matches = inj.find("My GoPro broke", "")
    block = inj.description_block(matches)
    assert block.startswith("Featured (affiliate):")
    assert "https://example.com/go/gopro" in block


def test_description_block_empty_when_no_matches(tmp_path: Path):
    rules = load_rules(_write_rules(tmp_path), amazon_tag="lisi-20")
    inj = AffiliateInjector(rules, redirect_domain="https://example.com")
    assert inj.description_block(inj.find("nothing relevant", "")) == ""
