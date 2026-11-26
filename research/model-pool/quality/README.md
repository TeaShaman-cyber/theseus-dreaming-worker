# Dreaming Worker semantic quality pilot (#89)

Research only. No production model selection, private source intake, ledger or
scheduler change. Builds on PR #90 and the Hindsight reference audit in #89.

## Protocol frozen before inference

Original synthetic RU/EN cases and manual rubric: commit
b3c0b47d86762763664fd768532b80acb0075eb0; cases.json SHA256
f328422d67be4f318ee1398fc8f9da183d5ac97994a78721fa9d3f6616dcc84f.
Runner at 8c9f8b3618ebfd821f35490e62edaa50d30c3441; production code inherited
unchanged from 2b63396e7c03f01f209c66f6fb4c5be15a6f5d57.
Inspired by Hindsight system evals (pinned upstream revision
47831d5c39010a5c30e9ac2aa16145f7048e930f) and prior Theseus
memory-provider-lab#16; no private bank or third-party case text used.

Six tasks cover supersession, authority, partial coverage, dissent, a falsifiable
hypothesis and separated context with 24 irrelevant entries. The long case is
not a measured chunk-split or a real long-context benchmark. All cases use
actual Proposal v1 and exact hashed synthetic evidence. A separate no-data
control uses the actual Pilot1 gate and must call no model.

Three explicit free routes: Solar Mini4 (Nous), HY4 Flash (Nous), ERNIE 5.5
Flash preview (OpenRouter). Each independently passed fresh zero-price catalog
check at invocation. Six tasks per route, one attempt per task, 30 seconds,
1024 max output tokens including reasoning as counted by the provider,
JSON-object response. No retries, automatic substitution or paid/subscription
fallback. Nous requests carried the experiment tag user=theseus-review, as in
the previous live synthetic cycle. NIM catalog did not supply proof of zero
price and was not invoked. No changes to service config. The fixtures, task
and production system prompt were identical across routes; rubric was not
transmitted. This cap was an experimental choice, not a universal budget.

## Results

| Route | HTTP 200 | Validated | Frozen rubric satisfied | No additional fidelity issues |
|---|---:|---:|---:|---:|
| Solar | 6/6 | 4/6 | 3/6 | 2/6 |
| ERNIE | 6/6 | 0/6 | not assessable | not assessable |
| HY4 | 6/6 | 0/6 | not assessable | not assessable |

13 responses ended with length; one Solar response ended normally but had an
unrecognized schema field. All 18 responses reported zero cost. Total observed
usage: 29,543 input, 16,719 output, 46,262 tokens; reported reasoning 11,771
(included in output, provider counting conventions not normalized).
Provider billing independently unverified. Nous raw upstream provider identity
absent, so the adapter's provider value is the configured route, not proof of
actual backend. Raw observed model ID matches configured ID for every call.
All attempts completed, no quota/transport failures on this sample.

Semantic review is single assistant judgment, not independently blinded.
Frozen required propositions and specified traps are scored separately from
additional fidelity issues discovered during review. The latter is exploratory,
not a retroactive change to the frozen rubric. Nonvalidated outputs are not
semantic failures: their quality is unknown. They are operational noncompletion
at this particular budget. Observations store validated proposal objects,
receipt and transport metadata; failed raw outputs are not retained, so a
serializer evaluation cannot be inferred.

Solar: authority and partial-coverage tasks clean. Supersession: both required
claims correct but additional uncertainty contradicts explicitly signed
supersession. Long: correct decision mapping but the first FACT does not cite
the register needed for the names; later differently typed proposals cannot
repair the missing reference. The hypothesis had invalid structure and dissent
was truncated. No specified hard-negative trap in the four validated outputs.
See observations.json for exact proposals and per-criterion annotations.

## Verification and next experiment

```sh
node research/model-pool/quality/run.mjs --check
node research/model-pool/quality/verify.mjs
```

The offline verifier checks fixture hash, coverage of all 18 attempts, packet
and request fingerprints, exact schema/provenance via actual production parser,
and manual review bookkeeping including required source/type support. It does
not independently prove semantic correctness or cash billing. The live runner
requires explicit route selection and a new output file; it is not normal CI.

Inference: eligibility for a pool must include task/prompt/output-budget fit.
All three routes were transport-available, yet two reasoning routes consumed
the output budget with no usable result. Do not blacklist them for semantic
quality or rank them from this result. A fixed token cap is not a fair universal
measure of cognitive capability, but it is a meaningful operational constraint.

Next controlled research: compare the same frozen cases at a separately bounded
larger output limit (e.g. 2048 or 3072), especially reasoning versus
nonreasoning routes, with repeated samples and independent semantic review.
Then compare simple task-aware selection against weighted rotation under
failure traces and budget constraints. Include Hindsight-like long-batch
contradiction/currentness cases, with split versus unsplit controls. Keep
durable missing-perspective recovery in #89 separate from model quality;
no new model or policy chosen by this small sample.
