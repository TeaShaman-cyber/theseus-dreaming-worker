# Proposal: studio-bundled-smoke

## Motivation

Issue #79: isolated live Studio registered the graph, but executing it through HTTP failed ENOENT because the server changed its working directory after bundling. Unit tests and build-only QA both passed.

## Current behaviour

The preview reads a repository-relative synthetic fixture at runtime; bundled code cannot find it. The build gate does not start the bundled workflow.

## Proposed solution

Bundle the fixed synthetic fixture as a static JSON module, make TypeScript accept standard Node 22 JSON import attributes, and extend the existing build gate with a local synthetic workflow HTTP smoke.

## Specs affected

### New specs

None.

### Modified specs

- `default:worker/core-contract`: no normative change; strengthen development verification.
  - Depends on (added): none

## Impact

Development preview, TypeScript noEmit module syntax, existing build QA and docs. No production change or provider/DB access.

## Technical context

Keep the fixed fixture and existing portable functions. Build-only success is not runtime acceptance.

## Open questions

None within the synthetic preview.
