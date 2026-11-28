import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {verifyDurableV5} from '../research/model-pool/live-acceptance/verify-heldout-live-v5.mjs';
import {sourceReceiptFingerprint} from '../src/dreaming/source-batch-receipt.ts';
const base=new URL('../research/model-pool/live-acceptance/',import.meta.url);
const read=n=>readFileSync(new URL(n,base),'utf8');
const json=n=>JSON.parse(read(n));
const rows=n=>read(n).trim().split('\n').map(JSON.parse);
const fresh=()=>({manifest:json('heldout-live-v5-manifest.json'),fixture:json('heldout-source.json'),observed:rows('heldout-live-v5-observations.jsonl'),replay:rows('heldout-live-v5-replay.jsonl'),readback:json('heldout-live-v5-readback.json'),summary:json('heldout-live-v5-receipt.json')});
test('rejects different custody on a journal row',()=>{
 const x=fresh(); x.readback.journal[1].ownerToken='different';
 assert.throws(()=>verifyDurableV5(x),/CUSTODY/);
});
test('rejects replay tip divergence',()=>{
 const x=fresh(); x.replay.at(-1).tipFingerprint='different';
 assert.throws(()=>verifyDurableV5(x),/REPLAY_TIP/);
});
test('rejects a self-consistent but incorrect receipt payload',()=>{
 const x=fresh(), row=x.readback.checkpoints.find(r=>r.previous!==null);
 row.receipt.task='different task';
 const {receiptFingerprint:old,...payload}=row.receipt;
 const digest=sourceReceiptFingerprint(payload);
 row.receipt.receiptFingerprint=row.fingerprint=digest;
 for(const r of [x.observed.at(-1),x.replay.at(-1)])r.receiptFingerprint=r.tipFingerprint=digest;
 x.summary.source_receipt_fingerprint=digest;
 assert.throws(()=>verifyDurableV5(x),/CANONICAL_RECEIPT/);
});
test('rejects a root with a different membership even if rehashed',()=>{
 const x=fresh(), root=x.readback.checkpoints.find(r=>r.previous===null);
 root.receipt.membership.members.pop();
 const {receiptFingerprint:old,...payload}=root.receipt;
 root.receipt.receiptFingerprint=root.fingerprint=sourceReceiptFingerprint(payload);
 assert.throws(()=>verifyDurableV5(x),/CANONICAL_ROOT/);
});
test('rejects a substituted chain even when all stored chain references agree',()=>{
 const x=fresh();
 for(const r of [...x.readback.checkpoints,x.readback.plan,...x.readback.origins])r.chainId='different';
 assert.throws(()=>verifyDurableV5(x),/CANONICAL_CHAIN/);
});
