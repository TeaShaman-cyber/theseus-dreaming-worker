import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { sha256Fingerprint } from '../src/dreaming/proposal-schema.ts';
import { decodeSourceHandoff } from '../src/dreaming/source-handoff.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/source-handoff.json', import.meta.url), 'utf8'));
const { candidate, expected } = fixture;
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value !== null && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const digest = value => sha256Fingerprint(canonical(value)).slice(7);
function rehash(value, key) {
  delete value[key];
  value[key] = digest(value);
  return value;
}
function changed(fn) {
  const copy = structuredClone(candidate);
  fn(copy);
  return rehash(copy, 'candidate_sha256');
}

test('exact Python-produced receipt decodes without changing its identity or advancing checkpoint', () => {
  const result = decodeSourceHandoff(candidate, expected);
  assert.deepEqual(result, candidate);
  assert.equal(result.currentness, 'UNKNOWN_WITHOUT_SOURCE_WATERMARK');
  assert.equal(result.checkpoint_advanced, false);
  assert.notEqual(result, candidate);
});

test('rejects wrong independent predecessor, scope, provider, or catalog', () => {
  for (const change of [
    { previousSnapshotSha256: '0'.repeat(64) },
    { scope: 'another' },
    { provider: 'xai' },
    { catalog: expected.catalog.slice(1) },
    { catalog: [...expected.catalog, expected.catalog[0]] },
    { catalog: expected.catalog.map(row => ({ ...row, state: 'BUILDING' })) },
  ]) assert.throws(() => decodeSourceHandoff(candidate, { ...expected, ...change }));
});

test('rejects modified digests and rehashed conflicting identities', () => {
  assert.throws(() => decodeSourceHandoff({ ...candidate, candidate_sha256: '0'.repeat(64) }, expected));
  for (const mutate of [
    c => { c.current_membership.members[0].ledger_sha256 = '0'.repeat(64); },
    c => {
      const old = c.previous_membership.members[0];
      const member = c.current_membership.members.find(x => x.artifact_sha256 === old.artifact_sha256);
      member.ledger_sha256 = '0'.repeat(64);
      rehash(c.current_membership, 'snapshot_sha256');
    },
    c => { c.selected[0].generation_id = '0'.repeat(64); },
    c => { c.selected[0].source_manifest_sha256 = '0'.repeat(64); },
    c => { c.selected.push(c.selected[0]); },
    c => { c.removed = [c.selected[0].session_id]; },
    c => { c.catalog.push(c.catalog[0]); },
    c => { c.checkpoint_advanced = true; },
    c => { c.currentness = 'CURRENT'; },
  ]) assert.throws(() => decodeSourceHandoff(changed(mutate), expected));
});

test('preserves removal obligations and an empty selection without asserting no data', () => {
  const input = changed(c => {
    c.removed = c.selected.map(row => row.session_id);
    c.selected = [];
  });
  const result = decodeSourceHandoff(input, expected);
  assert.deepEqual(result.removed, input.removed);
  assert.equal(result.selected.length, 0);
  assert.equal(result.checkpoint_advanced, false);
});
