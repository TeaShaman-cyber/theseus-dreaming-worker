# Decision-critical claims: retrospective baseline (#97)

Research only. Existing frozen six-case corpus and four historically validated
Solar responses, not new samples or held-out evaluation. Actual strict canonical
proposal parser on main 5641aae5df9ee61180c293e9f6534ed8407d0ea3.
The fixture and observation bytes are pinned by SHA-256 in replay.mjs.

From the existing rubric, construct each obligation's required evidence set.
Manually map the exact historical proposals to obligations; mapping is a reviewed
semantic input, not inferred from the cited IDs. Compare the cheap packet-wide
union of citations with per-claim conjunctive coverage plus permitted type.
All eight obligations pass packet-wide coverage; seven pass per-claim checks,
matching prior retrospective manual required-criteria judgments. This is not
independent semantic accuracy evidence. Cedar's first FACT omits register/list
even though other claims cite it. The extra chronological/scope errors in decision
and long remain outside coverage checks.

Synthetic controls: adding the missing register reference makes coverage pass
(not a semantic repair or a new historical observation); removing it is detected
even when the packet-wide union stays sufficient. Changing the claim to false
while retaining correct references passes both coverage tests with the deliberately
stale mapping. This is an explicit limitation: mapping must bind exact claim
content; any change requires fresh review. Actual provenance parsing cannot prove
entailment, authority, temporal scope, or correct translation.

For a toy positive Boolean support expression D=(A OR C) AND B, exhaustive
subsets give minimal witnesses AB and BC, minimal cut sets B and AC. Replays
the earlier manual three-valued authority example: 27 assignments, 1 ALLOW,
19 DENIED, 7 DEFER. Conditional relevance is not current one-at-a-time
sensitivity. This is not a production policy or arbitrary graph solver.

References and provenance: repo-search-lab#126 (typed source-derived vs
elaborated edges); math-research-lab#24 (semantic mutations); tech-review-graph#2
(independent deterministic projections); https://arxiv.org/abs/2202.10766
(Boolean provenance); https://souffle-lang.github.io/provenance (lazy proof trees).
OpenAI Nov24 matrix multiplication preprint is inspiration, not an algorithm
for extracting or proving natural-language dependencies.

Reproduce: node research/decision-slicing/replay.mjs
Compare stdout byte-for-byte to replay-result.json.
Conclusion: KEEP cheap per-claim typed support check as a research baseline.
No demonstrated need for graph storage, tensor acceleration or new verifier
service. Next experiment needs genuinely new decision policies and blinded
claim-to-obligation extraction; compare against baseline, measure missed
dependencies, unsupported links and invalid strengthening. Until then automatic
extraction and decision-critical semantic ranking are UNKNOWN.

## Novel constrained extraction pilot

Frozen executed commit 113e69cf51faf499a5a68569ff16591e7465554e.
Two novel synthetic policy/evidence cases, with a fixed dictionary of candidate
atomic claims including decoys. Model sees policy, decision, candidates and
evidence; gold file is separate and not transmitted. This is constrained
selection/AND-OR rule extraction, not open-ended atom discovery or a blinded
independent benchmark. Exact output and costs are in extraction-observation.jsonl.
The existing provider transport and strict JSON boundary were reused.

Solar Mini4 via Nous free catalog, two calls, HTTP200/stop, reported cost zero.
Maple: 415 input/87 output tokens, 4780 ms. Structurally accepted but omitted
the alternative AB and its unknown B premise. Returned AC, which is currently
sufficient, so computed current decision ALLOW is right while rule is wrong.
This is decision-conditioned incompleteness, not evidence that AB is impossible.
Linden: 426 input/178 output tokens, 5972 ms. Correct two support sets,
but C is F rather than U (budget uninspected), and extra unused E is F despite
the source explicitly stating the assistant made that report. Rejected by
structural check for unused E; no accepted verdict. Even without that defect,
a correct decision under blocked authorization would mask the mistaken C state.
Do not remove E or change C to make the result pass.

Both raw final responses independently read back, launcher exit 0 and output
byte-equal to process log. Neither case is a full exact extraction pass.
Only two observations, no baseline paired inference or general accuracy claim.
No new runtime route, storage, model stage or paid authority. Prompt included
explicit T/F/U and all-minimal-sets instructions; a stronger prompt is a
hypothesis, not a demonstrated fix.

