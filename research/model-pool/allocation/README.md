# Finite horizon capacity allocation (#89)

Research only. Actual single-work selector at base b465522630f68ab75a01865202679bc96c36106c,
not a deployed batch scheduler. Known synthetic per-provider integer allowances
over a short horizon; all selected calls succeed, no renewal, latency,
cooldown discovery, partial recovery, changing prices or actual quota data.
Each job requires two different model families. Three jobs, four routes,
all 15 nonempty eligibility masks per job, four capacity/topology profiles.
Jobs are processed in fixed order; the planning oracle may skip a job.
The objective is maximum completed jobs only, not fairness, quality, urgency
or cost. No real request authority is inferred from hypothetical capacity.

Counterexample: A/B/C/D each have one call; first job accepts any pair,
second only A/B. The actual selector with rotation 0 consumes A/B first,
leaving second impossible. C/D then A/B completes both.

Compare:
- actual selectModelPool sequentially, adapting rotation and filtering
  exhausted provider capacity; a first slot consumes capacity even if the
  second cannot be filled. This is a simulated composition, not a measured
  production regression.
- scarcity heuristic chooses a feasible pair minimizing summed future
  provider eligibility count divided by remaining capacity, stable ties.
  It uses future job masks; baseline does not. Do not interpret as a
  one-variable benchmark.
- exact capacity-vector dynamic programming, enumerating pair/skip choices.
  An independently structured exhaustive assignment oracle checks the
  optimum across all 13,500 cases. Both check synthetic integer capacity
  and distinct families. Not a proof for arbitrary input sizes.

Run with repository Node toolchain:
```sh
node research/model-pool/allocation/replay.mjs | cmp - research/model-pool/allocation/result.json
```

Results (aggregate completed jobs across 40,500 offered jobs, not a random
sample or forecast):
distinct-unit 4631 greedy, 4968 scarcity, 5124 exact;
distinct-mixed 5769, 6240, 6288;
shared-provider-family 5221, 5320, 5437;
shared-tight 3049, 3159, 3159.
Total 18,670 / 19,687 / 20,008 respectively. Greedy leaves 780 partial
jobs in shared-capacity profiles. Scarcity is below optimum in 321 of
13,500 cases; greedy in 1338. These are scenario counts, not failure
probabilities. Both avoid claiming success without two different families.
The exact solver is useful as a small reference oracle; its state-space
size grows with the product of remaining provider capacities, so do not
promote it as an unbounded runtime scheduler.

Relation to earlier work: sleeping and combinatorial blocking bandits
(research/model-pool/README.md) address stochastic sequential selection;
finite known-capacity assignment is a distinct deterministic subproblem.
CP-SAT (https://developers.google.com/optimization/cp/cp_solver) is an
existing option for larger constrained allocation; no new dependency is
needed here. Before global scheduling, establish actual observable quota
or cooldown semantics and task-specific eligibility. A known wait deadline
is not a remaining-call allowance, and missing usage must not become
unlimited capacity. Keep durable admission and permission checks independent
of planning. No production changes or LLM calls.
