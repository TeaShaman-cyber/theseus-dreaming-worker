import {test} from 'node:test';
test('actual partial Birch raw output reconstructs the validated journal without inference',async()=>{
 await import('../research/model-pool/live-acceptance/verify-heldout-raw.mjs');
});