Conclusion: rule extraction and current evidence evaluation need distinct
obligations. Prefer deterministic policy graph where one is already owned.
For free-text policy use an advisory graph proposal and check the rule across
counterfactual valuations independently from the current evidence state.
Do not infer policy from current successful paths. The next controlled test
should separate policy extraction (policy and candidate atoms only) from
evidence binding; compare against this exact frozen one-call observation.
Only promote a semantic gate if correspondence/coverage tests on held-out cases
justify its cost. Correct current verdict alone is insufficient.

## Nemotron comparison, 2026-11-27

Maintainer requested a focus on Nemotron and BotHub. Historical local-lab#214
(https://github.com/TeaShaman-cyber/local-lab/issues/214#issuecomment-6720963501
and #issuecomment-6720988422) reported fewer paraphrases with BotHub Ultra
than Solar for Honcho. Different task and single-window proxy metric, not
evidence of decision-rule quality. The earlier BotHub Lightning timeout
is also historical.

Live catalog HTTP200: BotHub four explicit Nemotron :free variants (Lightning,
Super VL, Ultra, Nano Omni); OpenRouter four equivalent free IDs with literal
zero prices; Nous Nemotron listings nonzero price; NIM developer catalog
includes Lightning, Super VL, Ultra and Nano Omni with pricing absent.
Official BotHub https://bothub.chat/nemotron-3.5-lightning:free shows the free
API ID; public /api/v2/pricing/models?platform=API_COMPLETIONS&modelId=...
returned empty prices and BASIC for each free ID, whereas paid Ultra returned
nonempty positive prices. Empty prices are not independent proof of account
charges or a numeric zero. Exact free variant only; no paid fallback.

Executed commit ba8cd8abf30460895a5e1fed270e231f107fc1b7.
Same frozen cases, prompt and gold, larger 3072 output cap and 60 s timeout
than Solar; NIM reasoning_budget=768. This is not a controlled one-variable
model comparison. Both processes exited 0, byte-equal logs and exact raw
readback verified.

- BotHub Ultra :free: HTTP429 after 1860 ms on Maple. No final output or cost
  observed; Linden not attempted. Retry-After was not retained by this
  experiment runner (observability gap). No retry or alternate BotHub alias.
  No conclusion about Ultra quality or account billing.
- NIM Lightning: two HTTP200/stop; cost absent on both, not proof of zero
  billing. Maple 394 input/886 output/767 reasoning, 4396 ms: exact full rule,
  premise states and current verdict. Linden 405 input/854 output/767
  reasoning, 3649 ms: structurally valid but emitted only B AND D, entirely
  omitting mandatory A (explicitly refused authorization) and alternative C.
  This makes the deterministic evaluator return ALLOW instead of DENIED.
  No execution, real permission or spend implied by the synthetic verdict.

Thus Lightning improves one of two samples over Solar (1/2 exact vs 0/2),
but the other is a consequential false allow. No semantic admission.
Shorter final content is not evidence of correctness. Policy extraction
must be independent of current facts; preserve all alternatives and mandatory
constraints, independently verify translation before any decision. A
deterministically owned policy should not be re-derived by the model at all.
No new runtime changes, paid authority, production route or inference fallback.
OpenRouter catalog checked only, not invoked. No claim that different Nemotron
endpoints provide independently qualified model families.

## NIM Ultra follow-up, 2026-11-27

Executed commit 83a73a8e85114025aa476a8ca1de65deb441e3fb. Exact same frozen
cases, system prompt, candidate atoms, oracle and parser as Lightning.
3072 output cap and 60 s per-call timeout; Ultra's documented hosted
reasoning_effort=medium rather than Lightning's reasoning_budget=768.
Reference https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b/apireference.md.
Current developer research catalog exact ID present; prices absent, no
paid fallback. Both responses HTTP200/stop, exact model ID, no Retry-After.
Raw final output only; no reasoning trace retained.

- Maple: 394 input, 2891 output including 2796 reasoning tokens, 48510 ms.
  Full rule, all premise states/citations and ALLOW exactly correct.
- Linden: 405 input, 1585 output including 1464 reasoning tokens, 18902 ms.
  Full rule including mandatory authorization A, A=F and C=U, all citations
  and DENIED exactly correct.

Both observations replay through the strict parser and frozen oracle, exact
process log equality and exit 0 verified. 2/2 exact, versus Lightning 1/2
and Solar 0/2. Ultra costs are unreported (null), not verified zero billing.
This is a two-case repeated-fixture comparison, with differing reasoning
controls and providers; not a general ranking, independent validation of
semantic translation or production qualification. Ultra is a promising
research candidate, not an authority gate. Warm latency is substantially
higher on these samples. Next experiment may compare Ultra's documented
none/medium modes and separately extract policy from facts, with new held-out
cases and explicit negative authority controls. No production changes.

### Receipt readback hardening

Exact-head review identified two gaps: the earlier verifier skipped failed
final artifacts and did not require a matching case receipt for every
attempt. Both runners now use the same offline verifier. It checks ordered
attempt/case pairing, explicit NOT_ATTEMPTED receipts and terminal counts;
replays accepted finals; requires the recorded structural rejection on the
negative Linden final; and checks the recorded 429 refusal has no final
artifact. Unrecognized failure classes fail closed until a replay check
exists. This validates recorded evidence consistency, not upstream billing
or transport authenticity.

Run `node research/decision-slicing/test-readback.mjs` to check all four
observation logs and 14 negative mutations (missing case receipts, mismatched
attempt IDs, a replaced negative final and a changed failure reason).

## Ultra none and hosted billing investigation, 2026-11-27

Current official FAQ fetched directly from
https://build.nvidia.com/api/runtime/content/help-center-faq.yaml?x=2:
all catalog models are free for prototyping, rate limits rather than per-token
billing, up to 40 RPM for most models, personal limit in dashboard. NVIDIA staff
https://forums.developer.nvidia.com/t/request-more-4-000-credits-option-on-build-nvidia-com/344567
confirmed transition from credits to rate limits in September 2025, no fixed
trial duration, research/development/testing only. Public catalog
https://build.nvidia.com/ lists Ultra among free endpoints. Governed proxy
GET /v1/usage, /v1/credits, /v1/account and /v1/me all returned HTTP404.
No documented account usage/balance endpoint found in this bounded audit.
Documented free research entitlement is not independently reconciled account
billing. Paid production services remain out of scope.

Executed commit 9f258c50b1128f13ec92ebaa22b20967c3aec52e, same Ultra model,
same frozen fixtures/prompt/oracle, cap3072 and deadline60s, only inference
parameter change reasoning_effort=none versus medium. Both HTTP200/stop,
zero reasoning tokens, absent cost, no rate-limit headers or Retry-After;
x-request-id present and usage includes token counts/details, not money.
Both raw final outputs fail the same structural unused-premise check.
Maple 394 input/128 output, 2794ms: only AC, unused B/D/E.
Linden 405 input/111 output, 3358ms: only ABD, unused E, missing C.
No accepted verdict. Do not repair these historical artifacts.
Compared with medium 2/2 exact and 18.902-48.510s, none 0/2 exact and
2.794-3.358s. Single sample per condition, two repeated cases, not statistical
proof of general accuracy or a latency SLA. For this task keep medium as
candidate; no new model policy or production activation. Account-level
quota and billing remain unverified, although free trial terms are explicit.
Five observation logs and 17 negative receipt mutations verified offline.

## Paired policy isolation pilot

Executed 0c724db4cdd5330e36777aab3c00a70633bd005f. Two new synthetic cases,
Ash and Birch; exact candidate atoms, policy/evidence and gold frozen before
execution. Same Ultra medium, cap3072 and 60s timeout; Ash joint then rule,
Birch rule then joint. Rule-only sees E1 and atoms/decision, no current
evidence. At evaluation it receives manually annotated reference states,
not a second model result. Enumerate all 243 T/F/U valuations of five atoms
per extracted rule; compare to gold rule under the identical valuations.
This tests rule translation, not natural-language atom discovery or end-to-end
two-stage inference. Four HTTP200/stop responses, cost not reported.

Ash joint exact: 394/1248 input/output tokens, 29.781s; rule-only exact
253/634, 14.924s. Birch rule-only exact 259/303, 7.050s; joint 408/586,
12.735s returns only D (current attestation succeeds), omitting ABC.
Current ALLOW is correct but 27/243 valuations disagree (24 false DENIED,
3 false DEFER). Rule-only 0/486 disagreements, joint 27/486.
No false ALLOW in these four outputs, not a safety guarantee.
Both rule-only stages are smaller/faster on these samples, but end-to-end
split cost is not measured until actual evidence binding. No production change.

### Actual second-stage evidence binding

Executed f5f5d3de3a7c28e63e436e92714d93b1daae2a88. Bind to exact raw rule
artifacts from paired-observation.jsonl (pinned SHA-256). Both calls see only
the selected atom texts and current source evidence E2-E6, without policy E1,
support sets, target verdict or gold. The deterministic evaluator reuses the
immutable observed rule; model cannot regenerate it. Both responses
HTTP200/stop, cost absent; all premise states and citations match gold,
including unknown B (Ash), unknown C (Birch), and refused D (Ash).
Ash binding 257/774 input/output tokens, 9.570s; Birch 272/758, 11.756s.
Complete split 2/2 exact versus joint 1/2 exact. Ash split 1918 tokens/24.494s
vs joint 1642/29.781s; Birch split 1592/18.806s vs joint 994/12.735s.
Total split 3510 tokens/43.300s vs joint 2636/42.516s. Sum of observed
provider latency, excluding orchestration and waiting between experiments.
Split uses two calls per task, about 33% more tokens here; no general latency
or cost improvement claim. Reusing a verified stable policy may amortize
the rule stage, but this has not been benchmarked.

Both receipt logs replayed; nine deliberate receipt mutations rejected.
Research-only, no model qualification, automated authority or production
changes. Next focus: genuinely ambiguous source semantics, independent
review of the rule-to-policy correspondence, and reuse of a verified policy
across new evidence snapshots rather than always making two calls.

## Reuse exact observed rule under changed evidence

Executed e220c309b79a60e3151934fc5f29ba1a51b75027. Two new snapshots of
the same Ash/Birch policies and atoms, frozen reference states before calls.
Bind exact original policy text, decision, atom text dictionary and case ID
by SHA-256, and separately bind exact raw observed rule. No regeneration.
Ten identity mutants reject changed policy, decision, atom, ID or rule;
four positive controls preserve identity under evidence-only change and
atom-map reorder. This is exact identity within a synthetic fixture, not
semantic equivalence, signature/authentication, or proof of authority.
Rule and policy receipts originate from the pinned previously reviewed
experiment, not an arbitrary self-asserted model receipt. No trust promotion.

Two Ultra medium calls, HTTP200/stop, cost absent. Ash owner withdraws
authorization while independent checks pass and assistant claims approval:
all states/citations exact, deterministic DENIED. 266/758 tokens, 9.812s.
Birch attestation now explicitly invalid; alternate replay+digest+provenance
path all verified: all states/citations exact, deterministic ALLOW.
275/594 tokens, 10.879s. Two exact results; 1893 total tokens, 20.691s summed
provider latency. Compare previous fresh split 3510 tokens/43.300s as a
descriptive measurement only, not a controlled speedup benchmark: snapshots
differ. Rule extraction calls avoided by construction, no semantic assurance
from matching hashes alone. Exact launcher/log readback, seven negative
receipt mutations rejected. No production activation.

### Exact historical receipt verification

Codex identified three gaps in the first reuse verifier: consistent replacement
of model identity, unbound launch controls/wire hash, and modified response
measurements. The retained observation is now pinned byte-for-byte by its
SHA-256. The verifier also checks the explicit expected model, cap, timeout,
reasoning mode and reconstructs the exact request body for each recorded wire
hash. It recomputes token/latency sums and checks absent reported cost, then
replays semantics. Fifteen deliberately modified receipts are rejected by the
pinned-byte boundary. This establishes consistency and custody of the retained
artifact, not independent upstream authentication of usage or billing. No
historical observation bytes changed, no repeated model calls.
