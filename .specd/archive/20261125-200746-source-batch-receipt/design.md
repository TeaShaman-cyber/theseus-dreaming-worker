# Design: source-batch-receipt

## Non-goals

No new DB, schema migration, scheduler, source access, model stage or live permissions.

## Affected areas

- `src/dreaming/source-batch-receipt.ts` — exact portable acknowledgement candidate builder.
- `test/source-batch-receipt.test.mjs` — synthetic real producer/reader fixture, durable completion and counterexamples.
- `docs/ledger-neon.md` — limitations.

## Approach

Decode once against independent expected state, require a nonempty exact selected set, derive each verified session input using the same task/version and bounds. Use existing work preparation and readVerifiedCompletion, check every proposal source reference against admitted evidence. Store current witness separately from original packet IDs. Stable JS-local canonical sorted-key receipt digest, no evidence text. Return PENDING or STORAGE_UNKNOWN for missing/corrupt completion. Invalid input throws before reads. No storage write authority. Future storage will bind predecessor chain and readback.

## Testing

Existing recorded SS pages, synthetic durable runner, missing/duplicate/extra selection, missing/corrupt completion and mismatched source refs. Canonical QA and exact-head review.

## Spec impact

Refines synthetic checkpoint candidate only.
