# Nemotron Lightning: bounded reasoning and native schema

Research #89; base 16499a5bc380437c62abc511059eaac84b7810ba.
PR #92 accepted, previous observations unchanged. Original frozen authority
case, same production system prompt, 3072 max output tokens, 60s timeout.
No production adapter/config change; experimental fetch wrapper only.

NVIDIA exact model API reference:
https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b/apireference
documents reasoning_budget (default 16384, explicit limit supported).
NVIDIA NIM Lightning guide:
https://docs.nvidia.com/nim/large-language-models/2.0.10/get-started/advanced/get-started-nemotron-3.5-lightning.html
recommends response_format plus client validation. Hosted support was not
assumed from container documentation.

| Condition | Reasoning | Total output | Latency ms | Result |
|---|---:|---:|---:|---|
| Previous unrestricted sample | 3072 | 3072 | 19378 | length, no final content |
| reasoning_budget=768, json_object | 767 | 1261 | 5463 | stop, schema mismatch |
| reasoning_budget=768, json_schema | 767 | 1462 | 5684 | stop, provenance mismatch |

One physical attempt per new condition; both HTTP 200, process exit 0,
EXIT_RECORDED, process log byte-identical to observation. Cost not reported.
Exact runners 720f65856005e49a349a8628db94e041408fa378 and
08265f07ea51a6ce20015083d27eee30d1189ecd respectively. One sample per
condition; latency improvement is observed, not statistically established.
Raw upstream provider absent; configured NVIDIA route and returned model
ID are distinct from verified backend identity.

First controlled response rejected unexpected additionalProperties key;
its raw content was not retained, so no claim about the rest of its semantics.
Native JSON Schema probe sends the exact existing proposal schema in
response_format, strict=true, with no changes to task/prompt. Final content
retained (synthetic only); reasoning text not retained. Existing Zod schema
accepts the decoded object. Existing parseProposalSet rejects it because
the report evidence hash is missing final character 4. Other source/hash
pairs match. This is one schema-conforming response, not proof that hosted
constrained decoding always works. No accepted artifact, no quality rating,
no inference about production readiness. Additional semantic issue:
test-only approval expressed as INFERENCE rather than the required FACT.
Do not promote or automatically repair this output.

Inference: copying long cryptographic digests through a generative model
adds a separate failure mode from semantics. Research candidate: model
selects bounded packet-local evidence handles, deterministic resolver
attaches original immutable ref/hash pairs and then validates the full
proposal. Unknown/ambiguous handles reject; exact evidence linkage and
semantic entailment remain separate checks. No hash guessing, fuzzy repair,
new authority, or change to accepted provenance contract. Compare this
candidate offline before any runtime design; existing #54 serialization
research is relevant. The five-case reasoning-rest condition was NOT run
because the prerequisite authority probe failed validation.

Recheck recorded native-schema output with the existing parser, no network:
node research/model-pool/quality/verify-nim-reasoning.mjs
