#!/usr/bin/env python3
"""Offline research only: recorded coding quality + synthetic availability.
No network, inference, credentials or production dependencies."""
import argparse
import csv
import hashlib
import itertools
import json
import math
import random
import statistics as st
from collections import Counter, defaultdict
from pathlib import Path

REVISION = "bd361209720f27a2383857e314c554476bc81c5c"
HASHES = {
    "id_probing_results_long.csv": "7ddf95e4b00aea852ad3a5c2039091725407a64a59d5af5f498dccdc37ea8771",
    "id_test_results_long.csv": "88b4f7a66937d7a5ded743961a9219978414881d8cc3d66785d15ee277f9c417",
    "models.json": "2a3d6091addd2fce02715cf2fe2b57a48f4acf45f5c3b1bab4012282158a1e61",
}
SEEDS = (11, 23, 37, 53, 71)
POLICIES = ("fixed", "rotation", "global", "context", "joint_context", "quality_floor", "economy_floor")
SCENARIOS = ("clean", "faults", "faults_and_quality_drift")
CAPS = (2, 4)
FLOOR_MARGIN = .05


def load(root):
    for name, sha in HASHES.items():
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != sha:
            raise ValueError("input hash mismatch: " + name)
    meta = json.loads((root / "models.json").read_text())["models"]
    # Model provider in this release is a conservative family grouping, not
    # proof of distinct training data or independent real failure domains.
    family = {m["model"]: m["provider"] for m in meta}
    def read(name, split):
        tasks = {}
        with (root / name).open(newline="") as f:
            for r in csv.DictReader(f):
                assert r["split"] == split and r["model"] in family
                d, rows = tasks.setdefault(r["task_id"], (r["dimension"], {}))
                assert d == r["dimension"] and r["model"] not in rows
                q, cost = float(r["score"]), float(r["cost_usd"])
                assert math.isfinite(q) and 0 <= q <= 1 and math.isfinite(cost) and cost >= 0
                rows[r["model"]] = None if r["cost_source"] == "missing_token_record_zero_total" else (q, cost)
        assert all(set(rows) == set(family) for _, rows in tasks.values())
        return tasks
    train = read("id_probing_results_long.csv", "probing")
    test = read("id_test_results_long.csv", "id_test")
    assert len(train) == 7080 and len(test) == 2919 and not set(train) & set(test)
    complete = {k: v for k, v in test.items() if all(x is not None for x in v[1].values())}
    return family, train, complete, len(test) - len(complete)


def train_stats(train):
    samples = defaultdict(list)
    joint = defaultdict(list)
    for dim, rows in train.values():
        for m, value in rows.items():
            if value is not None:
                samples[dim, m].append(value)
                samples["*", m].append(value)
        for a, b in itertools.combinations(sorted(rows), 2):
            if rows[a] is not None and rows[b] is not None:
                joint[dim, a, b].append(min(rows[a][0], rows[b][0]))
    return {k: (st.mean(x[0] for x in a), st.mean(x[1] for x in a)) for k, a in samples.items()}, {k:st.mean(a) for k,a in joint.items()}


def independent(a, b, family):
    return family[a] != family[b]


def best_pair(models, q, family):
    pairs = [(a, b) for a, b in itertools.combinations(sorted(models), 2) if independent(a, b, family)]
    return max(pairs, key=lambda p: (min(q[x] for x in p), sum(q[x] for x in p), p)) if pairs else ()


