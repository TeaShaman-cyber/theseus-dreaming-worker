# Design: hybrid-deterministic-first

## Non-goals

No new runtime inference, serializer integration, provider, database, permissions, or budget. Recovery experiments and additional parser implementation remain #54. This is adoption of a policy and its development workflow, not certification of a future runtime.

## Affected areas

- Core spec and verify: apply the two native deltas through SpecD.
- contracts/dreaming-worker.yaml: express the same deterministic sufficiency invariant at the goal boundary.
- AGENTS.md, src/dreaming/AGENTS.md and docs/qa.md: require native compiled context, lifecycle for substantial semantic changes, and explicit baseline/requirement evidence at review. Keep trivial changes exempt from ceremony.
- tools/dev/specd-check: check native active-change status in an isolated snapshot with the pinned upstream CLI in addition to canonical specs.
- test_py/test_specd_gate.py: exercise malformed active change and absent tool, not merely canonical headings.
- tools/check_goal_contract.py: keep the clarified invariant in the existing goal check; lexical presence is not semantic compliance.

## Approach

Use native change artifacts, validation, lifecycle transitions and archive to preserve why, what, design and verification. Before accepting a new model stage the review must inspect the residual task and comparative evidence, not infer necessity from a valid response. Existing deterministic fence recovery and no-call controls are witnesses for present behavior only. The missing-provenance and broader mapping design remain open under #54.

## Key decisions

Native SpecD validation rather than a separate homemade spec format. Scope the rule to durable changes and allow exploratory negative results without a new runtime dependency. Do not claim that structural validation proves semantic necessity.

## Trade-offs

A change that omits the lifecycle entirely cannot be detected merely by validating existing artifacts. Exact-head requirement-linked review is still needed; subsequent diff-aware enforcement is a separate remaining item in #52. Metadata discovery warnings are not evidence of complete graph coverage.

## Spec impact

Core is referenced by intake/session-search-boundary, ledger/append-only-proposals, ledger/neon-persistence and Pilot 2 independent-perspectives, critique-contract, live-critique, live-provider-composition. No interface, schema, authorization or runtime contract of those specs is changed. Existing independent reasoner and optional critique remain semantic work. No dependent deltas needed for this policy increment; actual new recovery stages require their own spec under #54.

## Testing

- Native proposal/spec/verify/design/tasks validation and preview; verify unchanged existing requirements.
- Native active-change status: an unvalidated draft or drifted proposal/delta blocks canonical SpecD gate; use a disposable snapshot because status can update manifest state. Missing CLI fails closed.
- Existing Pilot 1 fence/truncation and Pilot 2 provenance/no-call benchmark tests are witnesses for currently implemented cases.
- Inspect the goal contract and review instructions for the requirement and baseline criterion. The prospective additional-stage acceptance scenario is a review requirement, not a claim that an arbitrary model can prove it mechanically.
- Canonical hosted QA and exact-head Codex review before repository promotion.
