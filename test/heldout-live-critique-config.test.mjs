import assert from 'node:assert/strict';
import {test} from 'node:test';
import {critiqueEvidenceRecord,heldoutCritiqueRoute} from '../research/model-pool/live-acceptance/run-heldout-critique.mjs';

test('heldout critique uses a new zero-price model family',()=>{
  const r=heldoutCritiqueRoute();
  assert.deepEqual(r,{id:'particle-critique',provider:'openrouter',model:'particle-ai/particle-1:free',modelFamily:'particle1',baseURL:'https://openrouter.int.exe.xyz/api/v1',maxOutputTokens:8192,timeoutMs:60000});
});

test('heldout critique supports an explicit bounded control and retains raw output evidence',()=>{
  assert.equal(heldoutCritiqueRoute(4096).maxOutputTokens,4096);
  const result={outcome:'FAILED',artifact:null,rawModelOutput:'{truncated',failure:{code:'CRITIQUE_JSON_INVALID'},receipt:{bounds:{maxOutputTokens:4096}}};
  const record=critiqueEvidenceRecord(result,1);
  assert.equal(record.rawModelOutput,'{truncated');
  assert.equal(record.calls,1);
});
