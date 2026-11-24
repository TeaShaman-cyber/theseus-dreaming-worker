# Serializer benchmark v1 — offline contract

Scope: theseus-dreaming-worker#54. Synthetic, publication-safe fixtures only.

The portable evaluator is `evaluateSerializerFixture` in
`src/dreaming/serializer-benchmark.ts`, with frozen cases in
`fixtures/serializer/contract-v1.json` and deterministic tests in
`test/serializer-benchmark.test.mjs`.

It never calls a model, retries a provider, reads live evidence, writes memory,
or promotes a proposal. It consumes a candidate output **after** a caller has
performed any separately authorized, budgeted inference. This is not a live
serialization pipeline or a production acceptance authority.

Only an exact preserved raw-output snapshot, explicit `finishReason=stop`,
and a prior `UNSTRUCTURED_COMPLETE` / `SCHEMA_MISMATCH_COMPLETE` eligible
classification can enter evaluation. All other cases return `NOT_ELIGIBLE`
and do not inspect the offered candidate.

For eligible cases, JSON syntax, Proposal v1 shape, and exact accepted
source-ref/hash pairs are checked in that order. A synthetic golden artifact
then serves as a *test oracle*, not an assertion of real-world truth:
- `EXACT_GOLDEN_MATCH`: normalized typed artifact equals the fixture oracle;
- `GOLDEN_MISMATCH`: the output passes the schema/reference checks but differs;
- `SCHEMA_VALID_UNREVIEWED`: no oracle; **semantic preservation UNKNOWN**.

The positive v1 synthetic cases explicitly contain the claim, proposal type,
and every expected source-ref/hash pair in the frozen raw answer. The missing-
original-provenance case has no oracle: even an output with a packet-valid
reference is only SCHEMA_VALID_UNREVIEWED, never a benchmark success.
The literal-field fixture regression is a corpus consistency test, not a
general semantic proof or production provenance verifier.

The evaluator records raw/candidate fingerprints and zero evaluator-side
external calls/writes. Candidate inference time, tokens, cold start, memory,
transport, and provider cost must be recorded independently by the future
benchmark adapter from actual measurements, not invented by this evaluator.

To test locally: `node --test test/serializer-benchmark.test.mjs`.
Canonical repo gate: `./tools/dev/check`.

Out of scope: selecting a model, calling an API, retrying, repairing missing
semantic evidence, relaxing provenance, or promoting an output to truth.

## Candidate execution receipt

`runSerializerCandidateBenchmark` in
`src/dreaming/serializer-benchmark-runner.ts` is the bounded execution seam
used before any route-specific benchmark adapter is added.

It enforces these mechanics:

- an ineligible reasoner result causes zero candidate executor invocations;
- an eligible result permits exactly one executor invocation and no retry;
- the serializer input contains only the frozen raw reasoner output and the
  target Proposal v1 JSON Schema — not the evidence packet or golden oracle;
- the runner measures wall time around that one invocation;
- candidate-reported cold-start, peak RSS, token usage, and monetary cost are
  separately validated observations, not inferred values;
- absent monetary cost remains `UNKNOWN`, never an assumed zero;
- truncated or completion-unknown candidate output is fingerprinted but never
  sent to the deterministic benchmark evaluator;
- executor failure receipts deliberately omit raw exception text;
- every receipt fixes `canonicalWrites: 0`.

`LOCAL_MODEL` and `EXTERNAL_PROVIDER` are distinct candidate kinds. The host
(`EXE_DEV`, `GITHUB_RUNNER`, `LOCAL_RUNTIME`, `CLOUDFLARE`, or `OTHER`) is
recorded separately so execution location is not confused with provider
identity.

This layer still does not select, download, start, or call a real model.
A route-specific adapter must independently prove its own model invocation,
resource measurement, and any monetary-cost source.

## Local CPU baseline

The first local serializer baseline uses a loopback-only `llama-server` route.
The committed benchmark config is
`fixtures/serializer/qwen3-0.6b-q8_0-exe-dev.json`; the candidate corpus is
`fixtures/serializer/candidate-v1.json`.

The adapter in `src/dreaming/serializer-llama-server.ts` accepts only HTTP
loopback endpoints (`127.0.0.1` or `::1`), makes one bounded POST, never retries,
uses temperature 0 and strict JSON Schema response formatting, and sends only
the frozen raw reasoner output plus the Proposal v1 schema. It does not receive
the evidence packet or golden oracle.

`npm run serializer:local -- <corpus.json> <config.json>` runs the corpus through
the canonical candidate suite. Optional observed runtime metrics are supplied
as `SERIALIZER_COLD_START_MS` and `SERIALIZER_PEAK_RSS_BYTES`; absence remains
unknown rather than being replaced with zero.

The committed config pins the model/runtime identity and artifact hashes, but
does not contain mutable runtime measurements. The runtime/model binaries remain
outside Git under the issue-owned temporary cache described in #54.
