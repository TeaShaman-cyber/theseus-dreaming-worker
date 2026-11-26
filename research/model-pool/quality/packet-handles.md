# Packet-local evidence handles: deterministic boundary experiment

Research #89 / structured-output #54; base 246dca35cb5f48fe59740bac2459cff17416cc7e.
No runtime change, automatic repair, new inference stage or canonical writes.

## References and transfer

- Theseus Research #124 (PyBot source audit, revision
  7d63c7fbebb44c7e466e5c8b5c1f341ab767929e): separate reusable explicit rules
  from expensive model work; do not inherit mutable history or heuristic
  arbitration as truth.
- Theseus Research #120 (JSON tooling): Biome for tracked JSON, strict lexical
  parsing for untrusted input, schema for shape, domain checks for exact
  provenance. jq alone is insufficient. #54 already prioritizes deterministic
  recovery and rejects truncated/ambiguous semantic output.
- Rechecked installed Biome 2.6.8 with normal temporary .json files:
  valid accepted; ordinary duplicate keys, concatenated objects, NaN and
  trailing comma rejected. Escaped-equivalent keys {"a":1,"\u0061":2}
  were accepted. Stdin lint invocation returned nonzero even on valid input,
  so that invocation is not used as a runtime guard. Existing canonical
  parseProposalSet accepts duplicate claim keys with last value winning;
  reproduced with the observed valid proposal. Track in existing #54.
  Biome is useful, not a complete strict runtime decoder.

## Mechanism and boundaries

A cloned synthetic request packet is bound by its existing request/evidence
fingerprint. Map each unique source to an exact E1..E64 handle; send the
unchanged evidence texts and task, a distinct research schema, not the original
hashes. Reject duplicates, unknown handles, wrong caller-held request binding,
truncated/unknown finish, extra fields and malformed JSON. Python stdlib
object_pairs_hook rejects duplicate decoded keys (including escaped keys)
before Node JSON.parse; existing Zod/canonical parser validates the expanded
proposal. No handwritten JSON grammar, no new dependency in production.
This is a research subprocess guard, not a proposed Cloudflare runtime.
The test of text digest equality applies to these synthetic fixtures only.
A handle is local to a bound request; caller-held pairing is required and
E1 alone cannot authenticate stale/arbitrary replay. Valid refs do not imply
semantic entailment. Do not change the canonical ledger or inference receipt.

Offline: four previously validated Solar artifacts round-trip exactly;
compact JSON 6065 bytes vs canonical 8299 bytes. Seventeen negative controls
pass. This measures serialized artifact bytes, not provider token savings.
Canonical validation and exact evidence restored; no claim of semantic
correctness of the historical artifacts.

## Live observations

Frozen authority case, existing transport adapter, NIM Lightning, cap 3072,
reasoning_budget 768, 60s timeout, separate experimental compact prompt.
Original full-hash reference measurement in PR #93.

1. First condition e49063625634c48955aedf0abe4f31fee1367bd6:
   native schema including uniqueItems -> HTTP400, 167ms; no usable content;
   exact provider error details unavailable.
2. One separate condition ddce7d229d0af34327246f46a820afa42cdd7084:
   removed uniqueItems only from provider-facing schema (prompt schema and
   local rejection unchanged). vLLM XGrammar documentation identifies that
   keyword as unsupported for arrays:
   https://docs.vllm.ai/en/stable/api/vllm/v1/structured_output/backend_xgrammar/
   The successful alternate condition supports a compatibility explanation;
   actual hosted backend and first error message are unknown.
   HTTP200, stop, 4360ms, 894 input/1065 output tokens, 767 reasoning tokens.
   Local canonical parser accepted, every source/hash exactly restored.
   Full-hash sample: 1424 input/1462 output/767 reasoning, 5684ms;
   one missing final hash digit rejected. Single samples with changed
   representation; not statistically established quality/latency advantage.

Both process exits 0 and log/observation byte equality read back. Cost
unreported; developer research entitlement, no per-response price proof.
No retry after unknown outcome or rate limit. No private source. Store only
synthetic final content; no hidden reasoning retained.

Manual semantic review (not independent): first FACT accurately attributes
the assistant report. Second INFERENCE reports R6/R7 distinction but not the
required FACT/UNKNOWN with CI evidence uncertainty. Third HYPOTHESIS mentions
test-only approval as rationale rather than the required FACT. Both frozen
authority rubric requirements are not fully met. Also required_evidence
contains local E2/E3 strings, not durable references or genuinely missing
evidence. Do not treat this as a clean quality pass or promote to durable
ledger. The experiment proves the mechanical source_refs path only; handle
escape in other semantic text fields remains an open design/quality risk.
No automatic rewrite of free text.

## Verification

```sh
node research/model-pool/quality/test-handles.mjs
node research/model-pool/quality/verify-handles-observation.mjs
```

Next: preserve canonical semantics; evaluate output contracts for other
reference-bearing fields and improve task/type instructions on held-out
cases. Keep runtime lexical ambiguity protection in #54 and the existing
routing/recovery work in #89. No additional serialization LLM justified.
