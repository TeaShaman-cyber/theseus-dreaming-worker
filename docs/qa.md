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
| `npm run cloudflare:check` | The Cloudflare Worker candidate builds, emits a non-secret readiness receipt, and passes a prebuilt `cf deploy --dry-run --no-provision` without creating cloud resources. |
| `python3 tools/check_goal_contract.py` | The explicit dreaming-worker authority contract is still present. |
| `git diff --check` | The patch has no whitespace damage. |

GitHub Actions calls the same `./tools/dev/check`. CI is therefore a hosted witness for the same QA definition, not a second competing definition.

## Targeted-heavy lane

Expensive checks run by risk and changed surface rather than on every tiny edit.

Heavy mutation QA is GitHub-runner-first. The governed exe.dev VM is the control/development plane: use it for editing, the fast gate, focused regression tests, and short diagnostics. Do not use it as the default executor for the blocking mutation suite. When heavy QA needs interactive investigation rather than a batch CI run, use a Codespace; only fall back to the smaller VM after an observed need.

The hosted mutation workflow runs six independent shards in parallel: `pilot0-1`, `pilot2`, `critique`, `critique-live`, `ledger`, and `observability`. The repository wrapper requires an explicit shard name, so plain `npm run mutation` fails before Stryker starts instead of accidentally launching the whole heavy suite locally.

`npm run cloudflare:startup-check` profiles Worker startup locally. It is an acceptance/diagnostic signal rather than a per-commit gate; local timing does not prove Cloudflare production startup time.

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


Pilot 2 critique first earned a focused behavioral baseline:

```text
pilot2 critique contract: 112 killed / 0 survived / mutation score 100.00%
```

That local run remains useful historical evidence, but it is no longer the permanent execution route. Critique mutation now runs as its own hosted shard with the normal TypeScript checker on a GitHub runner. This keeps the 4 GiB control VM out of heavy QA while preserving the same blocking mutation standard.

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

Codex review is an independent advisory reviewer, not merge authority. Protected verification, authority, permission, model-routing, privacy, canonical-state, SpecD/review, and fail-closed changes must request and observe exact-head Codex review when it is available, but external Codex quota or review latency does not become project promotion authority.

`.github/workflows/review-gate.yml` classifies the PR diff with `scripts/review_gate_required.py`. For protected changes it observes bounded exact-head Codex evidence via `tools/pr/codex-review-wait.sh`; the workflow fails only when trusted review evidence cannot be read/classified, not because the external reviewer is pending or unavailable.

States are intentionally distinct:

- `CLEAN` — exact-head review completed without unresolved findings;
- `FINDINGS` — exact-head review completed with findings; every finding must be explicitly adjudicated as `fix`, `reject with evidence`, or `follow-up issue`;
- `UNAVAILABLE_QUOTA` — an exact-head review attempt failed because Codex code-review quota is unavailable; this creates review debt, not a permanent waiver and not a promotion veto;
- `PENDING` — review is not terminal;
- `STALE` — review evidence exists, but for an older head;
- `TIMEOUT` — bounded waiting expired; review debt remains.

Late review is still evidence. If Codex completes after promotion, its findings must be read and adjudicated rather than discarded because the PR already merged. A later observed successful Codex review is also evidence that the review surface is available again; future protected changes should continue requesting it. Do not busy-loop quota failures.

The trusted workflow uses `pull_request_target`, so its orchestration comes from the base branch. It checks out only the base SHA, treats the PR file list as GitHub API data, and runs only base-owned classifier/parser/wait helpers. It never executes PR-head code. A PR that changes this review policy is a protected authority/process change: it requires explicit maintainer intent plus normal deterministic QA and hosted verification, but the old Codex-only condition cannot serve as immutable authority over its own replacement.

A stale review is not equivalent to a clean current review. PR #9 is the regression example: Codex reviewed an earlier head and found a real observability wiring gap, but later commits changed the head before merge. `tools/pr/codex-review-status.sh` now classifies that final historical head as `STALE`.

