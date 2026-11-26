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
