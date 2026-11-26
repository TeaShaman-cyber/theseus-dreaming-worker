import { z } from 'zod';

const id = z.string().min(1).max(256).refine(s => s === s.trim());
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identity = z.object({
  id, provider: id, model: id, modelFamily: z.string().trim().min(1).max(256),
}).strict();
const candidate = identity.extend({
  admission: z.enum(['FREE_RESEARCH', 'NOT_AUTHORIZED', 'UNKNOWN']),
  qualifiedTasks: z.array(id).max(64),
  catalog: z.enum(['PRESENT', 'ABSENT', 'UNKNOWN']),
  catalogValidUntilMs: time,
}).strict();
const inputSchema = z.object({
  routes: z.array(candidate).max(64),
  taskClass: id,
  nowMs: time,
  rotation: time,
  remainingAttempts: z.number().int().min(0).max(200),
  attemptedRouteIds: z.array(id).max(200),
  cooldowns: z.array(z.object({
    scope: z.enum(['route', 'provider']), key: id, notBeforeMs: time,
  }).strict()).max(256),
  frozen: identity.nullable(),
  unresolvedAttempt: z.boolean(),
}).strict().refine(p => new Set(p.routes.map(r => r.id)).size === p.routes.length
  && new Set(p.routes.map(r => JSON.stringify([r.provider, r.model]))).size === p.routes.length
  && new Set(p.attemptedRouteIds).size === p.attemptedRouteIds.length, 'Ambiguous route identity');

type RouteIdentity = z.infer<typeof identity>;
export type ModelPoolInput = z.input<typeof inputSchema>;
export type ModelPoolSelection =
  | { status: 'READY'; routes: RouteIdentity[]; nextRotation: number }
  | { status: 'DEFERRED'; wakeAtMs: number }
  | { status: 'BUDGET_EXHAUSTED' | 'INSUFFICIENT_ELIGIBILITY' | 'BLOCKED_UNKNOWN' };

const family = (route: RouteIdentity) => route.modelFamily.trim().toLowerCase();
function publicRoute(r: RouteIdentity): RouteIdentity {
  return { id: r.id, provider: r.provider, model: r.model, modelFamily: r.modelFamily };
}

/** Pure decision over trusted caller observations. Not admission authority, reservation or inference. */
export function selectModelPool(raw: ModelPoolInput): ModelPoolSelection {
  const p = inputSchema.parse(raw);
  if (p.unresolvedAttempt) return { status: 'BLOCKED_UNKNOWN' };
  const slots = p.frozen ? 1 : 2;
  if (p.remainingAttempts < slots) return { status: 'BUDGET_EXHAUSTED' };
  const count = p.routes.length;
  const tried = new Set(p.attemptedRouteIds);
  const rotated = count ? p.routes.map((_, i) => (p.rotation % count + i) % count) : [];
  const eligible = rotated.flatMap(index => {
    const r = p.routes[index];
    if (r.admission !== 'FREE_RESEARCH' || r.catalog !== 'PRESENT'
      || !r.qualifiedTasks.includes(p.taskClass) || tried.has(r.id)
      || (p.frozen && (family(r) === family(p.frozen) || r.id === p.frozen.id
        || (r.provider === p.frozen.provider && r.model === p.frozen.model)))) return [];
    const ready = p.cooldowns.reduce((at, c) =>
      (c.scope === 'route' ? c.key === r.id : c.key === r.provider) ? Math.max(at, c.notBeforeMs) : at, p.nowMs);
    return ready < r.catalogValidUntilMs ? [{ r, index, ready }] : [];
  });
  type Choice = { routes: typeof eligible; ready: number; separate: boolean };
  const choices: Choice[] = [];
  for (const [i, a] of eligible.entries()) {
    if (p.frozen) choices.push({ routes: [a], ready: a.ready, separate: a.r.provider !== p.frozen.provider });
    else for (const b of eligible.slice(i + 1)) {
      if (family(a.r) === family(b.r)) continue;
      const ready = Math.max(a.ready, b.ready);
      if (ready >= Math.min(a.r.catalogValidUntilMs, b.r.catalogValidUntilMs)) continue;
      choices.push({ routes: [a, b], ready, separate: a.r.provider !== b.r.provider });
    }
  }
  const ready = choices.filter(c => c.ready === p.nowMs);
  const selected = ready.find(c => c.separate) ?? ready[0];
  if (selected) return {
    status: 'READY', routes: selected.routes.map(c => publicRoute(c.r)),
    nextRotation: (selected.routes[0].index + 1) % count,
  };
  if (choices.length) return { status: 'DEFERRED', wakeAtMs: Math.min(...choices.map(c => c.ready)) };
  return { status: 'INSUFFICIENT_ELIGIBILITY' };
}