Repository settings currently do not expose a branch-protection/ruleset requirement for this check. Therefore the workflow result is a project promotion condition, not a claim that GitHub itself makes merge impossible.

Hosted QA, mutation testing, reverse tracing, SpecD context, Codex review, runtime readback, and the maintainer promotion decision remain separate claims.

## SpecD durable semantic traceability

The repository keeps a bounded brownfield SpecD slice for protected Pilot 1 semantics.

Current durable chain:

```text
human invariant
  -> specs/pilot1/bounded-inference/spec.md
  -> verify.md
  -> SpecD-generated spec-lock.json
  -> stable symbol src/dreaming/pilot1-runner.ts :: runPilot1
  -> scoped src/dreaming/AGENTS.md review procedure
  -> GitHub Codex semantic review
```

The persisted implementation link was generated by exact upstream SpecD, not handwritten. The linked stable symbol is `runPilot1`.

SpecD is **not** an additional merge gate. It supplies durable semantic context for review and impact reasoning. Deterministic QA, mutation testing, exact-head Codex review, runtime readback, and promotion authority remain separate claims.

The existence of `spec-lock.json` does not prove that implementation satisfies the human requirement. It proves only that the repository has a persisted implementation relation that SpecD can resolve. When the linked code changes, reviewers should read the applicable `spec.md` and `verify.md` before judging semantic correctness.

This slice follows the verified brownfield adoption pattern from current Session Search main. No custom SpecD review bot or permanent SpecD graph CI is introduced here. Local SpecD override configuration belongs in `specd.local.yaml` and is not canonical.

The native reverse-trace contract remains in place for promises not yet represented as durable SpecD specs. As coverage grows, redundant hand-maintained mappings may be retired only after equivalent SpecD links and review behavior are verified.

## Neon ledger migration preview lane

PostgreSQL IaC under `infra/postgres/**` has a dedicated hosted preview lane in `.github/workflows/neon-ledger-preview.yml`.

The lane is deliberately narrower than production deployment:

- it is disabled unless repository variable `NEON_PREVIEW_ENABLED` is exactly `true`;
- it expects `NEON_PROJECT_ID` plus a **project-scoped** `NEON_API_KEY` for the single Dreaming Worker Neon project;
- it skips fork pull requests;
- it creates a short-lived **schema-only** Neon branch, so the PR job receives database structure but no copied production rows;
- all Neon and GitHub Actions are pinned to immutable commit SHAs;
- the Neon API key is consumed only by pinned branch-management/schema-diff actions; checked-out PR SQL receives only the disposable branch database URL;
- the migration is replayed twice to prove idempotence, then an independent SQL readback checks ledger tables, foreign keys, and append-only runtime grants;
- schema diff runs in a separate job with no checkout and posts the comparison to the PR;
- the preview branch is deleted after validation, with a two-hour Neon expiry as cleanup backstop;
- no step applies DDL to Neon `main`.

The workflow is intentionally committed before credential enablement. Creating the project-scoped key, storing it in GitHub, and setting `NEON_PREVIEW_ENABLED=true` are separate permission-bearing actions.

This design follows current Neon guidance for GitHub Actions, schema diff, project-scoped API keys, and schema-only branches rather than installing the default GitHub integration with a broader account/organization key.

## Hosted PostgreSQL ledger contract

Generic PostgreSQL correctness is tested separately from Neon-specific compatibility.

`.github/workflows/heavy-postgres.yml` starts an ephemeral PostgreSQL 17 service on a GitHub-hosted runner and executes the repository-owned `tools/ci/heavy-postgres` contract. The lane:

- creates only the minimal owner/runtime roles required by the ledger schema;
- applies `infra/postgres/dw_ledger_v1.sql` twice to prove replay safety;
- runs the SQL grant/FK/schema readback;
- exercises the real TypeScript Postgres ledger adapter against the database;
- verifies duplicate/cycle rejection and the runtime no-UPDATE boundary.

This is the fast generic PostgreSQL lane. The Neon schema-only preview remains a separate provider-specific compatibility check. No Codespace or long-lived PostgreSQL test host is required.