def choose(policy, models, family, stats, joint, dim, fixed, pointer, frozen, eligible):
    available = [m for m in models if m in eligible and (not frozen or independent(m, frozen[0], family))]
    if policy == "fixed":
        available = [m for m in fixed if m in available]
    key = "*" if policy == "global" else dim
    q = {m: stats[key, m][0] for m in models}
    if policy in ("quality_floor", "economy_floor"):
        reference = best_pair(models, q, family)
        floor = min(q[m] for m in reference) - FLOOR_MARGIN
        available = [m for m in available if q[m] >= floor]
    if not frozen:
        available = [m for m in available if any(independent(m, n, family) for n in available)]
    if not available:
        return None
    if policy == "rotation":
        return min(available, key=lambda m: (models.index(m) - pointer) % len(models))
    if policy == "fixed":
        return available[0]
    if policy == "joint_context":
        def joint_q(a, b):
            return joint[dim, *sorted((a, b))]
        if frozen:
            return max(available, key=lambda m: (joint_q(frozen[0], m), q[m], m))
        pairs = [(a,b) for a,b in itertools.combinations(available, 2) if independent(a,b,family)]
        a,b = max(pairs, key=lambda p: (joint_q(*p), min(q[m] for m in p), p))
        return max((a,b), key=lambda m:(q[m],m))
    if policy == "economy_floor":
        return min(available, key=lambda m: (stats[dim, m][1], -q[m], m))
    if not frozen:
        a, b = best_pair(available, q, family)
        return max((a, b), key=lambda m: (q[m], m))
    return max(available, key=lambda m: (q[m], m))


def u(seed, t, key):
    return int.from_bytes(hashlib.sha256(f"{seed}:{t}:{key}".encode()).digest()[:8], "big") / 2**64


