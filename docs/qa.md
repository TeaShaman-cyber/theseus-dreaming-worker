# QA and verification

Theseus Dreaming Worker reuses the QA shape already proven in Session Search: one canonical fast gate, with expensive checks kept separate.

## Fast gate

The one local and hosted entrypoint is:

```bash
./tools/dev/check
```

Install the locked SpecD QA toolchain with `./tools/specd/install` after the normal locked project dependency install. CI runs both installs before QA.

It checks:

| Check | Plain-language purpose |
| --- | --- |
| `node scripts/verify-repo.mjs` | The public repo has its required contracts and does not accidentally track obvious secrets, env files, databases, keys, build state, or Mastra local state. |
| `python3 tools/specd/check-graph.py` | Native graph health: real source/spec indexing, code relations and known-symbol resolution in a disposable workspace; not semantic proof. |
| `./tools/dev/specd-check` | Actual pinned upstream SpecD validates every canonical spec against the schema; nonzero exit blocks canonical QA. |
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

The hosted mutation workflow runs the independent shards declared in `scripts/mutation-shards.mjs`. The repository wrapper requires an explicit shard name, so plain `npm run mutation` fails before Stryker starts instead of accidentally launching the whole heavy suite locally.

The source-batch-fixed, source-batch-pooled and source-cycle shards (#104, #111) require classified baselines before promotion. The two source-batch ranges use the same complete behavior test file and native Stryker range selection. The boundary is resolved from the current top-level pooled declaration; canonical fast QA verifies exact disjoint union against the full-file mutant inventory using the pinned instrumenter. A missing boundary or lost/duplicated mutant fails closed. Both ranges retain the 100% threshold and run as independent hosted jobs; neither alone is source-batch acceptance.

Ledger mutations (#115) run as two whole-file shards, ledger-core and ledger-postgres, each using all three original ledger behavior test entrypoints. Both retain the 60-minute safety deadline and the 100% threshold. All scopes must pass for acceptance.

Draft PR feedback selects every shard that directly runs a modified test entrypoint. Synchronize events compare the previous and new head only if the previous head is an ancestor; opening/reopening a draft compares against the base. Unmapped files, runtime/config/fixture edits, additions/deletions, missing or ambiguous diffs run the entire matrix as feedback. No source dependency inference is attempted. A manual workflow dispatch with an explicit `shard` is feedback only; empty input runs the full matrix. All mutation-relevant ready-for-review and non-draft PR events, and main pushes, run every declared shard. A draft is not acceptance, even if its feedback happens to include every shard. Feedback jobs and artifacts have distinct names. Before promotion, inspect the full matrix on the exact current PR head/base; focused results, skipped shards, stale receipts and a green `verify` alone cannot substitute for it. No branch-protection or mutation threshold changes.


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

SpecD structural validation is **mandatory within the canonical QA gate** on every PR, including code-only changes. The isolated lock pins CLI 0.2.0 and schema-std 0.1.1. The gate runs the upstream CLI, not a substitute text check. A missing tool or invalid spec fails QA. The same gate checks active native change state and fails on incomplete or drifted artifacts. Native status runs in an isolated snapshot so QA cannot silently revalidate or rewrite working change state. Structural and lifecycle-state validation do not establish semantic compliance, and a missing change cannot be detected merely by checking existing artifacts; SpecD context and requirement-linked review remain necessary. Deterministic QA, mutation testing, exact-head Codex review, runtime readback, and promotion authority remain separate claims.

The existence of `spec-lock.json` does not prove that implementation satisfies the human requirement. It proves only that the repository has a persisted implementation relation that SpecD can resolve. When the linked code changes, reviewers should read the applicable `spec.md` and `verify.md` before judging semantic correctness.

This slice follows the verified brownfield adoption pattern from current Session Search main. No custom SpecD review bot is introduced. The canonical QA gate now checks native graph availability in a disposable workspace; it does not publish a graph or assert that all requirements are linked. The installer explicitly rebuilds the locked Ladybug and better-sqlite3 native modules, leaving unrelated lifecycle scripts disabled. For a local graph of the working tree, run `tools/specd/node_modules/.bin/specd --config specd.yaml graph index` followed by `graph stats` or `graph search` using the same CLI/config. The ignored graph database is derived state, not Git authority. Native graph COVERS counts are not proof of the separate spec-lock implementation links. The QA check requires fresh native metadata for every spec, verifies native DEPENDS_ON counts and the compiled transitive storage context, and resolves existing legacy spec-lock implementation symbols through native graph search. These compatibility mappings are not COVERS edges and do not establish semantic correctness. After editing canonical spec or verify documents, regenerate stale/missing metadata using the pinned CLI: `tools/specd/node_modules/.bin/specd --config specd.yaml specs generate-metadata --all --write`. If it refuses a curated dependency change, review the exact dependency change first and regenerate only that spec with `--force` when justified. Commit metadata together with the source change; do not manually edit generated metadata. Actual semantic change-lifecycle adoption remains tracked in #52. Local SpecD override configuration belongs in `specd.local.yaml` and is not canonical.

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

## Database QA routing

Database checks are risk-routed, not global PR gates. Do **not** run PostgreSQL/Neon infrastructure checks for unrelated agent, prompt, model-routing, documentation, or UI-only changes.

| Changed surface | Required database QA | Why |
| --- | --- | --- |
| unrelated code/docs | normal canonical QA only | no database contract changed |
| ledger persistence code or PostgreSQL contract tests | hosted PostgreSQL contract | exercises real `pg` read/write behavior and append-only grants |
| PostgreSQL DDL / grant / migration IaC | hosted PostgreSQL contract **and** Neon schema-only preview | generic PostgreSQL semantics plus current Neon compatibility |
| investigation of a database failure | start with the failing hosted lane; use a Codespace only when interactive diagnosis is actually needed | avoid long-lived test infrastructure by default |

The workflows enforce this with GitHub `pull_request.paths` filters. `heavy-postgres.yml` is deliberately scoped to ledger/PostgreSQL storage surfaces; it is **not** a repository-wide PR job. `neon-ledger-preview.yml` is narrower still and runs only for the SQL/Neon migration surface and its own contract tests. Both retain `workflow_dispatch` only for explicit diagnostic reruns.

This routing is a reusable pattern recovered from `TeaShaman-cyber/theseus-repo-search-lab#122` and the follow-up simplification discussion in #128. The durable lesson is the separation of concerns, not the old Repo Search implementation: use an ephemeral PostgreSQL service on a GitHub runner for generic database behavior, keep provider-specific Neon preview as a second compatibility layer, and avoid a persistent Codespace/VM unless interactive debugging requires it.

Current observed substrate (2026-11-23): GitHub `ubuntu-26.04` provides PostgreSQL 18.x directly on the runner; the Dreaming Worker Neon development/test database is PostgreSQL 17.x. Exact versions are current evidence, not a permanent requirement. The invariant is that generic PostgreSQL QA and current-Neon compatibility remain separate checks.

## Hosted PostgreSQL ledger contract

Generic PostgreSQL correctness is tested separately from Neon-specific compatibility.

`.github/workflows/heavy-postgres.yml` starts an runner-provided PostgreSQL 18 service on a GitHub-hosted runner and executes the repository-owned `tools/ci/heavy-postgres` contract. The lane:

- creates only the minimal owner/runtime roles required by the ledger schema;
- applies `infra/postgres/dw_ledger_v1.sql` twice to prove replay safety;
- runs the SQL grant/FK/schema readback;
- exercises the real TypeScript Postgres ledger adapter against the database;
- verifies duplicate/cycle rejection and the runtime no-UPDATE boundary.

This is the fast generic PostgreSQL lane. The Neon schema-only preview remains a separate provider-specific compatibility check. No Codespace or long-lived PostgreSQL test host is required.
### SpecD runtime diff coverage

The required hosted QA supplies the exact PR base (or previous main SHA on
push). It checks protected runtime changes against fresh native archived
changes absent from that base. Runtime paths include files in `src/`, `tools/agent/`, `tools/cloudflare/`,
`config/`, `infra/` (except README.md and AGENTS.md), runtime entrypoint
scripts and root build/dependency configuration. Renames/deletions cannot disappear
through rename detection. Native archive status and exact validated design
file entries are checked in a disposable snapshot of committed Git blobs.
Existing implementation links constrain the spec scope where available.
Documentation and test-only diffs do not require an archive. Use native no-op
deltas for behavior-preserving runtime refactors. Local explicit diff check:
`SPECD_DIFF_BASE=$(git merge-base HEAD origin/main) ./tools/dev/specd-check`.
Without an explicit base, local QA checks structure and active change state
only. Hosted canonical QA fails if its base is missing. Path coverage is not
proof of semantic adequacy, truthful lifecycle claims, or review acceptance.

### Inspect an interrupted synthetic cycle

Run `node tools/agent/inspect-source-cycle.mjs <batch.json>` with an explicitly supplied existing `LEDGER_DATABASE_URL` in the environment. The batch is the exact synthetic batch witness (including pages and previous checkpoint), not an acquisition request. The report observes source tip, exact plan, and per-work journal/completion metadata; it never writes, runs models or retries. Separate reads are not an atomic snapshot; matching work identity does not establish source custody or permission to resume. UNKNOWN and READ_INCONSISTENT require investigation, not automatic recovery. No new credentials or database grants are created.
