# Agent instructions

Before changing architecture, workflow semantics, storage, provider routing, or authority boundaries, read `contracts/dreaming-worker.yaml`.

Do not silently broaden the worker beyond that contract. If a requested change conflicts with it, surface the conflict and update the contract through the normal Issue/PR path before implementation.

Session Search is an evidence/currentness dependency, never hypothesis authority. Mastra/Studio/Agent Builder are development interfaces, not canonical state or production authority.

## Advisory code readability

Prefer linear control flow over nested conditionals when it makes invariants
and the normal path easier to follow. Use early return/continue where they
clarify the flow; keep else when mutually exclusive alternatives read better.
Do not eliminate else mechanically or refactor solely to lower a metric.
Preserve behavior and verify it with existing tests and risk-proportional QA.
CRAP and cognitive complexity are advisory signals, not acceptance gates.

## SpecD change workflow

Before substantial semantic, architecture or inference-stage work, use the pinned
native CLI at `tools/specd/node_modules/.bin/specd` to compile the relevant spec
context and create or reuse a native change. Complete the applicable proposal,
requirements/deltas, verification, design and tasks before implementation.
Validate artifacts and transition using the CLI, not handwritten lifecycle state.
Mechanical maintenance without semantic change does not require a new lifecycle.

For additional model work, read `default:worker/core-contract` and link the
unresolved task, deterministic baseline limitation, comparative evidence, and
bounded call policy. An experimental model result alone cannot justify acceptance.
Use the existing #54 research boundary for serialization. Canonical QA must pass;
native change state and structural validation do not replace semantic review.

Protected runtime diffs require a fresh native archived change in the PR.
Under its validated design's Affected areas section, list each affected runtime
file with an exact backtick path bullet and scope the change to the applicable
canonical spec. Use native no-op deltas for behavior-preserving refactors;
do not reuse old archives as evidence of new work. Local diff check:
`SPECD_DIFF_BASE=$(git merge-base HEAD origin/main) ./tools/dev/specd-check`
after committing the candidate. This coverage check does not establish semantic
conformance or replace exact-head review.
