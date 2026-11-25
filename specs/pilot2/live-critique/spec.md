# Pilot 2 — Bounded Live Critique

## Purpose

This layer performs exactly one bounded critique-model call over an already frozen `CritiqueInput`.

It does not change Pilot 2 first-pass artifacts, does not retrieve new evidence, and does not decide truth. The returned critique remains `DERIVED_ONLY` and is accepted only after deterministic `parseCritiqueArtifact` validation.

## Requirements

### Requirement: Input

- one `CritiqueInput` built from a frozen Pilot 2 `COMPLETE` or `PARTIAL` result;
- one explicit provider route with id, provider, model, model-family, base URL, timeout, output-token bound, and optional runtime bearer credential.

The model receives only the supplied critique input. No tools, memory, retrieval, private Session Search context, or canonical state are available.

Wire-level OpenAI-compatible HTTP/SSE execution is delegated to the shared provider transport used by the existing provider adapter. This layer owns only critique-specific prompt construction, transport-code mapping, deterministic artifact validation, and the critique receipt. Provider-specific/model semantics MUST NOT be moved into the shared transport.

### Requirement: Model-facing contract

The system prompt MUST embed `critiqueArtifactJsonSchema`, generated from the same Zod contract used by `parseCritiqueArtifact`.

The critic MUST be instructed to:
- return one JSON object only;
- compare frozen perspectives without choosing a winner or declaring truth;
- use only supplied proposal/evidence references;
- keep authority exactly `DERIVED_ONLY`.

### Requirement: Execution bounds

One invocation performs at most one external critique-model call.

The route MUST provide a positive integer `maxOutputTokens`. Timeout is bounded explicitly or by the bounded default.

There are no retries in this increment.

### Requirement: Failure semantics

Transport and analytical validity remain distinct. The live layer preserves typed failures for rate limiting, timeout with unknown provider state, empty final content, output-budget exhaustion, ordinary HTTP failure, malformed transport response, invalid critique JSON/schema, and invented proposal/evidence references.

Free prose or structurally invalid model output is not partial success.

### Requirement: Receipt

The outer receipt records configured route identity separately from observed provider/model metadata, explicit bounds, one attempted external call, and zero tools, memory, and canonical writes.

Model prose is never authoritative for provider identity or execution metadata. Runtime credentials are transport-only: they are sent only in request headers and MUST NOT appear in model input or receipts.

## Non-scope

No private Session Search intake, retrieval, scheduler, durable ledger, model router, majority vote, canonical promotion, publication, Cloudflare go-live, or production authority.

## Spec dependencies

- `default:pilot2/critique-contract`
- `default:pilot2/independent-perspectives`
- `default:worker/core-contract`

## Acceptance evidence

The first publication-safe synthetic acceptance sequence produced three distinct observed outcomes without automatic retry:

1. schema-echo output -> `CRITIQUE_SCHEMA_INVALID`;
2. provider response-body deadline -> `TIMEOUT_UNKNOWN_PROVIDER_STATE`; provider state remained `RESPONDED`;
3. bounded Qwen/Groq critique -> valid `DERIVED_ONLY` artifact with `AGREEMENT` and `UNRESOLVED` relations.

The successful receipt records exactly one external model call, zero tools, zero memory, and zero canonical writes. Full publication-safe artifacts are committed under `artifacts/acceptance/`.

