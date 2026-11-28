import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildHeldoutLiveConfig} from '../research/model-pool/live-acceptance/run-heldout-live.mjs';

test('heldout live runner uses a bounded cross-provider free-research pool',()=>{
  const c=buildHeldoutLiveConfig(1000);
  assert.equal(c.task,'Held-out synthetic Birch hypothesis.');
  assert.equal(c.analysisVersion,'live-birch-124-v2');
  assert.equal(c.policy.maxAttempts,6);
  assert.equal(c.policy.maxInvocations,6);
  assert.equal(c.policy.routes.length,6);
  assert.deepEqual(new Set(c.policy.routes.map(r=>r.provider)),new Set(['nous','openrouter']));
  assert.equal(new Set(c.policy.routes.map(r=>r.modelFamily)).size,6);
  assert.ok(c.policy.routes.every(r=>r.admission==='FREE_RESEARCH'&&r.catalog==='PRESENT'));
  assert.ok(c.policy.routes.every(r=>r.catalogValidUntilMs===301000));
  assert.ok(c.policy.routes.every(r=>!('apiKey' in r)));
});
