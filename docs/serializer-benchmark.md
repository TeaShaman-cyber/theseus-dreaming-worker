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
