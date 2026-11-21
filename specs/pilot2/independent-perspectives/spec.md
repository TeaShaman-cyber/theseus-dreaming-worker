# Pilot 2 — Independent Model Perspectives

## Purpose

Pilot 2 is the next bounded implementation step after Pilot 1.

It asks two genuinely independent model families to analyze the same synthetic or publication-safe evidence packet without seeing each other's first-pass output, validates both outputs deterministically, and preserves agreement and disagreement without treating consensus as truth.

Pilot 2 does not introduce private Session Search intake or canonical-memory writes.

## Input Contract

Pilot 2 consumes:

- one Pilot-0-compatible bounded evidence packet;
- explicit safe scope: `SYNTHETIC_FIXTURE` or `PUBLICATION_SAFE`;
- one task;
- two approved model routes;
- explicit model-family identity for each route;
- bounded per-route timeout/token/cost configuration.

Both passes MUST use the same evidence-packet fingerprint and task.

## Output Contract

A Pilot 2 result contains:

- the exact input evidence fingerprint;
- the exact request/task fingerprint;
- two independently validated first-pass result records when both succeed;
- typed provider failures when a pass fails;
- provider, actual model, and route provenance where observable;
- one deterministic run receipt;
- an explicit deterministic comparison artifact that preserves:
  - exact structured matches;
  - pass-specific proposals;
  - the fact that semantic relation is unresolved without a later critique layer.

The comparison artifact is descriptive. It MUST NOT infer semantic contradiction from free-form claims, and it MUST NOT promote a proposition to truth merely because both passes agree. The original validated proposal sets remain intact so later critique can inspect agreement, contradiction, and uncertainty without losing first-pass dissent.

## Requirements

### Requirement: The two first passes are genuinely independent

The two configured routes MUST declare different model-family identities.

Two provider endpoints declaring the same base model family MUST NOT satisfy this requirement.

The first bounded orchestrator proves only `CONFIGURED_DISTINCT`: it rejects equal configured family identities before inference and preserves observed provider/model metadata from each pass. Stronger transport-level family verification belongs to the provider adapter. If route identity is invalid or configured independence cannot be established, Pilot 2 MUST return `FAIL_CLOSED` rather than claiming two independent perspectives.

### Requirement: First-pass isolation is blind

Pass A MUST NOT receive Pass B output before completing.

Pass B MUST NOT receive Pass A output before completing.

Any optional critique/conclave phase MAY start only after both first-pass artifacts are frozen.

### Requirement: Both passes see the same primary evidence

Both first passes MUST receive the same evidence packet, evidence fingerprint, task, coverage/currentness state, and safe scope.

Per-provider prompt wrappers MAY differ only where required by the provider adapter; they MUST NOT alter the semantic evidence set.

### Requirement: Each pass uses the Pilot 1 proposal contract

Each successful pass MUST produce a valid `theseus.dreaming-worker.proposals.v1` proposal set.

Each pass MUST independently pass schema and exact-provenance validation.

A malformed or provenance-invalid pass is a typed failure, not a valid perspective.

### Requirement: Terminal state distinguishes absence from analysis failure

`NO_DATA` is reserved for the case where Pilot 0 accepted no new evidence and therefore no model work was attempted.

After evidence has been accepted:

- `COMPLETE` means two valid configured-distinct first-pass perspectives;
- `PARTIAL` means exactly one valid perspective and one typed pass failure;
- `FAIL_CLOSED` means no valid perspective remains, configured independence cannot be established, or the route plan is invalid.

Provider/model failure after accepted evidence MUST NOT be collapsed into `NO_DATA`.

### Requirement: Pass failure and receipt uncertainty stay explicit

Provider-adapter and proposal-validation failures MUST be normalized into typed pass failures rather than erased behind transport success. The bounded implementation distinguishes at least:

- `TIMEOUT_UNKNOWN_PROVIDER_STATE`;
- `OUTPUT_BUDGET_EXHAUSTED`;
- `EMPTY_FINAL_CONTENT`;
- `JSON_VALIDATE_FAILED`;
- `INVALID_JSON`;
- `INVALID_SCHEMA`;
- `PROVENANCE_REJECTED`;
- `POLICY_VIOLATION`;
- `INFERENCE_FAILED`.

The Pilot 2 receipt MUST NOT equate invoking an inference callback with a confirmed external model call after failure. Successful Pilot 1 receipts contribute to `confirmedExternalModelCalls`; failed invoked passes contribute to `unresolvedExternalCallAttempts`.

Configured route identity and observed provider/model metadata MUST remain separately inspectable.

### Requirement: Partial provider failure remains visible

If one first pass succeeds and the other fails, the run MUST return a partial result containing:

- the valid successful pass;
- the failed route identity;
- the typed failure;
- a receipt showing that two-perspective completion was not achieved.

The worker MUST NOT silently retry with an unapproved substitute model and MUST NOT present the one successful pass as a two-model conclusion.

### Requirement: Comparison preserves dissent

Comparison MUST be based on already-frozen validated first-pass records.

The first bounded implementation MUST compare exact structured proposal fingerprints deterministically and preserve pass-specific proposals. It MUST leave semantic relation explicitly unresolved rather than pretending to detect contradiction from free-form claims.

The comparison layer MUST NOT collapse disagreement into a consensus score or majority-vote truth.

### Requirement: Critique is optional and later

Pilot 2 MAY support a later critique/conclave pass, but the first implementation MUST NOT require it.

If critique is added, it MUST receive references to frozen first-pass artifacts and MUST remain a derived proposal, not an acceptance authority.

### Requirement: Pilot 2 remains synthetic/publication-safe

Pilot 2 MUST NOT widen data egress beyond the scopes already accepted for Pilot 1.

Private or unclassified Session Search evidence remains outside Pilot 2 until a separate source-reader and egress authorization is verified.

### Requirement: No-data still short-circuits before inference

If Pilot 0 returns `NO_DATA`, Pilot 2 MUST make zero external model calls.

## First Implementation Boundary

The first code increment SHOULD implement:

1. a provider-route identity structure containing provider/model/model-family;
2. a two-pass orchestrator over the existing Pilot 1 validation contract;
3. deterministic proof that both passes receive the same request/evidence fingerprints;
4. typed `COMPLETE | PARTIAL | NO_DATA | FAIL_CLOSED` outcome;
5. preservation of both first-pass proposal sets and typed failures;
6. a deterministic exact-structured comparison that does not make semantic truth judgments.

The first pure orchestrator receives injected inference functions. Provider HTTP adapters are responsible for bounding timeout/token/cost and for supplying observed provider/model metadata; those live adapters are not implemented in this slice.

It SHOULD NOT yet implement:

- critique/conclave;
- durable ledger;
- real private Session Search intake;
- scheduler;
- automatic memory promotion.

## Spec Dependencies

- `default:worker/core-contract`
- `default:pilot1/bounded-inference`
