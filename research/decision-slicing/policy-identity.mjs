import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseStrictModelJson} from '../../src/dreaming/strict-model-json.ts';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// Exact text identity, not a claim of semantic equivalence. Sorting keys
// avoids a false invalidation merely from reordered atom map properties.
export function policyIdentity(c) {
  return sha(JSON.stringify({id:c.id,decision:c.decision,policy:c.sources.E1,
    atoms:Object.entries(c.atoms).sort(([a],[b])=>a.localeCompare(b))}));
}
export function bindRule(receipt,c,raw) {
  assert.equal(policyIdentity(c),receipt.policySha,'POLICY_CHANGED');
  assert.equal(sha(raw),receipt.ruleSha,'RULE_CHANGED');
  const rule=parseStrictModelJson(raw);
  assert.equal(rule.policyRef,'E1');
  assert.ok(Array.isArray(rule.supportSets)&&rule.supportSets.length);
  assert.ok(rule.supportSets.every(s=>Array.isArray(s)&&s.length&&s.every(x=>Object.hasOwn(c.atoms,x))));
  return rule;
}
