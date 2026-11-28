import {test} from 'node:test';

test('heldout v3 partial evidence replays offline', async()=>{
  await import('../research/model-pool/live-acceptance/verify-heldout-live.mjs');
});

test('heldout v5 acceptance reconstructs durable state offline', async()=>{
  await import('../research/model-pool/live-acceptance/verify-heldout-live-v5.mjs');
});
