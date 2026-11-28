import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildHeldoutLiveConfig} from '../research/model-pool/live-acceptance/run-heldout-live.mjs';

test('heldout live runner uses a bounded free-research pool',()=>{
  const c=buildHeldoutLiveConfig(1000);
  assert.equal(c.task,'Held-out synthetic Birch hypothesis.');
  assert.equal(c.analysisVersion,'live-birch-124-v5');
  assert.equal(c.policy.maxAttempts,3);
  assert.equal(c.policy.maxInvocations,3);
  assert.equal(c.policy.routes.length,3);
  assert.deepEqual(new Set(c.policy.routes.map(r=>r.provider)),new Set(['nous']));
  assert.equal(new Set(c.policy.routes.map(r=>r.modelFamily)).size,3);
  assert.ok(c.policy.routes.every(r=>r.admission==='FREE_RESEARCH'&&r.catalog==='PRESENT'));
  assert.ok(c.policy.routes.every(r=>r.catalogValidUntilMs===301000));
  assert.ok(c.policy.routes.every(r=>!('apiKey' in r)));
});
