#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import pathlib
import sys
from typing import Any


def normalize_pages(value: Any) -> list[list[dict[str, Any]]]:
    if not isinstance(value, list):
        raise ValueError("malformed pull files payload")
    if all(isinstance(item, dict) for item in value):
        return [value]
    pages: list[list[dict[str, Any]]] = []
    for page in value:
        if not isinstance(page, list) or not all(isinstance(item, dict) for item in page):
            raise ValueError("malformed pull files payload")
        pages.append(page)
    return pages


def extract_changed_paths(value: Any, *, expected_count: int) -> list[str]:
    if expected_count < 0:
        raise ValueError("expected changed-file count must be non-negative")

    pages = normalize_pages(value)
    entries = [item for page in pages for item in page]

    if len(entries) != expected_count:
        raise ValueError(
            f"incomplete pull files payload: expected {expected_count}, observed {len(entries)}"
        )

    paths: list[str] = []
    for item in entries:
        filename = item.get("filename")
        if not isinstance(filename, str) or not filename:
            raise ValueError("malformed pull files payload")

        if item.get("status") == "renamed":
            previous = item.get("previous_filename")
            if not isinstance(previous, str) or not previous:
                raise ValueError("malformed pull files payload")
            paths.append(previous)

        paths.append(filename)

    return paths


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--files", type=pathlib.Path, required=True)
    parser.add_argument("--expected-count", type=int, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()

    try:
        payload = json.loads(args.files.read_text(encoding="utf-8"))
        paths = extract_changed_paths(payload, expected_count=args.expected_count)
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"review-gate: {exc}", file=sys.stderr)
        return 1

    args.output.write_bytes(
        b"\0".join(path.encode("utf-8") for path in paths)
        + (b"\0" if paths else b"")
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
