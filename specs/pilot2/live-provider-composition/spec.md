# Pilot 2 — Live Provider Composition

## Purpose

This layer composes exactly two explicit live provider routes into the existing pure Pilot 2 orchestrator without making Dreaming Worker depend on exe.dev, Cloudflare, or another execution host.

It does not redefine Pilot 2 analytical semantics. `runPilot2` remains the authority for independence checks, terminal outcomes, proposal validation, comparison, and receipt semantics.

## Input Contract

Live composition consumes:

- one existing Pilot 2 request in `SYNTHETIC_FIXTURE` or `PUBLICATION_SAFE` scope;
- exactly two route descriptors;
- explicit route id, provider, model, model-family, and base URL;
- a positive integer output-token bound for every route;
- a bounded timeout, using either the adapter's bounded default or an explicit route override;
- optional provider JSON-object response mode;
- optional bearer credential supplied at runtime, never embedded in the route artifact;
- optional transport-evidence observation.

Provider base URLs are caller/runtime configuration. The Dreaming Worker core MUST NOT hardcode exe.dev hostnames, gateway IDs, Cloudflare endpoints, or another execution host.

## Requirements

### Requirement: Live composition preserves the pure Pilot 2 contract

The composition layer MUST construct the existing OpenAI-compatible inference adapters and delegate to `runPilot2`.

It MUST NOT reinterpret `COMPLETE`, `PARTIAL`, `FAIL_CLOSED`, or `NO_DATA`, and MUST NOT invent consensus, fallback substitution, or new analytical authority.

### Requirement: Output work is explicitly bounded

Every live route MUST supply a positive integer `maxOutputTokens` value before any provider call is possible.

The provider adapter MUST transmit that value as the provider request's output-token bound.

The model-facing Proposal v1 contract MUST be generated from the same canonical Zod schema used for deterministic response validation. A handwritten duplicate schema MUST NOT become a second source of truth.

### Requirement: Invalid live configuration fails before network work

Missing route identity, missing base URL, missing/invalid output-token bound, or an invalid route count MUST be rejected before provider work.

Configured same-family routes MUST reach the existing Pilot 2 independence check and terminate `FAIL_CLOSED` before provider work.

### Requirement: Runtime/provider evidence stays separate

Configured route identity and observed provider/model metadata MUST remain separately observable.

Provider-specific JSON framing and bearer authentication are transport options only. They MUST NOT change Pilot 2 analytical semantics or become architectural dependencies on the current execution host.

Transport success MUST NOT be treated as proposal success. A returned artifact still has to pass Proposal v1 JSON, schema, provenance, and Pilot 1 policy validation.

Adapter failures already represented by Pilot 2's typed contract MUST keep that meaning across the composition boundary. In particular, `EMPTY_FINAL_CONTENT` and `OUTPUT_BUDGET_EXHAUSTED` MUST NOT degrade to generic `INFERENCE_FAILED`.

### Requirement: Scope does not widen

This layer MUST NOT add tools, memory, private Session Search intake, scheduler behavior, critique/conclave, canonical writes, durable ledger/checkpoints, or publication authority.

## Current Acceptance Signal

A bounded live synthetic run is valid evidence even when it returns `PARTIAL` or `FAIL_CLOSED`; those outcomes are part of the Pilot 2 contract and MUST remain explicit rather than being repaired into apparent success.

A bounded two-family acceptance run has also reached `COMPLETE` through the repo-owned CLI with two validated perspectives and deterministic divergence preservation. The full publication-safe artifact is stored at `artifacts/acceptance/pilot2-first-complete.json`.

## Spec Dependencies

- `default:pilot2/independent-perspectives`
- `default:worker/core-contract`
