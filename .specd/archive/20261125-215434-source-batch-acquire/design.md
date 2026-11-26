# Design: source-batch-acquire

## Non-goals

No live network default, credentials, provider grant, scheduler, DB mutation or source authority.

## Affected areas

- `src/dreaming/verified-session-work.ts` — reuse preflight index and page validation.
- `src/dreaming/source-batch-acquire.ts` — bounded native browse request/response composition.
- `test/source-batch-acquire.test.mjs` — exact pages and fault/budget cases.
- `docs/ledger-neon.md` — boundary and observed test scope.

## Approach

Extract existing selected-index verification as a pure preflight; reuse strict page parser. Require exact selected indexes and explicit budgets before reads. Inject a transport returning Response, enforce deadline including body, stream UTF-8 JSON under per-page and total byte limits. Validate identity, page size and cursor exact native position before subsequent request. Final existing verified batch preparation is authoritative for all message continuity and digests. No retry or alternate route.

## Testing

Existing recorded synthetic reader pages, bounded stream, invalid index/cursor, wrong generation, timeout and incomplete data. Independent actual handler synthetic integration where available. Canonical QA.

## Spec impact

Adds acquisition bounds before existing admission, not permission.
