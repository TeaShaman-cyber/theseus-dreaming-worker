import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {preflightHeldout} from '../research/model-pool/live-acceptance/preflight-heldout.mjs';
const bytes=readFileSync(new URL('../research/model-pool/live-acceptance/heldout-source.json',import.meta.url));
test('frozen Birch packet enters the actual bounded acquisition and planning pipeline',async()=>{
 const r=await preflightHeldout(bytes);
 assert.equal(r.status,'PREFLIGHT_ONLY');
 assert.equal(r.selected,1);
 assert.equal(r.evidence,3);
 assert.equal(r.fixtureReads,1);
 assert.equal(r.externalCalls,0);
 assert.equal(r.checkpointAdvanced,false);
 assert.match(r.workFingerprint,/^sha256:[a-f0-9]{64}$/);
 assert.equal(r.currentness,'UNKNOWN_WITHOUT_SOURCE_WATERMARK');
});
test('modified fixture bytes are rejected before source acquisition',async()=>{
 await assert.rejects(preflightHeldout(Buffer.concat([bytes,Buffer.from(' ')])),/FIXTURE_DIGEST/);
});
