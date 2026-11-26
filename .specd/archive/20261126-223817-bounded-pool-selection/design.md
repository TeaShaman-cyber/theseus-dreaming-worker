# Design: bounded-pool-selection

## Non-goals

Do not establish route eligibility from catalog alone, infer model quality, add a gateway or invoke providers. Do not alter current fixed-pair execution.

## Affected areas

- `src/dreaming/model-pool.ts` — pure selector over explicitly qualified route metadata.
- `test/model-pool.test.mjs` — executable state scenarios and exhaustive small pool comparison.

## Approach

Strict bounded input, caller supplies clock, cursor, task class, remaining attempts, frozen valid route if any, already attempted route IDs and unresolved-outcome flag. A route must be explicitly free-research-admitted, task-qualified and catalog-present with unexpired observation. A frozen perspective does not need to remain catalog-present. Provider and route cooldowns are separate absolute not-before times. Unknown prior outcome blocks selection. At most two missing slots, distinct normalized families, prefer separate provider domains if currently feasible, then cyclic input order. Future wake is earliest feasible pair time, not earliest individual reset. Reevaluate every wake; never infer continued availability after observation expiry. No money charges authorized; future paid policies separate. Selection is not reservation or evidence that inference succeeded.

## Testing

Exercise removal, stale/unknown catalog, forbidden/unknown entitlement, task mismatch, same-family endpoints, provider vs route cooldown, bounded attempts, unknown state, frozen slot, deterministic rotation and pair readiness. Exhaust small synthetic states against an independent feasibility oracle. Existing repo QA remains required.

## Spec impact

New additive requirement, earlier pure pair executor remains intact.
