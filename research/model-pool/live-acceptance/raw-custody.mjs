// Synthetic acceptance only. Keep exact adapter-returned final text before proposal parsing.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runPilot1} from '../../../src/dreaming/pilot1-runner.ts';
const digest=text=>createHash('sha256').update(text).digest('hex');
export function captureInference(routeId,infer,persist){
 return async(request,correlation)=>{
  assert.equal(request.scope,'SYNTHETIC_FIXTURE','RAW_SCOPE');
  const response=await infer(request,correlation);
  assert.equal(typeof response.text,'string','RAW_TEXT');
  assert.ok(Buffer.byteLength(response.text,'utf8')<=262144,'RAW_LIMIT');
  const row={schema:'theseus.dw-synthetic-raw-final.v1',routeId,
    requestFingerprint:correlation.requestFingerprint,evidenceFingerprint:correlation.evidenceFingerprint,
    provider:response.provider,model:response.model,finishReason:response.finishReason,
    text:response.text,textSha256:digest(response.text)};
  // A failed evidence sink must not return a response to the parser.
  await persist(row);
  return response;
 };
}
export async function verifyCapturedPerspective(request,routeId,row,event){
 assert.equal(request.scope,'SYNTHETIC_FIXTURE','RAW_SCOPE');
 assert.equal(row.schema,'theseus.dw-synthetic-raw-final.v1');
 assert.equal(row.routeId,routeId,'RAW_ROUTE');
 assert.equal(digest(row.text),row.textSha256,'RAW_DIGEST');
 assert.equal(event.kind,'VALIDATED');
 const result=await runPilot1(request,async(_,correlation)=>{
  assert.equal(row.requestFingerprint,correlation.requestFingerprint,'RAW_CORRELATION');
  assert.equal(row.evidenceFingerprint,correlation.evidenceFingerprint,'RAW_CORRELATION');
  return {text:row.text,provider:row.provider,model:row.model,finishReason:row.finishReason};
 });
 assert.equal(result.outcome,'PROPOSED');
 const {packetId,requestFingerprint,evidenceFingerprint,provider,model,finishReason,externalModelCalls,toolsUsed,memoryUsed,canonicalWrites}=result.receipt;
 assert.deepEqual({packetId,requestFingerprint,evidenceFingerprint,provider,model,finishReason,externalModelCalls,toolsUsed,memoryUsed,canonicalWrites},event.receipt,'RAW_RECEIPT');
 assert.deepEqual(result.proposalSet,event.proposalSet,'RAW_PROPOSALS');
 return result;
}
