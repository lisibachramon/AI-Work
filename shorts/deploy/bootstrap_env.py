#!/usr/bin/env python3
"""Idempotent .env bootstrap. Run by deploy-shorts.yml on every deploy.

If .env doesn't exist next to .env.example, this:
1. Copies .env.example to .env.
2. Replaces POSTGRES_PASSWORD with a fresh random secret.
3. Inherits a whitelist of keys from the kitchen stack's .env, when present,
   so the operator doesn't have to retype Claude OAuth / Let's Encrypt
   email / Whisper URL / Ollama URL across two stacks.
4. Leaves everything else as the placeholder from .env.example, so the
   operator can fill in stack-specific keys (YouTube, Pexels, etc.) later
   via SSH.

Safe to run repeatedly — it no-ops when .env already exists.
"""

from __future__ import annotations

import os
import re
import secrets
import sys
from pathlib import Path

# Whitelist of keys that are safe + meaningful to share between stacks.
INHERIT = (
    "LETSENCRYPT_EMAIL",
    "CLAUDE_OAUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_OAUTH_BETA",
    "WHISPER_BASE_URL",
    "OLLAMA_BASE_URL",
)


def parse_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v
    return out


def main() -> int:
    deploy_dir = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    kitchen_env = Path(os.environ.get("KITCHEN_ENV_PATH", "/home/serverlisibachnet/docker/kitchen/.env"))
    env_path = deploy_dir / ".env"
    example_path = deploy_dir / ".env.example"

    if env_path.exists():
        print(f".env already present at {env_path} — leaving it alone")
        return 0

    if not example_path.exists():
        print(f"ERROR: {example_path} not found; cannot bootstrap", file=sys.stderr)
        return 2

    print(f"bootstrapping {env_path} from {example_path}")
    env_path.write_text(example_path.read_text())
    env_path.chmod(0o600)

    overrides: dict[str, str] = {"POSTGRES_PASSWORD": secrets.token_hex(24)}
    kitchen_values = parse_env(kitchen_env)
    if kitchen_values:
        inherited = {k: v for k, v in kitchen_values.items() if k in INHERIT and v}
        print(f"inheriting {len(inherited)} key(s) from {kitchen_env}: {sorted(inherited)}")
        overrides.update(inherited)
    else:
        print(f"WARNING: kitchen .env not found at {kitchen_env}; shared values stay as placeholders")

    seen: set[str] = set()
    out_lines: list[str] = []
    for line in env_path.read_text().splitlines(keepends=True):
        m = re.match(r"^([A-Z_][A-Z0-9_]*)=", line)
        if m and m.group(1) in overrides:
            key = m.group(1)
            out_lines.append(f"{key}={overrides[key]}\n")
            seen.add(key)
        else:
            out_lines.append(line)
    for k, v in overrides.items():
        if k not in seen:
            out_lines.append(f"{k}={v}\n")
    env_path.write_text("".join(out_lines))
    env_path.chmod(0o600)
    print("bootstrap complete; remaining placeholders to fill via SSH:")
    for line in env_path.read_text().splitlines():
        if line.endswith("=__set_me__") or re.match(r"^[A-Z_][A-Z0-9_]*=$", line):
            print(f"  {line.split('=', 1)[0]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
