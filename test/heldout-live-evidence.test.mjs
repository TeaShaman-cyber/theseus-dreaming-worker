import {test} from 'node:test';

test('heldout live evidence bundle replays offline', async()=>{
  await import('../research/model-pool/live-acceptance/verify-heldout-live.mjs');
});
