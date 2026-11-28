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

### Reproducible offline Birch preflight

Run `node research/model-pool/live-acceptance/preflight-heldout.mjs` from the
repository using the pinned Node runtime. The script validates the frozen
fixture SHA-256, then invokes the actual bounded source acquisition and work
planning pipeline over the recorded synthetic pages. It prints only metadata
and the derived work fingerprint. The predecessor is explicitly a preflight
placeholder, not a stored checkpoint. It neither initializes storage nor
dispatches inference. The normal QA suite includes the positive test and
rejection of changed fixture bytes in `test/heldout-source-preflight.test.mjs`.
A passing result is `PREFLIGHT_ONLY`, not live inference or deployment evidence.

## Held-out Birch live acceptance (2026-11-28)

The earlier host-blocked attempt above remains historical evidence only. A later
versioned runner completed the same frozen synthetic Birch source-cycle through
the real Dreaming Worker pooled source runner, Postgres store and provider
adapter on an isolated Neon branch. The source transport still replays the
recorded, independently verified synthetic page; this is not live Session Search
network serving and does not authorize private history.

One earlier live attempt left a process-loss-shaped partial journal after the
third dispatch. Its outer termination receipt was not retained in repository
evidence, so that attempt is deliberately excluded from this acceptance bundle
and is not used to attribute a watchdog cause.

The accepted isolated run on `live-birch-124-v3` used exact runner commit
`4c020d85bf5000666403169ddd4f64a8f77be40f` with a 300-second outer shell
bound. Fresh model catalogs showed every admitted route at zero
prompt/completion price. The source-cycle finished `ACKNOWLEDGED` after four
physical model calls:

| Route | HTTP / finish | Reported tokens | Worker disposition |
| --- | --- | ---: | --- |
| Step 3.7 Flash / Nous | 200 / length | 5571 | known `OUTPUT_BUDGET_EXHAUSTED` |
| ERNIE 5.5 Flash / OpenRouter | 200 / stop | 5293 | validated |
| HY4 Flash / Nous | 200 / length | 5550 | known `OUTPUT_BUDGET_EXHAUSTED` |
| Solar Mini4 / Nous | 200 / stop | 3274 | validated |

Every observed provider response reported cost `0`. Independent Neon readback
confirmed one durable completion, two validated model perspectives, nine
proposal records, and final source receipt
`sha256:ed35fa0e1e00ce4c48d611634a6d08e1bf5be6626006c68610a71c8a78d4e2bf`.
Exact replay returned `ALREADY_ACKNOWLEDGED` with zero model calls and the same
receipt.

The held-out semantic result is useful but remains derived evidence. ERNIE
explicitly identifies the scheduler/parallelism confound, retains high
uncertainty, and asks for matched-load controls. Solar also rejects causal
attribution and requests controlled evidence, but its wording sometimes
conflates the scheduler/planner change with the parallelism increase and one
inference assumes stable provider limits despite the fixture saying they were
not checked.

A separate read-only critique consumed the two completed perspectives. Exact
raw-capture runner commit
`7ea5e6652c177f42d5177c5623a673d7abcac5f5` made two explicitly bounded
Particle/OpenRouter calls over the identical critique input. The 4096-token
control returned HTTP 200 with `finish=length`, 4088 prompt tokens and 4096
completion tokens; its retained raw model text is truncated and the production
critique parser rejects it as `CRITIQUE_JSON_INVALID`. The 8192-token call
returned HTTP 200 with `finish=stop`, 4088 prompt tokens and 2993 completion
tokens; replaying the production parser over the retained raw text reconstructs
the retained `DERIVED_ONLY` critique exactly. Both calls reported cost `0`, used
one model call each, and made no canonical or ledger writes.

The successful critique records agreement on the observed before/after counts
and causal uncertainty, plus disagreement between scheduler-alone and
parallelism hypotheses. It requests matched-load comparisons, provider-limit
logs, and request-size measurements rather than adjudicating a winner.

`verify-heldout-live.mjs` is network-free. It checks retained file hashes,
reconstructs the canonical source plan from the frozen fixture, replays the
durable pool journal, reconstructs the complete work completion (checkpoint,
observed providers, records and projection fingerprint), compares that
reconstruction to the independent Neon export, verifies zero-call replay, and
replays the production critique parser over both retained raw model outputs.
The canonical test suite imports this verifier. `jsonb` bodies are retained as
text where ordering matters and are normalized through the same application
schemas before identity checks.

This acceptance proves the bounded synthetic source -> real models -> durable
Postgres completion -> source acknowledgement -> zero-call replay composition.
It does not prove live Session Search transport, production deployment, or
semantic truth.
