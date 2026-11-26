# Model pool: quality under changing availability (research #89)

Status: offline research evidence, not an accepted runtime policy. Issue #89;
architecture umbrella TeaShaman-cyber/theseus-research#127; durable work #65.

## Question and hypothesis

Can two distinct model families be selected with substantially better work
completion under provider/model churn than a fixed pair, without sacrificing
measured task quality? The candidate is a scheduler, not a semantic consensus
algorithm. Models are not interchangeable replicas of an authoritative state.
A successful inference must not advance a source checkpoint by itself.

Prior Theseus techno reviews: July 30 (AKS semantic/policy/placement routing),
September 2 (operation-aware etcd/ZooKeeper routing), October 29 (TAO),
November 7 (Auto Router), November 25 (TPTL-dist).
Public primary sources:

- RouteLLM: https://arxiv.org/abs/2406.18665 — learn quality/cost selection.
- LLMRouterBench: https://aclanthology.org/2026.findings-acl.1881/ —
  complementarity exists, but several sophisticated routers fail to reliably
  outperform simple baselines.
- Sleeping Combinatorial Bandits: https://arxiv.org/abs/2106.01624 — select
  multiple arms from a changing availability set.
- Combinatorial Blocking Bandits: https://proceedings.mlr.press/v139/atsidakou21a.html —
  model temporary unavailability. Neither theorem is a guarantee for this
  nonstationary, partially observed service.
- Kubernetes scheduler: https://kubernetes.io/docs/concepts/scheduling-eviction/scheduling-framework/
  — separate filter, score, reserve.
- Cloudflare dynamic routes/fallback:
  https://developers.cloudflare.com/ai-gateway/features/routing/dynamic-routing/
  and https://developers.cloudflare.com/ai-gateway/configuration/fallbacks/
- Mastra model fallback: https://mastra.ai/blog/model-fallback

Existing gateway capabilities can implement transport selection and limits,
but their generic fallback does not establish our durable perspective identity,
exact provenance, budget accounting, or recovery of a partially completed work
item. Evaluate reuse at the transport boundary before adding a router service.
Do not enable hidden fallback or Unified Billing as a consequence of this study.

## Mathematical candidate

At decision t, filter the finite route set by explicit permission, data scope,
catalog freshness, model family, compatibility, known cooldown and budget.
Choose two different families; preferentially separate provider failure
domains when evidenced. An unavailable qualified route is temporarily sleeping.
For task class d, estimate the marginal score q(d,m) from training only.
For a pair also estimate J(d,a,b) = mean(min(score_a, score_b)) on paired training
rows. This empirical joint score does not assume independent errors or turn
agreement into truth. In this experiment the primary quality metric is the
weaker recorded score, not a semantic verifier.

Proposed production safety properties (not yet proved or implemented): no
unapproved route, bounded physical attempts and maximum spend, no replay of a
frozen validated perspective, no identical model family in a completed pair,
no checkpoint without verified durable completion, no blind retry of an unknown
outcome. Conditional liveness requires eventual sufficient eligible capacity,
finite work, fair admission, known recovery state, and a renewed permitted budget.
No unconditional progress claim under arbitrary outages.

## Dataset and experiment

Source: Agent-as-a-Router (https://arxiv.org/abs/2606.22902), recorded
CodeRouterBench tables in Route Anything experimental data:
https://huggingface.co/datasets/Lance1573/route-anything-data .
Pinned revision bd361209720f27a2383857e314c554476bc81c5c. Dataset README identifies
MIT terms for the CodeRouterBench source; underlying tasks retain their upstream
terms. Only derived metrics and our code are committed, not third-party rows.

7080 probing tasks, 2919 original ID test tasks, eight models, nine coding task
dimensions. Exclude 42 test tasks with an explicitly missing token record, not
because of their correctness score. 2877 complete matrix rows remain at task
level. Exclude missing train observations from means. Preserve original split;
no overlap, no use of test scores to rank routes. The provider in models.json
is a conservative family grouping (Claude variants together, Qwen variants
together), not verified upstream provider/family identity or separate physical
failure domains.

Primary comparison registered in issue #89 before evaluation: fixed best
distinct pair (training global quality); health-aware rotation; global and
task-class quality ranking; task-class quality floor; cheapest route within
that floor. The fixed baseline also filters known unavailable models and avoids
starting without a possible pair. The floor is second-best distinct-family
training quality minus 0.05, NOT a guaranteed quality threshold. The joint
pair-score policy is an exploratory seventh policy added after initial results;
all original 180 runs verified byte-equivalent as parsed objects after adding
it. No held-out fitting; independent confirmation required before choosing it.

All policies see the same seeded task ordering and exogenous failure tape for a
given seed. They observe errors only on attempted routes and carry observed
scoped cooldowns forward. An explicit retired top-ranked model disappears at
one third of the stream. Every 200 task ticks, a provider has a 20-tick outage;
provider-scoped quota event probability 0.025, per-model rate-limit probability
0.12, invalid-artifact 0.04, unknown timeout 0.02 (sequential conditions, not
additive unconditional probabilities). Cooldown is 5 task ticks for 429;
unknown timeout stops the current item. A separate synthetic drift scenario
halves recorded scores of the retired model's family after halfway (on surviving
family routes). No actual provider state is measured. Task ticks are not seconds.
All probabilities and durations are hypothetical sensitivity inputs, not
estimated provider failure rates. No cross-job resume or DB modeled; successful
slots are preserved within each simulated item only. Inference attempts capped
at 2 or 4. There is no live money budget: the released dollar values estimate
past calls, not current price/entitlement or enforceable caps. Known 429/outage
assumed no charge; invalid output and ambiguous timeout charged recorded cost
as a proxy, actual unknown spend remains unknown.

