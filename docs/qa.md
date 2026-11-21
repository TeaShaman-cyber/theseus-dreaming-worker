# QA and verification

Theseus Dreaming Worker reuses the QA shape already proven in Session Search: one canonical fast gate, with expensive checks kept separate.

## Fast gate

The one local and hosted entrypoint is:

```bash
./tools/dev/check
```

It checks:

| Check | Plain-language purpose |
| --- | --- |
| `node scripts/verify-repo.mjs` | The public repo has its required contracts and does not accidentally track obvious secrets, env files, databases, keys, build state, or Mastra local state. |
| `npm run lint` | Biome catches mechanical JavaScript/TypeScript/JSON mistakes before review. |
| `npm run test` | Unit and regression tests still describe the intended behavior. |
| `npm run typecheck` | TypeScript relationships are internally consistent. |
| `npm run build:check` | The Mastra application can actually be assembled in an isolated temporary copy, without disturbing a running Studio/dev server. |
| `python3 tools/check_goal_contract.py` | The explicit dreaming-worker authority contract is still present. |
| `git diff --check` | The patch has no whitespace damage. |

GitHub Actions calls the same `./tools/dev/check`. CI is therefore a hosted witness for the same QA definition, not a second competing definition.

## Targeted-heavy lane

Expensive checks run by risk and changed surface rather than on every tiny edit.

The first targeted-heavy check is mutation testing for `src/dreaming/dry-run.ts`.

Mutation testing means: make small deliberate mistakes in the real code and see whether our tests catch them. If a mutant survives, the important question is "what behavior are our tests failing to protect?" — not "how do we force a pretty 100% score?"

The initial mutation scope is deliberately narrow because Pilot 0 carries a few high-value invariants:

- no accepted new evidence -> zero external calls;
- evidence without provenance is rejected;
- incomplete coverage cannot justify absence claims;
- the receipt fingerprints the exact input packet.

Do not mutate framework internals or provider plumbing merely to increase a metric.

## Defect-class rule

Use the cheapest sufficient detector:

```text
ordinary behavior bug
  -> focused regression test

public-repository/privacy leak
  -> repository verifier

type/API mismatch
  -> typecheck

mechanical code smell
  -> lint

assembly/package failure
  -> build

weak behavioral assertions
  -> targeted mutation testing

provider timeout / 429 / malformed response / partial execution
  -> bounded fault-injection tests once that boundary exists
```

Mutation testing checks the strength of the normal test suite. It does not replace contract tests, stateful tests, or fault injection.

An unrun or uncovered check is `UNKNOWN`, never `PASS`.

## Current mutation baseline

The first bounded baseline on 2026-11-21 deliberately exposed weak tests before they were strengthened:

```text
initial: 27 killed / 36 survived / mutation score 42.86%
revised: 62 killed / 0 survived / mutation score 100.00%
```

Stryker also produced 26 compile-error mutants on the revised run. Those are recorded separately and are not counted as testable surviving mutants.

The original Pilot 0 gate used `break: 100` only for the narrow deterministic `src/dreaming/dry-run.ts` scope.

Pilot 1 was then baselined separately before joining the blocking gate:

```text
pilot1 initial: 35 killed / 3 survived / mutation score 92.11%
pilot1 revised: 38 killed / 0 survived / mutation score 100.00%
```

The three survivors exposed missing guarantees for `PUBLICATION_SAFE`, missing-task handling, and request-fingerprint sensitivity. After those promises were tested, the Pilot 1 scope reached 100% for testable mutants.

The typed proposal validator was then baselined separately:

```text
proposal-schema initial: 31 killed / 6 survived / mutation score 83.78%
proposal-schema revised: 37 killed / 0 survived / mutation score 100.00%
```

The six survivors exposed missing tests for whitespace-only semantic fields, LOW uncertainty, multi-source provenance, non-empty INFERENCE assumptions, and non-empty required_evidence for HYPOTHESIS and UNKNOWN.

The combined blocking scope is now:

```text
src/dreaming/dry-run.ts
src/dreaming/pilot1-runner.ts
src/dreaming/proposal-schema.ts
```

This still does **not** establish a project-wide 100% mutation requirement. New mutation scopes must earn their own baseline and classification before becoming blocking.

## Reverse tracing

The repository also carries a small reverse-trace contract in
`contracts/dreaming-worker-invariants.json`.

Feynman version: tests answer "does this code behave as encoded?", while the
reverse-trace map asks "which human promise was this code/test supposed to
protect?"

`python3 tools/reverse_trace/check_current.py` checks only declared static
witnesses. It deliberately does **not** claim semantic correctness.

Possible states include:

- `DECLARED_WITNESSES_PRESENT` — named code/test anchors are still present;
- `DECLARED_WITNESS_MISSING` — a declared machine witness weakened or vanished;
- `NO_DECLARED_MACHINE_WITNESS` — this promise still needs semantic/runtime review.

The current Pilot 1 map includes scope/privacy boundaries, NO_DATA zero-call
behavior, one-inference/no-tool/no-memory execution, deterministic receipt
authority, Git-owned agent configuration, model-adapter compatibility,
provenance/fingerprints, typed proposal/provenance validation, and the public-code/private-evidence boundary.

This mechanism is adapted from the Session Search reverse-tracing baseline in
Theseus Research #130 / PR #131. It is an advisory conformance layer, not a
replacement for unit tests, mutation tests, runtime traces, or independent
review.

## Risk-based exact-head Codex review

Codex review is not a universal merge authority. Ordinary low-risk changes remain advisory, but changes to protected verification, authority, permission, model-routing, privacy, canonical-state, SpecD/review, or fail-closed boundaries require an exact-head Codex review.

`.github/workflows/review-gate.yml` classifies the PR diff with `scripts/review_gate_required.py`. For protected changes it waits for Codex review evidence for the exact PR head via `tools/pr/codex-review-wait.sh`.

Terminal states are intentionally distinct:

- `CLEAN` — exact-head review completed without unresolved findings;
- `FINDINGS` — exact-head review completed with unresolved findings and the workflow fails;
- `PENDING` — review is not terminal;
- `STALE` — review evidence exists, but for an older head;
- `TIMEOUT` — bounded waiting expired and is not converted into a pass.

The trusted workflow uses `pull_request_target`, so its orchestration comes from the base branch. It checks out only the base SHA, treats the PR file list as GitHub API data, and runs only base-owned classifier/parser/wait helpers. It never executes PR-head code. The bootstrap PR that first introduces this workflow cannot be protected by a workflow that is not yet present on the base branch, so that one PR requires an explicit manual exact-head Codex `CLEAN` before promotion. After merge, protected PRs use the base-owned workflow automatically.

A stale review is not equivalent to a clean current review. PR #9 is the regression example: Codex reviewed an earlier head and found a real observability wiring gap, but later commits changed the head before merge. `tools/pr/codex-review-status.sh` now classifies that final historical head as `STALE`.

Repository settings currently do not expose a branch-protection/ruleset requirement for this check. Therefore the workflow result is a project promotion condition, not a claim that GitHub itself makes merge impossible.

Hosted QA, mutation testing, reverse tracing, SpecD context, Codex review, runtime readback, and the maintainer promotion decision remain separate claims.
