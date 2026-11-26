"""Research-only lexical guard. Standard parser, no repair or coercion."""
import json
import sys


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate decoded key")
        result[key] = value
    return result


def reject_constant(_):
    raise ValueError("nonstandard constant")


try:
    raw = sys.stdin.buffer.read(65537)
    if len(raw) > 65536:
        raise ValueError("too large")
    json.loads(raw.decode("utf-8", errors="strict"),
               object_pairs_hook=unique_object, parse_constant=reject_constant)
except (ValueError, UnicodeError, RecursionError):
    sys.exit(2)
