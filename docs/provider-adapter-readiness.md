# Provider-adapter readiness runner

`tools/dev/provider-adapter-readiness` moves deterministic readiness mechanics out of a long chat/tool loop and into one bounded repo-owned command.

## Intended control flow

```text
human / model decision
        |
        v
one bounded runtime command
        |
        v
compact receipt + full local logs
        |
        v
human / model semantic review
```

The runner is evidence collection, not acceptance authority. It does not classify survivors as equivalent, weaken mutation thresholds, merge a pull request, update an Issue, call paid providers, or publish anything.

## Usage

Run from a clean branch with the repository Node runtime (`package.json` requires Node >=22.13.0):

```bash
tools/dev/provider-adapter-readiness \
  --expect-branch feature/provider-adapter-readiness
```

Optionally compare the new mutation report with a prior Stryker JSON report or an earlier readiness receipt:

```bash
tools/dev/provider-adapter-readiness \
  --baseline /path/to/prior-mutation.json
```

Use `--output-dir PATH` to override the default `reports/provider-adapter-readiness/<head>/` directory.

## Receipt contract

Normal terminal output is one compact JSON summary. Full command output is retained in ignored runtime files:

- `focused-tests.log`
- `canonical-qa.log`
- `mutation.log`
- `mutation.json`
- `receipt.json`

The receipt records exact Git `HEAD`, branch/worktree state, focused provider-adapter test counts, canonical QA result, mutation counts/score, and optional mutation transitions keyed by stable mutant ID.

A preflight or command failure is fail-closed: the receipt records the failing step, later steps remain `NOT_RUN`, and the runner exits non-zero. A successful runner execution means only that the deterministic mechanics completed; semantic interpretation of remaining survivors/timeouts is a separate review step.
