# Design: verified-session-work

## Non-goals

No new reader, API, model stage, production access, persistence or batch acknowledgement.

## Affected areas

- `src/dreaming/verified-session-work.ts` — strict synthetic adapter and bounded page verification.
- `test/verified-session-work.test.mjs` — actual disposable PG/reader fixture plus counterexamples and existing durable runner replay.
- `docs/ledger-neon.md` — exact source and consumer boundaries.

## Approach

Decode the existing source candidate against independent expected state. Validate trusted source index fields and accepted artifact references. Consume caller-acquired bounded pages, compare pinned session and generation, all exact ordered metadata, codepoint offsets, terminal and digest of reconstructed text. No network in this function. Prepare existing durable input only with nonblank evidence. Use stable scoped tuple digest (JS-local, versioned) over metadata excluding archive/generation; preserve entire selected source metadata and candidate identity separately. Python content digest is opaque custody metadata, not a generic JS hash.

## Testing

Real synthetic Python-produced bundles loaded in disposable PostgreSQL 16 and read by existing router/shard handlers; recorded pages, negative cases and durable runner with synthetic adapters. Existing QA.

## Spec impact

Refines synthetic intake, no real access or checkpoint advancement.
