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

The gate therefore uses `break: 100` only for the narrow deterministic `src/dreaming/dry-run.ts` scope. This does **not** establish a project-wide 100% mutation requirement. New mutation scopes must earn their own baseline and classification before becoming blocking.
