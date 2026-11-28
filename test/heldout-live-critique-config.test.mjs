import assert from 'node:assert/strict';
import {test} from 'node:test';
import {heldoutCritiqueRoute} from '../research/model-pool/live-acceptance/run-heldout-critique.mjs';

test('heldout critique uses a new zero-price model family',()=>{
  const r=heldoutCritiqueRoute();
  assert.deepEqual(r,{id:'particle-critique',provider:'openrouter',model:'particle-ai/particle-1:free',modelFamily:'particle1',baseURL:'https://openrouter.int.exe.xyz/api/v1',maxOutputTokens:4096,timeoutMs:60000});
});
