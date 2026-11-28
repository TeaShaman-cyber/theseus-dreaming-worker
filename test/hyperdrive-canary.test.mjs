import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {fixturePage} from '../qa/cloudflare/hyperdrive-canary.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/source-reader.json',import.meta.url)));
const entry=fixture.entries[0];
const request={session_id:entry.session_id,generation_id:entry.index.generation_id,shard_id:entry.index.shard_id};
test('canary fixture rejects an unknown cursor instead of serving first page',()=>{
 assert.throws(()=>fixturePage({...request,cursor:'not-in-fixture'}),/FIXTURE_CURSOR/);
});
test('canary fixture serves the first page only for absent cursor and next page for exact cursor',()=>{
 assert.deepEqual(fixturePage(request),entry.pages[0]);
 assert.deepEqual(fixturePage({...request,cursor:entry.pages[0].next_cursor}),entry.pages[1]);
 assert.throws(()=>fixturePage({...request,shard_id:'wrong'}),/FIXTURE_MISMATCH/);
 assert.throws(()=>fixturePage({...request,cursor:''}),/FIXTURE_CURSOR/);
});
