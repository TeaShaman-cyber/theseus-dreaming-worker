# Formal journal pilot (#89)

Research-only, based on actual journal implementation at 5247192c48ab4f20ba828f5bcf78f096a2a18740. No production or required CI change.

## Reference implementation audit

Discovery through Exa, Parallel Search and Tavily; exact Git source read through native gh, not inferred from abstracts.

- [Veil FloodSet example](https://github.com/verse-lab/veil/blob/b1128cc5e0df337443b268e3c78dd2aaabf2706e/Examples/Tutorial/FloodSet.lean): combine inductive invariants, executable model checking, satisfiable/unsatisfiable traces, action coverage. Veil 2.0 uses Lean 4.35, eight direct Lean dependencies, SMT and widget tooling. Useful later for larger concurrent protocols, not necessary here.
- [Sal issuance certificates](https://github.com/fplaunchpad/sal/blob/223d4976b28d7df249c6c9d91475557ff9f1d196/Sal/MRDTs/Framework/Certificates.lean) and [bounded counter](https://github.com/fplaunchpad/sal/blob/223d4976b28d7df249c6c9d91475557ff9f1d196/Sal/MRDTs/Instances/BoundedCounter.lean): distinguish raw operational semantics and certified issuance; prove small component lemmas. Sal requires Mathlib and Blaster; no need to import that stack.
- [Isabelle concurrency theory](https://github.com/Deep-LCF/Isabelle-Pool-Server/blob/c723e06381fb4aeb56f115e77e2f0b343a234e4c/evaluation/Server_Concurrency.thy) and [session manager](https://github.com/Deep-LCF/Isabelle-Pool-Server/blob/c723e06381fb4aeb56f115e77e2f0b343a234e4c/server/app/services/session_manager.py): abstract enabled/exec actions, single running job, exclusive lease, commuting disjoint actions; actual acquisition under manager lock. The theory is an abstract proof, not a verified translation of Python. Do not equate it with end-to-end correctness or transfer service lease expiry to uncertain external inference. Warm pool useful for many expensive interactive proofs, excessive for this pilot.
- [Rtl2lean paper](https://arxiv.org/abs/2607.16855): deterministic transition models and reusable lower-layer lemmas. [PRDT paper](https://arxiv.org/abs/2504.05173v3): compositional safety checks with Stainless/Scala. Author implementation repositories not located in this bounded search; paper-level evidence only. No source-level conclusions about them.
- Reuse the existing math-lab pattern: [Session Search factorization](https://github.com/TeaShaman-cyber/theseus-math-research-lab/blob/main/lean-calculator/probes/session-search-event-factorization.lean) and [Hermes lifecycle](https://github.com/TeaShaman-cyber/theseus-math-research-lab/blob/main/lean-calculator/probes/hermes-livestore-lifecycle.lean) use small core Lean proofs with explicit semantic boundaries.

## Scope and results

PoolJournal.lean models lifetime attempt budget, first/second configured family labels, pending phase and terminal unknown state. Lean checks inductive reachability for arbitrary abstract trace length, distinct accepted families, first accepted family preservation at each transition, no start while pending, unknown absorbing. Only standard propext and Quot.sound observed in printed axiom sets; no sorryAx. Positive completion witness prevents vacuous reject-all semantics. Two deliberately broken models reject specifically false executable propositions (budget and unknown restart), not merely any compiler error.

The executable model enumerates all one-step extensions of accepted prefixes to depth six, three families, caps 2/3/4. compare-traces.mjs runs the ACTUAL TypeScript replayPoolJournal for each trace, matches acceptance and abstract state, and checks full previous validated objects unchanged on accepted concrete transitions. 1998 comparisons: 672 accepted, 1326 rejected, 78 completed states, 168 terminal unknown states (not independent jobs). Scope: fresh distinct route/attempt identities, valid evidence and matching outcome IDs. This is bounded observational correspondence, not a general refinement proof. Hashing, wrong identity, source checkpoint, cross-process storage atomicity, cooldowns, admission and provider semantics require existing tests and further verification. No liveness claim or real model calls.

Observed on exe.dev VM (2 CPU, 4 GiB RAM), Node 22, Lean 4.28.0 official Linux x86_64 release commit 7e01a1bf5c70fc6167d49c345d3bf80596e9a79b:
- Proof-only 0.88, 0.90, 0.81 seconds; peak RSS 461112 KiB (about 450 MiB).
- Lean proof + emitted trace 1.05 s; TS parity 0.63 s.
- Full module including two negative controls: 4.15 s, maxRSS 464392 KiB.
- Cold download 520948633 bytes, release sha256 ceb3a3f844f7aebf63245e2b51c28d5b0ed38942c19f93cf3febd520302160bd; download observed about 5 s, full cold setup time not measured; extracted 2.6 GiB. No Mathlib or new runtime dependency.

## Run

Install verified pinned official release outside project, use existing Node dependencies, then:

```sh
export PATH="$HOME/.local/bin:$PATH"
LEAN_BIN=/absolute/path/to/lean research/model-pool/formal/check.sh
```

The check itself is offline and bounded. Candidate CI integration: pinned toolchain cache, path-scoped invocation on journal/model/verification changes, separate cold provisioning time and checker time, fail closed on missing toolchain and mismatched version. Do not introduce a verifier service or global new required CI gate before review and current-base replay. Retain toolchain only if reused, otherwise remove exact experiment directory after verification.
