# Live pooled analysis and critique: weak-signal case (#124)

Executed 2026-11-28 UTC against accepted source 76f70cd8964c5ca8194e9e024a3cdeccc8e6616c. The frozen signal fixture is from the existing quality pilot, not a held-out test. Synthetic evidence only. Actual provider calls use the existing OpenAI-compatible adapter and durable pooled runner, not mock inference.

## Observations

| Route | HTTP | Outcome | Reported total tokens | Reported cost |
| --- | --- | --- | ---: | --- |
| Solar Mini4 / Nous | 200 | INVALID_SCHEMA | 2229 | 0 |
| Gemma 4 26B / OpenRouter | 429 | RATE_LIMITED | unknown | unknown |
| Step 3.7 Flash / Nous | 200 | HYPOTHESIS validated | 4027 | 0 |
| Nemotron 3.5 Lightning / NVIDIA | 200 | HYPOTHESIS validated | 2767 | unknown |
| Solar Mini4 / Nous critique | 200 | UNRESOLVED artifact validated | 2569 | 0 |

Four analysis attempts total, one separate critique attempt. 4096 output tokens and 60s adapter deadline per attempt; NVIDIA reasoning_budget=768 (transport option from earlier research, not a runtime default). Fresh zero-price catalog checks for Nous/OpenRouter; NVIDIA developer research entitlement documented in #89 and fresh catalog membership, not zero-price proof. No paid fallback or repeated request to OpenRouter. Configured route identities are not independently observed backend identities. Total 11592 reported tokens, billing independently unverified. Initial Solar raw final content was not retained; its specific schema defect remains unknown.

First isolated PG17 database returned INSUFFICIENT_ELIGIBILITY, no completion; removed. Continuation reconstructed the exact five recorded journal entries through the actual store in a *new* isolated PG17 database (not recovery of the original physical database), then invoked only the remaining two distinct eligible routes. Both proposals validated; independent SQL 1 completion and 2 proposals. Fresh store replay returned ALREADY_PROCESSED with zero calls and exact projection. Second database removed. Separate critique is derived-only, not a ledger commit or truth adjudication. All persistent results here concern synthetic artifacts.

## Semantic review (manual, not blinded or independent)

Frozen rubric: a falsifiable route hypothesis citing before/after, and matched-input comparison controlling length, with length as rival explanation.

- Step meets both requirements. Statistical significance is phrased as a hypothesis, not an observed statistical test; wording could still be more cautious. Lists input length, random variation and simultaneous parameter change as rivals. Explicitly asks for replication.
- Nemotron meets the broad hypothesis requirement, but introduces an unsupported context-load mechanism and does not explicitly consider input length alone as an alternative. Falsifier at 500 tokens does not refute the conditional extended-context mechanism. Second rubric requirement not fully met.
- Solar critique leaves causal attribution unresolved and requests controls; it overstates difference between falsifiers (both require fixed input size), and describes hypotheses as attribution. Valid relation references do not establish accurate comparison. A 2×2 matched-input experiment (old/new route × short/long input), with repeated randomized identical cases and negation-specific scoring, distinguishes route, length and interaction effects. The present sample cannot establish significance or a causal effect.

No production model ranking or semantic acceptance follows. Mechanical acceptance remains distinct from semantic usefulness. The next useful comparison is held-out evidence-linked cases, not additional repetitions of the storage canary.

## Reproducibility

`node research/model-pool/live-acceptance/verify.mjs` verifies retained hashes, exact journal prefix and replay, production proposal parser, completion projection and critique references. No network or database needed. It checks artifact consistency, not independent semantic truth or upstream billing.

The three executed scripts are retained as exact .mjs.txt evidence (runtime-local paths, no API keys), not automatic launchers. Logs are JSON-reserialized with provider request IDs omitted; manifest preserves original and retained digests. Actual run commands used isolated loopback PostgreSQL with the accepted migration and runtime role. A new live run requires explicit bounded admission and fresh catalog/entitlement evidence. This test used the actual pooled worker; a live external-model end-to-end Cloudflare/source transport composition remains unverified.

Issue #124 records the actual provider and database witnesses.

## Prepared held-out source-cycle test

`generate-live-source.py` uses the pinned actual Session Search producer
3b7b5360050cc2ecdcb60f485a657f2b763751e4 to generate the synthetic Birch
conversation, verify source bundles and create a handoff containing one selected
session. The saved fixture SHA256 is
a933a58167902c34dfa36c150bb37d3836fdafe494901829f0fc026767e0de39.
Catalog readback is simulated; no live source completeness claim.

Offline Dreaming Worker admission passed with one work. The planned real-model
source cycle against dedicated Neon was blocked by the host before runner
creation; independent Neon readback found zero checkpoints under
live-birch-124-v1. This is a prepared fixture, not a second measured semantic
sample, and no alternate route was attempted to bypass the host refusal.

Frozen semantic criteria for the future experiment: preserve the observed
2/40 to 11/40 change; distinguish the scheduler from simultaneous concurrency
change 1 to 8; give an explicit rival explanation and a controlled falsifier
(e.g. matched workloads at both concurrency levels under each scheduler);
do not assert that a causal effect or deployment state was independently proved.
