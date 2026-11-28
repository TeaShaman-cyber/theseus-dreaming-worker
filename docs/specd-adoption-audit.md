# SpecD adoption hypothesis — review draft

> Status: **proposal under independent review**, not repository policy.
>
> This document exists to make the adoption hypothesis reviewable before we change specs, agent instructions, or QA gates.

## Why this review exists

Dreaming Worker originally adopted a small SpecD slice by adapting a brownfield pattern from another Theseus repository. A later audit against upstream SpecD showed that this was useful but incomplete: the repository currently uses SpecD mostly as a static spec workspace plus implementation-link convention rather than as the upstream change lifecycle.

The goal is not to maximize process. The goal is to keep the parts of SpecD that reduce semantic drift while avoiding ceremony that does not lower recurring failure or recovery cost.

## Observed facts

The following were observed on 2026-11-23 against the released upstream packages:

- `@specd/cli` 0.2.0;
- `@specd/specd` 0.2.0;
- `@specd/schema-std` 0.1.1.

A disposable snapshot of the repository was inspected with the released CLI:

- `specd specs list` discovered 10 repository specs;
- `specd changes list` reported no active changes;
- the repository has no durable `.specd/changes` or `.specd/archive` history;
- `specd spec validate --all` reported **4 passing specs and 6 failing specs**;
- the failures are schema-structure failures, primarily missing required `## Requirements` sections;
- official SpecD agent skills are not currently installed in this repository;
- local tests currently inspect raw `spec-lock.json` files directly.

Therefore a green local `test_specd_contract.py` result does **not** currently imply upstream SpecD schema compliance.

## Upstream behavior used as reference

Upstream SpecD describes the normal workflow as a change lifecycle built around proposal, specs, verification scenarios, design, tasks, implementation, verification, and archive.

The current upstream agent guidance also emphasizes:

- use of `specd specs context` and project context rather than agents reconstructing meaning from raw files;
- graph-first impact analysis for affected symbols/files;
- read-only spec compliance review as a distinct workflow;
- change-scoped implementation tracking;
- a code-first `specd-fasttrack` workflow for exploratory work.

Important version caveat: current upstream `main` already documents implementation-tracking commands used by `specd-fasttrack`, while those commands are not present in the released CLI 0.2.0. We therefore must not silently combine unreleased `main` instructions with released CLI behavior.

Reference sources:

- upstream repository: `specd-sdd/SpecD`;
- `docs/guide/skills.md`;
- `packages/skills/templates/skills/specd-fasttrack/SKILL.md.tpl`;
- `packages/skills/templates/skills/specd-compliance/SKILL.md.tpl`;
- released CLI/schema behavior as observed directly with `@specd/cli@0.2.0`.

## Proposed adoption mode

This section is a **hypothesis for review**, not an accepted decision.

### 1. Pin a released SpecD toolchain before relying on it

For repository QA and repeatability, use a pinned released CLI/schema version rather than `latest` or an arbitrary upstream `main` commit.

Upstream `main` remains research input. Features that exist only on `main` are not treated as available project machinery until we deliberately choose a release or pinned source that contains them.

### 2. Use the normal SpecD lifecycle for substantial semantic changes

A SpecD change is appropriate when work introduces or materially changes durable behavior, architecture, authority boundaries, verification invariants, or cross-cutting contracts.

Examples in this repository include:

- a new Dreaming Worker analysis stage;
- a change to what evidence may leave Session Search;
- a change to ledger authority or supersession semantics;
- a new persistent execution or storage boundary.

The lifecycle should capture the reasoning and verification contract before the implementation is treated as accepted.

### 3. Do not require SpecD for trivial mechanical work

Formatting, wording-only documentation fixes, dependency refreshes with no semantic contract change, and similarly mechanical maintenance should not require a SpecD change merely because the framework supports one.

Issue-first and normal QA remain sufficient where no durable semantic contract is changing.

### 4. Treat code-first exploration separately

Exploratory work, spikes, and bug diagnosis often discover the design while coding. Upstream now has `specd-fasttrack` specifically for this shape of work.

Until the required implementation-tracking surface is available in the project-pinned SpecD version, we should **not claim to be using upstream fast-track**. Existing issue/journal evidence can continue to preserve exploration, followed by explicit consolidation into SpecD only when the behavior becomes a durable contract.

When an appropriate released version contains fast-track, evaluate replacing this temporary project convention with the upstream workflow.

### 5. Use upstream validation as the schema-compliance check

When canonical specs or SpecD configuration change, upstream `specd spec validate --all` should be the primary structural compliance check.

Project-specific tests may still check project invariants, but they must not substitute for upstream validation or encode private assumptions about SpecD internals.

### 6. Stop treating raw `spec-lock.json` shape as the public contract

Current project tests and `src/dreaming/AGENTS.md` directly inspect `spec-lock.json`. The proposed direction is to migrate toward SpecD semantic context/implementation-tracking surfaces where the pinned version supports them.

Until that migration is proven, existing sidecar checks should be described as a temporary repository convention rather than as the SpecD framework contract.

### 7. Keep independent review separate from SpecD authority

SpecD describes intended behavior and verification context; it is not merge authority by itself.

For consequential changes, exact-head Codex review (and, where useful, additional model critique) remains an independent advisory signal alongside deterministic QA, mutation testing, runtime readback, and human promotion judgment.

No model review may silently rewrite the specification or promote an inference into project authority.

## Proposed migration sequence

If the hypothesis survives review:

1. Pin the chosen released SpecD CLI/schema versions in repository tooling.
2. Add an upstream CLI validation route for SpecD/config changes.
3. Repair the six structurally invalid existing specs **without changing their intended semantics**.
4. Run a read-only compliance audit comparing those specs with implementation/tests.
5. Reassess which current raw-sidecar tests and reviewer instructions can be replaced by upstream semantic commands.
6. Pilot one new meaningful change through the normal SpecD lifecycle before declaring it the repository default.
7. Evaluate upstream fast-track only when the pinned toolchain actually exposes the required commands.

## Explicit non-goals

- no mandatory approval ceremony for every edit;
- no bulk rewrite of working code to satisfy documentation aesthetics;
- no claim that specs are always right when code and spec disagree;
- no unreleased SpecD `main` as an implicit runtime dependency;
- no replacement of deterministic tests with model review;
- no treatment of SpecD as repository merge authority.

## Questions for independent reviewers

1. Does this proposed split between substantial semantic changes, trivial maintenance, and code-first exploration match SpecD's intended usage, or does it violate an important lifecycle invariant?
2. Is pinning the released CLI while treating upstream `main` only as research input the safest adoption strategy here?
3. Is replacing direct `spec-lock.json` inspection with semantic CLI/context surfaces directionally correct? What compatibility caveats apply to 0.2.0?
4. Is `specd spec validate --all` the right structural gate for canonical spec changes, or should another upstream validation command be preferred?
5. How should an existing brownfield repository migrate canonical specs that were written outside a SpecD change lifecycle without falsifying history?
6. Are we underusing project context/code graph/compliance capabilities that would materially reduce semantic drift?
7. Which parts of this proposal add process without enough failure-prevention value and should be removed?

## Evidence status

This draft intentionally distinguishes:

- **FACT** — directly observed repository/upstream/CLI behavior;
- **INFERENCE** — the proposed adoption pattern derived from those observations;
- **UNKNOWN** — whether the proposed pattern is the best fit until independent review and a small real pilot are completed.

Issue #52 remains the coordination/evidence record for this audit.
