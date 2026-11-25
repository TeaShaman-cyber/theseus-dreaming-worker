# Design: require-change-coverage

## Non-goals

No runtime behavior, model, provider, or permissions changes. No assertion that textual path coverage proves semantic compliance.

## Affected areas

- `tools/specd/check-diff.py` — compare exact Git base and checked-out commit, require newly added native archive manifest and validated design scope for protected paths.
- `tools/dev/specd-check` — invoke diff check when an explicit base is supplied.
- `.github/workflows/qa.yml` — supply trusted event base SHA on PRs and before SHA on pushes.
- `test_py/test_specd_diff_gate.py` — real Git and native archive regression cases.
- `scripts/verify-repo.mjs` — require gate script and hosted base wiring.
- `AGENTS.md` — describe native archive and path scope requirement.
- `docs/qa.md` — document local/hosted usage and scope.

## Approach

Use git diff --name-only --no-renames -z BASE HEAD, with validated ancestor SHA and exact checked-out HEAD. Runtime code and configuration under src, tools/agent, tools/cloudflare, config and infra (excluding README.md and AGENTS.md), runtime entrypoint scripts and root build/dependency configuration require coverage. Documentation and test-only diffs are outside this narrow gate. Existing archives do not count; only archive directories absent from the base tree qualify. Each fresh archive must be visible through native archives show, and native changes status must report intact artifacts when the archive is copied into active storage in a disposable snapshot. Require exact backtick file entries under Affected areas in the validated design, and valid canonical spec IDs. No semantic approval or automatically generated change record. For refactors use native no-op deltas.

## Key decisions

No new parallel manifest format. Native archive is the record; Git establishes freshness. Exact path scope is structural evidence, not a substitute for reviewer inspection.

## Testing

Real Git commits and native archive fixtures: missing archive fails, preexisting archive fails, fresh archive with matching path passes, wrong path fails, drift fails, deleted runtime file is covered, docs-only passes. Required verify runs against event base. Existing canonical QA and review remain intact.

## Spec impact

Only the development QA implementation changes; no dependent runtime requirements change.
