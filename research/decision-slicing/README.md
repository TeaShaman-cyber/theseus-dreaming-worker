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
