# Design: ledger-rank-mutation-witness

## Non-goals

No additional graph algorithm, production change, weakened mutation threshold or broad ignore.

## Affected areas

- `src/dreaming/proposal-ledger.ts` — two exact equality-mutant annotations and explicit absent adjacency handling.
- `test/proposal-ledger.test.mjs` — deterministic forward append work bound.

## Approach

Kahn assigns ranks by current map size to unique processed vertices. New proposals are distinct by content ID validation and extend the map. An accepted backward edge invalidates the entire map. Thus a live rank map is injective over all existing vertices. In pathExists equality of current and target has already returned; in validateBasics self-supersession has already failed. For distinct vertices, strict and non-strict rank comparisons are equivalent. Ignore only EqualityOperator on each exact comparison. Empty adjacency has no targets; use explicit branch instead of a default array that can inject a non-record target with NaN indegree. Keep graph validation and all identity checks.

## Evidence and testing

Checked abstract Lean lemmas for both strict/non-strict equivalences. Reproduce three rank-retention mutants with actual focused test; restore original source. Existing isolated-vertex, cycle, branching and exhaustive tests exercise explicit absent adjacency handling. Canonical QA and hosted exact mutation gate required.

## Spec impact

No-op delta; existing ledger contract preserved.