Metrics:
- completion: two usable modeled artifacts of distinct groups / offered work;
- conditional min: weaker benchmark score averaged over completed pairs;
- coverage-adjusted min: sum of completed pairs' weaker scores / offered work
  (incomplete work contributes zero coverage, not a claim that its answers were
  wrong); both-exact and any-exact on the same offered-work denominator;
- estimated cost and attempted calls per offered work; partial/empty/unknown
  counts and per-class results in result.json.
The dataset supplies recorded scores, not evidence-linked proposal judgments.
A nonmissing recorded row is treated as an available artifact unless synthetic
failure is injected; this does not verify the Dreaming Worker schema or
meaning. This is a semi-synthetic replay, not a production benchmark.

## Reproduction

Python 3.11+ standard library; no inference calls or new packages. Download
only the three pinned data files into a temporary directory, verify hashes,
run, and remove them when done. The script checks hashes before loading.

```sh
tmp=$(mktemp -d)
base=https://huggingface.co/datasets/Lance1573/route-anything-data/resolve/bd361209720f27a2383857e314c554476bc81c5c/data/agent-as-a-router/data/coderouterbench
for f in id_probing_results_long.csv id_test_results_long.csv models.json; do
  curl --fail --location --max-time 90 "$base/$f" -o "$tmp/$f" || exit 1
done
python3 -m unittest discover -s research/model-pool -p 'test_*.py'
python3 research/model-pool/replay.py "$tmp" --out "$tmp/result.json"
python3 - "$tmp/result.json" <<'PY'
import json,sys
assert json.load(open(sys.argv[1])) == json.load(open("research/model-pool/result.json"))
print("REPLAY_IDENTICAL")
PY
rm -rf "$tmp"
```

## Observed results

210 runs = 7 policies x 3 scenarios x 2 caps x 5 seeds; 604170
offered-work evaluations, not independent tasks. Original test set reused,
not 604170 independently sampled examples. Means across seeds below (4-attempt
cap, fault scenario; all scores 0..1). Ranges and per-run data in result.json.

| Policy | Completion | Conditional min | Coverage-adjusted min | Cost proxy/work |
|---|---:|---:|---:|---:|
| Fixed | 10.16% | .357 | .036 | .00222 |
| Rotation | 91.81% | .297 | .273 | .00878 |
| Global ranking | 91.97% | .325 | .299 | .01062 |
| Task-class ranking | 91.65% | .370 | .339 | .00840 |
| Joint task-class ranking (exploratory) | 91.58% | .372 | .341 | .00851 |
| Quality floor | 77.17% | .380 | .293 | .00619 |
| Economy floor | 76.98% | .364 | .281 | .00396 |

Clean: all complete, fixed min .359; rotation .302; task-class .415; joint .420.
Joint 2-attempt fault completion 63.40%, 4-attempt 91.58%; cost proxy rises
.00708 to .00851. Joint vs marginal context difference in coverage-adjusted
min is only .00190: not a demonstrated meaningful improvement. Fixed baseline
collapse is expected by construction once one fixed model retires; do not
extrapolate the magnitude to production. Quality-floor and economy-floor
trade availability for quality/cost; not automatically superior. Drift reduces
joint coverage-adjusted min to .309 without changing transport completion:
availability telemetry alone cannot detect semantic degradation.

Interpretation: task-class ranking is a reasonable simple candidate for the
next controlled study; joint statistics are interesting, not a winner.
Do not adopt these benchmark model IDs, floor, probabilities, budget, cost
assumptions, or ranking as project configuration. Need Dreaming Worker
held-out, evidence-linked fixtures (weak signal, ambiguity, contradiction,
false absence, unsupported claim), route-specific compatibility/quality
validation, then measure quality and actual budget separately. Before real
use, prove durable partial perspective recovery and concurrent admission
with PostgreSQL and finite-state fault traces under #89. No additional
inference stage, deployed router, or new permission accepted here.
