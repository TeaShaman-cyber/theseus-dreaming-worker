# Proposal: studio-source-preview

## Motivation

Issue #79: live Studio exposes zero workflows despite the implemented source-batch path.

## Current behaviour

The portable worker has source validation, batch planning, independent analysis and receipt validation. The development UI does not represent them.

## Proposed solution

Register a fixed synthetic preview workflow using the existing core functions, with stage schemas, graph readback and explicit simulated storage semantics. Keep the real PostgreSQL acknowledgement path outside the preview.

## Specs affected

### New specs

None.

### Modified specs

- `default:worker/core-contract`: no normative change; development projection of existing boundaries.
  - Depends on (added): none

## Impact

Studio graph, focused QA and development documentation only. No Cloudflare execution changes, source access, external inference or live ledger writes.

## Technical context

Issue #79 proved Mastra and LangGraph can wrap the same portable kernel. Retain existing Mastra/Cloudflare choice. Synthetic fixture and in-memory test adapter are not durable acceptance.

## Open questions

Visual coverage of optional critique and other paths remains a separate increment; full production orchestration is not implied.
