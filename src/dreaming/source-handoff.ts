import { z } from 'zod';
import { sha256Fingerprint } from './proposal-schema.ts';

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const name = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
// Python's UTF-8 canonical JSON cannot encode unpaired UTF-16 surrogates.
const id = z.string().refine(s => s.trim().length > 0 && !/[\uD800-\uDFFF]/u.test(s));
const scope = id.refine(s => s === s.trim());
const currentness = z.literal('UNKNOWN_WITHOUT_SOURCE_WATERMARK');
const membership = z.object({
  schema: z.literal('theseus.session-search-accepted-membership.v1'),
  scope, currentness, verification_level: z.literal('projection_consistency'),
  members: z.array(z.object({ artifact_sha256: hash, ledger_sha256: hash }).strict()),
  accepted_set_sha256: hash, snapshot_sha256: hash,
}).strict();
const catalogRow = z.object({ provider: name, shard_id: name, generation_id: hash }).strict();
const selection = z.object({
  session_id: id, shard_id: name, generation_id: hash,
  source_manifest_sha256: hash, bundle_sha256: hash, change: z.enum(['ADDED', 'CHANGED']),
}).strict();
const candidateSchema = z.object({
  schema: z.literal('theseus.session-search-recovery-handoff-candidate.v1'),
  status: z.literal('HANDOFF_CANDIDATE'), provider: name, scope, currentness,
  delta_contract: z.literal('theseus.session-search-rederived-session-delta.v1'),
  baseline_verification: z.literal('rederived_under_current_contract'),
  previous_membership: membership, current_membership: membership,
  promotion_receipt_sha256: hash, catalog: z.array(catalogRow).min(1),
  selected: z.array(selection), removed: z.array(id),
  checkpoint_advanced: z.literal(false), candidate_sha256: hash,
}).strict();
const expectedSchema = z.object({
  provider: name, scope, previousSnapshotSha256: hash,
  catalog: z.array(catalogRow.extend({ state: z.literal('READY') })).min(1),
}).strict();

export type SourceHandoffCandidate = z.infer<typeof candidateSchema>;
export type ExpectedSourceHandoff = z.input<typeof expectedSchema>;

// The wire schemas contain only strings, booleans, arrays and fixed ASCII
// object keys. Do not use this serializer as a generic cross-language codec.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const fields = value as Record<string, unknown>;
    return '{' + Object.keys(fields).sort().map(k => JSON.stringify(k) + ':' + canonical(fields[k])).join(',') + '}';
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  throw Error('HANDOFF_CANONICAL_TYPE');
}
const digest = (value: unknown) => sha256Fingerprint(canonical(value)).slice(7);
// Python sorts Unicode by code point, not JS UTF-16 code units.
function compareId(a: string, b: string): number {
  const aa = Array.from(a), bb = Array.from(b);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
    const d = aa[i].codePointAt(0)! - bb[i].codePointAt(0)!;
    if (d !== 0) return d;
  }
  return aa.length - bb.length;
}
function requireOrdered(ids: string[]) {
  if (ids.some((v, i) => i > 0 && compareId(ids[i - 1], v) >= 0)) throw Error('HANDOFF_ORDER_OR_DUPLICATE');
}
function checkMembership(receipt: z.infer<typeof membership>) {
  const { snapshot_sha256, ...core } = receipt;
  requireOrdered(core.members.map(m => m.artifact_sha256));
  if (digest(core) !== snapshot_sha256) throw Error('HANDOFF_MEMBERSHIP_DIGEST');
  if (sha256Fingerprint(core.members.map(m => m.artifact_sha256 + '\n').join('')).slice(7) !== core.accepted_set_sha256) {
    throw Error('HANDOFF_ACCEPTED_SET_DIGEST');
  }
  return new Map(core.members.map(m => [m.artifact_sha256, m.ledger_sha256]));
}

/** Strict wire validation only; caller owns trusted custody and catalog observation. */
export function decodeSourceHandoff(raw: unknown, expectedRaw: ExpectedSourceHandoff): SourceHandoffCandidate {
  const candidate = candidateSchema.parse(raw);
  const expected = expectedSchema.parse(expectedRaw);
  const { candidate_sha256, ...core } = candidate;
  if (digest(core) !== candidate_sha256) throw Error('HANDOFF_CANDIDATE_DIGEST');
  if (core.scope !== expected.scope || core.provider !== expected.provider
    || core.previous_membership.scope !== core.scope || core.current_membership.scope !== core.scope
    || core.previous_membership.snapshot_sha256 !== expected.previousSnapshotSha256) {
    throw Error('HANDOFF_SCOPE_OR_PREDECESSOR');
  }
  const prior = checkMembership(core.previous_membership);
  const current = checkMembership(core.current_membership);
  for (const [artifact, ledger] of prior) {
    if (current.get(artifact) !== ledger) throw Error('HANDOFF_MEMBERSHIP_NOT_APPEND_ONLY');
  }
  requireOrdered(core.catalog.map(row => row.shard_id));
  const observed = expected.catalog.map(({ state: _state, ...row }) => row)
    .sort((a, b) => compareId(a.shard_id, b.shard_id));
  requireOrdered(observed.map(row => row.shard_id));
  if (canonical(observed) !== canonical(core.catalog)) throw Error('HANDOFF_CATALOG_MISMATCH');
  const vector = new Map(core.catalog.map(row => [row.shard_id, row]));
  if (!core.catalog.some(row => row.provider === core.provider)) throw Error('HANDOFF_PROVIDER_MISSING');
  requireOrdered(core.selected.map(row => row.session_id));
  requireOrdered(core.removed);
  const removed = new Set(core.removed);
  const bundleByShard = new Map<string, string>();
  for (const item of core.selected) {
    const row = vector.get(item.shard_id);
    if (removed.has(item.session_id) || row?.provider !== core.provider || row.generation_id !== item.generation_id
      || sha256Fingerprint('session-search-generation-v1\n' + item.source_manifest_sha256).slice(7) !== item.generation_id) {
      throw Error('HANDOFF_PLACEMENT_MISMATCH');
    }
    const previousBundle = bundleByShard.get(item.shard_id);
    if (previousBundle !== undefined && previousBundle !== item.bundle_sha256) throw Error('HANDOFF_BUNDLE_CONFLICT');
    bundleByShard.set(item.shard_id, item.bundle_sha256);
  }
  return candidate;
}