def fault(seed, t, m, family, scenario):
    if scenario == "clean":
        return "OK", 0
    # Same exogenous tape for all policies. Provider outages/quotas are correlated
    # among models of the same provider. One t is one task, not a real second.
    provider = family[m]
    providers = sorted(set(family.values()))
    if 50 <= t % 200 < 70 and provider == providers[(t // 200) % len(providers)]:
        return "PROVIDER_OUTAGE", 70 - t % 200
    if u(seed, t, "quota:" + provider) < .025:
        return "PROVIDER_429", 5
    x = u(seed, t, "route:" + m)
    if x < .12:
        return "MODEL_429", 5
    if x < .16:
        return "INVALID_ARTIFACT", 0
    if x < .18:
        return "UNKNOWN_TIMEOUT", 0
    return "OK", 0


def simulate(policy, scenario, cap, seed, family, stats, joint, test):
    models = sorted(family)
    fixed = best_pair(models, {m: stats["*", m][0] for m in models}, family)
    order = sorted(test)
    random.Random(seed).shuffle(order)
    retired = max(models, key=lambda m: stats["*", m][0])
    model_until, provider_until = {}, {}
    pointer = 0
    out = Counter()
    per_model = Counter()
    class_counts = defaultdict(Counter)
    sums = Counter()
    for t, task in enumerate(order):
        dim, records = test[task]
        frozen, scores, attempted = [], [], set()
        unknown = False
        for _ in range(cap):
            if len(frozen) == 2:
                break
            eligible = {m for m in models if m not in attempted
                        and model_until.get(m, 0) <= t
                        and provider_until.get(family[m], 0) <= t
                        and not (scenario != "clean" and t >= len(order)//3 and m == retired)}
            m = choose(policy, models, family, stats, joint, dim, fixed, pointer, frozen, eligible)
            if m is None:
                break
            assert m in eligible and m not in attempted
            assert not frozen or independent(m, frozen[0], family)
            attempted.add(m)
            pointer = (models.index(m) + 1) % len(models)
            per_model[m] += 1
            event, wait = fault(seed, t, m, family, scenario)
            out[event] += 1
            q, c = records[m]
            if event in ("PROVIDER_OUTAGE", "PROVIDER_429"):
                provider_until[family[m]] = max(provider_until.get(family[m], 0), t + wait)
            elif event == "MODEL_429":
                model_until[m] = max(model_until.get(m, 0), t + wait)
            elif event == "UNKNOWN_TIMEOUT":
                # No safe evidence of completion or spend. Conservative replay:
                # stop work and account estimated full recorded call cost.
                unknown = True
                sums["unknown_cost_proxy"] += c
                sums["cost"] += c
                break
            else:
                sums["cost"] += c
                if event == "OK":
                    frozen.append(m)
                    # Deliberate counterfactual degradation, not recorded score.
                    if scenario == "faults_and_quality_drift" and t >= len(order)//2 and family[m] == family[retired]:
                        q *= .5
                    scores.append(q)
        assert len(attempted) <= cap and len(attempted) == len(set(attempted))
        assert len(frozen) <= 2 and len(frozen) == len(scores)
        assert len(frozen) < 2 or independent(*frozen, family)
        out["tasks"] += 1
        out["attempts"] += len(attempted)
        class_counts[dim]["tasks"] += 1
        if unknown:
            out["unknown"] += 1
        if len(scores) == 2:
            out["complete"] += 1
            class_counts[dim]["complete"] += 1
            sums["min"] += min(scores)
            class_counts[dim]["min"] += min(scores)
            sums["mean"] += st.mean(scores)
            out["both_exact"] += int(min(scores) == 1)
            out["any_exact"] += int(max(scores) == 1)
        elif scores:
            out["partial"] += 1
        else:
            out["empty"] += 1
    assert out["complete"] + out["partial"] + out["empty"] == out["tasks"]
    assert out["attempts"] == sum(out[x] for x in ("OK","PROVIDER_OUTAGE","PROVIDER_429","MODEL_429","INVALID_ARTIFACT","UNKNOWN_TIMEOUT"))
    n, complete = out["tasks"], out["complete"]
    return {
        "counts": dict(out), "calls_by_model": dict(per_model),
        "completion": complete/n, "min_quality_complete": sums["min"]/complete if complete else None,
        "mean_quality_complete": sums["mean"]/complete if complete else None,
        "coverage_adjusted_min": sums["min"]/n,
        "both_exact_all": out["both_exact"]/n, "any_exact_all": out["any_exact"]/n,
        "cost_per_task_proxy": sums["cost"]/n, "unknown_cost_proxy": sums["unknown_cost_proxy"],
        "attempts_per_task": out["attempts"]/n,
        "classes": {d: {"completion": a["complete"]/a["tasks"], "coverage_adjusted_min": a["min"]/a["tasks"]}
                    for d,a in sorted(class_counts.items())},
    }


def run(root):
    family, train, test, omitted = load(root)
    stats, joint = train_stats(train)
    rows = []
    for scenario, cap, policy, seed in itertools.product(SCENARIOS, CAPS, POLICIES, SEEDS):
        rows.append({"scenario":scenario,"cap":cap,"policy":policy,"seed":seed,
                     **simulate(policy, scenario, cap, seed, family, stats, joint, test)})
    metrics = ("completion","min_quality_complete","mean_quality_complete","coverage_adjusted_min",
               "both_exact_all","any_exact_all","cost_per_task_proxy","attempts_per_task")
    summary = []
    for scenario, cap, policy in itertools.product(SCENARIOS,CAPS,POLICIES):
        a = [r for r in rows if (r["scenario"],r["cap"],r["policy"]) == (scenario,cap,policy)]
        summary.append({"scenario":scenario,"cap":cap,"policy":policy,
                        **{m:{"mean":st.mean([r[m] for r in a if r[m] is not None]),
                              "min":min(r[m] for r in a if r[m] is not None),
                              "max":max(r[m] for r in a if r[m] is not None)} for m in metrics}})
    return {"schema":"theseus.model-pool-replay.v1","revision":REVISION,"input_sha256":HASHES,
            "train_tasks":len(train),"test_tasks":len(test),"test_omitted_missing_record":omitted,
            "family_group":family,"seeds":SEEDS,"caps":CAPS,"floor_margin":FLOOR_MARGIN,
            "exploratory_policy":"joint_context added after initial six-policy run; no holdout fitting",
            "fixed_pair":best_pair(sorted(family),{m:stats["*",m][0] for m in family},family),
            "train_global":{m:stats["*",m] for m in sorted(family)},
            "rows":rows,"summary":summary}


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("data", type=Path)
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    a.out.write_text(json.dumps(run(a.data),indent=2,sort_keys=True)+"\n")
