# Dreaming Worker Core Contract

## Purpose

Dreaming Worker is a bounded background analysis workflow.

It consumes explicitly permitted evidence, asks one or more independently routed models for structured candidate interpretations, validates those outputs against the supplied evidence, preserves disagreement, and produces auditable proposals and run receipts for later human or independent evaluation.

It is not a search engine, not a general autonomous agent, and not a canonical-memory writer.

## Requirements

### Requirement: Evidence remains separate from interpretation

Accepted source material and Session Search projections MUST remain evidence. Model-generated summaries, inferences, and hypotheses MUST remain derived interpretations unless independently promoted by a separate authority process.

Retrieval success, retrieval frequency, model confidence, or model agreement MUST NOT by themselves convert a derived proposal into source truth.

### Requirement: Every derived proposal is typed and provenance-bearing

Every accepted proposal MUST be typed as exactly one of:

- `FACT`
- `INFERENCE`
- `HYPOTHESIS`
- `UNKNOWN`

Every proposal MUST preserve exact evidence references and evidence hashes from the bounded input packet.

A `HYPOTHESIS` MUST include a falsifier, required evidence, competing explanations, and explicit uncertainty.

An `INFERENCE` MUST keep its assumptions explicit.

An `UNKNOWN` MUST state why stronger classification is not justified and what evidence would reduce the uncertainty.

### Requirement: No accepted evidence means no model work

When the evidence gate accepts no new evidence, the worker MUST terminate without external model inference.

A scheduler wake-up, retry, duplicate trigger, or unchanged checkpoint MUST NOT create paid model work by itself.

### Requirement: Independent first passes remain independent

When more than one model is used for the same evidence packet, each independent first pass MUST receive the same bounded primary evidence before it sees another model's judgment.

Two endpoints serving the same underlying model family MUST NOT be counted as independent perspectives merely because the provider route differs.

Cross-model critique or synthesis MAY happen only after the independent first-pass outputs are frozen and auditable.

### Requirement: Disagreement is preserved

The worker MUST preserve contradictory proposals, alternate explanations, uncertainty, and failed-provider outcomes.

Majority vote or model consensus MUST NOT be used as a truth criterion.

Any later comparison or critique output MUST reference the original independent proposals rather than silently replacing them.

### Requirement: Model output is untrusted data

Model output MUST pass deterministic schema and provenance validation before it can become a worker proposal.

Model output MUST NOT determine runtime facts such as model-call counts, tool use, memory use, canonical writes, permission state, or receipt authority.

Model output MUST NOT direct execution, expand permissions, write canonical memory, or publish externally.

### Requirement: Failure and cost boundaries are explicit

Provider timeouts, 429 responses, revoked credentials, malformed output, partial execution, and unavailable routes MUST remain visible typed failures.

Retries MUST be bounded.

Input/output tokens, model-call count, concurrency, and external data egress MUST be bounded before invocation.

A failed or partial run MUST NOT be reported as complete.

### Requirement: Runtime, persistence, and authority remain separable

The worker core MUST remain portable across authorized runners and MUST NOT make correctness depend on Mastra, exe.dev, one model provider, or one production runtime.

Execution checkpointing, proposal persistence, and original evidence storage are different responsibilities.

Future durable proposal storage MUST be append-only or supersession-linked; a new proposal MUST NOT silently overwrite an earlier proposal.

### Requirement: Canonical promotion is outside the worker

The worker MAY produce evidence-linked candidate proposals and review artifacts.

It MUST NOT automatically promote those proposals into:

- user preferences;
- canonical memory;
- Session Search source history;
- project policy;
- ranking policy;
- external publication.

Promotion requires a separate authority path.

### Requirement: State claims are evidence-bound, not lexically inferred

A runtime, deployment, review, capability, or authority state MUST be claimed only from evidence that establishes that exact state.

Terminology from one layer MUST NOT silently promote a claim in another layer. In particular:

- `production mode` does not establish an operating production service;
- a deployed version does not establish go-live or introduction into operation;
- configured does not establish available;
- available does not establish invoked or completed;
- review requested does not establish review completed or clean;
- green deterministic checks do not by themselves establish acceptance or promotion authority.

This failure mode is treated as **lexical state leakage**: a familiar token or label biases interpretation toward a stronger lifecycle or authority state than the evidence supports.

When lexical state leakage is possible, the stronger state MUST remain unclaimed until its own observable postcondition is verified.

## Runtime Lifecycle Status

Cloudflare Workers is the selected target runtime, but the current Cloudflare state is **pre-operational acceptance**.

The following states are intentionally distinct:

- target runtime selected;
- build/configuration ready;
- technical version or deployment exists;
- bounded acceptance canary executed;
- explicitly authorized go-live / introduction into operation;
- operating production service.

Earlier states MUST NOT be described as later states merely because a deploy command succeeded or a provider holds a deployed version. As of the current specification, Dreaming Worker has **not** been introduced into operation and is **not** a production service.

## Current Implementation State

Implemented and verified:

- Pilot 0 deterministic evidence/provenance gate;
- Pilot 1 one bounded external inference;
- Pilot 2 two configured-distinct blind first passes with typed partial/fail-closed outcomes;
- generic OpenAI-compatible provider adapter plus bounded live Pilot 2 composition;
- deterministic critique input/artifact contract over frozen Pilot 2 perspectives;
- bounded live critique inference over frozen critique input;
- typed proposal schema;
- exact source-reference and evidence-hash validation;
- deterministic outer receipt;
- one-inference / zero-tool / zero-memory runtime witness;
- safe synthetic/publication-safe scope.

Not yet implemented:

- multi-step or iterative conclave beyond one bounded critique call;
- durable hypothesis ledger;
- durable worker checkpoint;
- unattended accepted-source delta reader;
- private Session Search evidence egress.

## Spec Dependencies

- `default:pilot1/bounded-inference`
