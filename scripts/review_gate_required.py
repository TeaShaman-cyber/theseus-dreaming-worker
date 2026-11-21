#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys


PROTECTED_PREFIXES = (
    '.github/workflows/',
    'tools/pr/',
    'scripts/codex_review_',
    'tools/ci/',
    'tools/agent/',
    'tools/reverse_trace/',
    'src/dreaming/',
    'src/mastra/gateways/',
    'config/agents/',
    'contracts/',
    'specs/',
)

PROTECTED_EXACT = {
    'scripts/review_gate_required.py',
    'scripts/verify-repo.mjs',
    'tools/dev/check',
    'docs/qa.md',
    'docs/observability.md',
    'AGENTS.md',
    'src/mastra/index.ts',
    'src/mastra/observability-routing.ts',
    'src/mastra/pilot1-tracing.ts',
    'specd.yaml',
    'package.json',
    'pnpm-workspace.yaml',
    'stryker.config.mjs',
}



def parse_paths(raw: bytes, *, nul_delimited: bool) -> list[str]:
    if nul_delimited:
        return [os.fsdecode(part) for part in raw.split(b"\0") if part]
    return [os.fsdecode(line) for line in raw.splitlines()]


def _normalize(path: str) -> str:
    return str(path).replace('\\', '/')


def _reason(path: str) -> str | None:
    if path in PROTECTED_EXACT:
        return 'protected-exact'
    for prefix in PROTECTED_PREFIXES:
        if path.startswith(prefix):
            return f'protected-prefix:{prefix}'
    return None


def classify_paths(paths: list[str]) -> dict[str, object]:
    matches = []
    seen = set()
    for raw in paths:
        path = _normalize(raw)
        if not path or path in seen:
            continue
        seen.add(path)
        reason = _reason(path)
        if reason is not None:
            matches.append({'path': path, 'reason': reason})
    return {'required': bool(matches), 'matches': matches}


def main() -> int:
    nul_delimited = '--nul' in sys.argv[1:]
    unknown = [arg for arg in sys.argv[1:] if arg != '--nul']
    if unknown:
        print('usage: review_gate_required.py [--nul]', file=sys.stderr)
        return 2
    paths = parse_paths(sys.stdin.buffer.read(), nul_delimited=nul_delimited)
    print(json.dumps(classify_paths(paths), sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
