import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { prepareVerifiedSessionWork } from '../src/dreaming/verified-session-work.ts';
import { prepareCheckpointedPilot2 } from '../src/dreaming/checkpoint-pilot2.ts';
import { runDurablePilot2 } from '../src/dreaming/durable-pilot2.ts';
import { sha256Fingerprint } from '../src/dreaming/proposal-schema.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/source-reader.json', import.meta.url), 'utf8'));
function input(entry = fixture.entries[0]) {
  return structuredClone({
    candidate: fixture.candidate, expected: fixture.expected,
    index: entry.index, sessionId: entry.session_id, pages: entry.pages,
    bounds: { maxPages: 20, maxChars: 1000, maxMessages: 50 },
    analysisVersion: 'fixture-v1', task: 'Analyze synthetic conversation.',
  });
}
const hash = value => sha256Fingerprint(value).slice(7);
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value !== null && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
    : JSON.stringify(value);
function rehash(candidate) {
  delete candidate.candidate_sha256;
  candidate.candidate_sha256 = hash(canonical(candidate));
}
const workKey = result => prepareCheckpointedPilot2({
  ...result.input, checkpoint: { status: 'AVAILABLE', committed: null },
}).workFingerprint;

test('actual PG16 reader pages bind all selected messages to source provenance', () => {
  for (const entry of fixture.entries) {
    const result = prepareVerifiedSessionWork(input(entry));
    assert.equal(result.status, 'PREPARED');
    assert.equal(result.input.request.packet.coverage.currentness, 'UNKNOWN');
    assert.equal(result.input.request.packet.coverage.state, 'PARTIAL');
    assert.equal(result.provenance.generation_id, entry.index.generation_id);
    assert.deepEqual(result.provenance.session, entry.index.sessions.find(s => s.session_id === entry.session_id));
    assert.ok(result.input.request.packet.evidence.length > 0);
    for (const item of result.input.request.packet.evidence) assert.equal(item.evidenceHash, sha256Fingerprint(item.text));
  }
});

test('rejects altered, missing, reordered, incomplete or over-budget pages', () => {
  for (const mutate of [
    x => { x.pages[0].messages[0].text = 'xxx'; },
    x => { x.pages[0].messages[0].role = 'assistant'; },
    x => { x.pages[0].messages[0].text_offset = 1; },
    x => { x.pages[0].generation_id = '0'.repeat(64); },
    x => { x.pages[0].session_title = 'other'; },
    x => { x.pages[0].coverage_complete = true; },
    x => { x.pages[0].next_cursor = x.pages[1].next_cursor; },
    x => { x.pages.splice(1, 1); },
    x => { x.pages.pop(); },
    x => { x.pages.reverse(); },
    x => { x.pages.push(x.pages.at(-1)); },
    x => { x.bounds.maxPages = 1; },
    x => { x.bounds.maxChars = 1; },
    x => { x.bounds.maxMessages = 1; },
    x => { x.index.sessions[0].messages[0].sources[0].artifact_sha256 = '0'.repeat(64); },
    x => { x.index.membership_snapshot_sha256 = '0'.repeat(64); },
    x => { x.index.sessions[0].messages[0].text_sha256 = '0'.repeat(64); },
  ]) {
    const x = input();
    mutate(x);
    assert.throws(() => prepareVerifiedSessionWork(x));
  }
});

test('new generation and additional source link do not create duplicate analysis work', async () => {
  const x = input();
  const first = prepareVerifiedSessionWork(x);
  const shard = x.index.shard_id;
  const manifest = 'a'.repeat(64);
  const generation = hash('session-search-generation-v1\n' + manifest);
  for (const row of x.candidate.catalog) if (row.shard_id === shard) row.generation_id = generation;
  for (const row of x.expected.catalog) if (row.shard_id === shard) row.generation_id = generation;
  for (const row of x.candidate.selected) if (row.shard_id === shard) {
    row.generation_id = generation;
    row.source_manifest_sha256 = manifest;
    row.bundle_sha256 = 'b'.repeat(64);
  }
  rehash(x.candidate);
  x.index.generation_id = generation;
  x.index.source_manifest_sha256 = manifest;
  for (const page of x.pages) page.generation_id = generation;
  const source = x.index.sessions[0].messages[0].sources[0];
  x.index.sessions[0].messages[0].sources.push({ ...source, member_name: 'synthetic-extra-observation' });
  const second = prepareVerifiedSessionWork(x);
  assert.notDeepEqual(first.provenance, second.provenance);
  assert.equal(workKey(first), workKey(second));
  let calls = 0;
  const store = {
    owner: null, value: null,
    async reserve(_key, owner) { if (this.owner) return false; this.owner = owner; return true; },
    async complete(owner, value) { assert.equal(owner, this.owner); this.value = structuredClone(value); },
    async readCompletion() { return structuredClone(this.value); },
  };
  const routes = ['a','b'].map(id => ({
    id, provider: id, model: id, modelFamily: id,
    infer: async request => {
      calls++;
      const evidence = request.packet.evidence[0];
      return { provider: id, model: id, finishReason: 'stop', text: JSON.stringify({
        schema: 'theseus.dreaming-worker.proposals.v1',
        proposals: [{type: 'FACT', claim: 'Synthetic observation.', source_refs: [
          {source_ref: evidence.sourceRef, evidence_hash: evidence.evidenceHash},
        ]}],
      }) };
    },
  }));
  assert.equal((await runDurablePilot2(first.input, routes, store)).decision, 'COMMITTED');
  assert.equal((await runDurablePilot2(second.input, routes, store)).decision, 'ALREADY_PROCESSED');
  assert.equal(calls, 2);
});

test('blank messages are verified but never create a model input when no usable text remains', () => {
  const x = input();
  const session = x.index.sessions[0];
  for (const m of session.messages) m.text_sha256 = hash('');
  const page = x.pages[0];
  x.pages = [{ ...page, messages: session.messages.map(m => ({
    ordinal: m.ordinal, message_id: m.message_id, role: m.role, search_class: m.search_class,
    create_time: m.create_time, text: '', text_offset: 0, text_total_chars: 0, complete_message: true,
  })), has_more: false, next_cursor: null, next_position: null, coverage_complete: false }];
  const result = prepareVerifiedSessionWork(x);
  assert.equal(result.status, 'NO_USABLE_EVIDENCE');
  assert.equal(result.input, null);
  assert.equal(result.provenance.session.messages.length, session.messages.length);
});

test('codepoint-split Unicode and changed content produce a distinct work identity', () => {
  const x = input();
  const first = prepareVerifiedSessionWork(x);
  const target = x.index.sessions[0].messages[0];
  target.text_sha256 = hash('🍵чай');
  const originalPages = x.pages;
  const base = originalPages[0];
  const metadata = { ordinal: target.ordinal, message_id: target.message_id, role: target.role,
    search_class: target.search_class, create_time: target.create_time };
  const start = { ...base, messages: [{ ...metadata, text: '🍵', text_offset: 0, text_total_chars: 4,
    complete_message: false }], next_position: { ordinal: target.ordinal, message_id: target.message_id, offset: 1 },
    next_cursor: 'synthetic-unicode-1' };
  const end = { ...base, messages: [{ ...metadata, text: 'чай', text_offset: 1, text_total_chars: 4,
    complete_message: true }], next_position: { ordinal: target.ordinal, message_id: target.message_id, offset: 0 },
    next_cursor: 'synthetic-unicode-2' };
  const otherMessages = x.index.sessions[0].messages.slice(1).map(m => {
    const text = originalPages.flatMap(p => p.messages)
      .filter(part => part.message_id === m.message_id).map(part => part.text).join('');
    return { ordinal: m.ordinal, message_id: m.message_id, role: m.role,
      search_class: m.search_class, create_time: m.create_time, text, text_offset: 0,
      text_total_chars: Array.from(text).length, complete_message: true };
  });
  x.pages = [start, end, ...otherMessages.map((m, i) => ({
    ...base, messages: [m], has_more: i < otherMessages.length - 1,
    next_position: i < otherMessages.length - 1 ? { ordinal: m.ordinal, message_id: m.message_id, offset: 0 } : null,
    next_cursor: i < otherMessages.length - 1 ? 'synthetic-unicode-other-' + i : null,
    coverage_complete: false,
  }))];
  const next = prepareVerifiedSessionWork(x);
  assert.equal(next.input.request.packet.evidence[0].text, '🍵чай');
  assert.notEqual(workKey(first), workKey(next));
});

test('index custody independently binds provider, shard, generation and manifest',()=>{
  for(const [field,value] of [
    ['provider','other-provider'],['shard_id','other-shard'],
    ['generation_id','f'.repeat(64)],['source_manifest_sha256','e'.repeat(64)],
    ['membership_snapshot_sha256','d'.repeat(64)],
  ]){
    const x=input();x.index[field]=value;
    assert.throws(()=>prepareVerifiedSessionWork(x),/VERIFIED_SESSION_INDEX_BINDING/,field);
  }
});

test('index rejects duplicated sessions, wrong shard selection and duplicated message provenance',()=>{
  const duplicate=input();duplicate.index.sessions.push(structuredClone(duplicate.index.sessions[0]));
  assert.throws(()=>prepareVerifiedSessionWork(duplicate),/VERIFIED_SESSION_INDEX_SELECTION/);
  const foreign=input();foreign.index.sessions.push(structuredClone(fixture.entries[1].index.sessions[0]));
  assert.throws(()=>prepareVerifiedSessionWork(foreign),/VERIFIED_SESSION_INDEX_SELECTION/);
  const absent=input();absent.index.sessions[0].session_id='unknown';
  assert.throws(()=>prepareVerifiedSessionWork(absent),/VERIFIED_SESSION_INDEX_SELECTION/);
  const duplicateMessage=input();
  duplicateMessage.index.sessions[0].messages[1].message_id=duplicateMessage.index.sessions[0].messages[0].message_id;
  assert.throws(()=>prepareVerifiedSessionWork(duplicateMessage),/VERIFIED_SESSION_MESSAGE_ORDER/);
  const equalOrdinal=input();
  equalOrdinal.index.sessions[0].messages[1].ordinal=equalOrdinal.index.sessions[0].messages[0].ordinal;
  assert.throws(()=>prepareVerifiedSessionWork(equalOrdinal),/VERIFIED_SESSION_MESSAGE_ORDER/);
  const duplicateSource=input(),sources=duplicateSource.index.sessions[0].messages[0].sources;
  sources.push(structuredClone(sources[0]));
  assert.throws(()=>prepareVerifiedSessionWork(duplicateSource),/VERIFIED_SESSION_SOURCE_MEMBERSHIP/);
});

test('page independently binds provider, shard, session and exposed coverage',()=>{
  for(const [field,value] of [
    ['provider','other-provider'],['shard_id','other-shard'],['session_id','other-session'],
    ['session_coverage','COMPLETE_EXPOSED_CONVERSATION'],['queried_shards',['other-shard']],
    ['has_more',false],
  ]){
    const x=input();x.pages[0][field]=value;
    assert.throws(()=>prepareVerifiedSessionWork(x),/VERIFIED_SESSION_PAGE_BINDING/,field);
  }
});

test('message segments independently bind ordinal, ID, class, timestamp and declared length',()=>{
  for(const [field,value] of [
    ['ordinal',7],['message_id','other-message'],['search_class','trace'],['create_time',123456],
  ]){
    const x=input();x.pages[0].messages[0][field]=value;
    assert.throws(()=>prepareVerifiedSessionWork(x),/VERIFIED_SESSION_MESSAGE_BINDING/,field);
  }
  const changedLength=input();changedLength.pages[1].messages[0].text_total_chars++;
  assert.throws(()=>prepareVerifiedSessionWork(changedLength),/VERIFIED_SESSION_MESSAGE_BINDING/);
  const premature=input();premature.pages[0].messages[0].complete_message=true;
  assert.throws(()=>prepareVerifiedSessionWork(premature),/VERIFIED_SESSION_TEXT_BUDGET_OR_SEGMENT/);
  const zero=input();zero.pages[0].messages[0].text='';
  assert.throws(()=>prepareVerifiedSessionWork(zero),/VERIFIED_SESSION_TEXT_BUDGET_OR_SEGMENT/);
  const overflow=input();overflow.pages[0].messages[0].text='123456789';
  assert.throws(()=>prepareVerifiedSessionWork(overflow),/VERIFIED_SESSION_TEXT_BUDGET_OR_SEGMENT/);
});

test('cursor must bind exact segment position; final page cannot expose a continuation',()=>{
  for(const [field,value] of [['ordinal',7],['message_id','other-message'],['offset',4]]){
    const x=input();x.pages[0].next_position[field]=value;
    assert.throws(()=>prepareVerifiedSessionWork(x),/VERIFIED_SESSION_CURSOR/,field);
  }
  for(const field of ['next_cursor','next_position']){
    const x=input();x.pages.at(-1)[field]=structuredClone(x.pages[0][field]);
    assert.throws(()=>prepareVerifiedSessionWork(x),/VERIFIED_SESSION_INCOMPLETE/,field);
    const missing=input();missing.pages[0][field]=null;
    assert.throws(()=>prepareVerifiedSessionWork(missing),/VERIFIED_SESSION_CURSOR/,field);
  }
  const repeated=input();repeated.pages[1].next_cursor=repeated.pages[0].next_cursor;
  assert.throws(()=>prepareVerifiedSessionWork(repeated),/VERIFIED_SESSION_CURSOR/);
  const empty=input();empty.pages[0].messages=[];
  assert.throws(()=>prepareVerifiedSessionWork(empty),/VERIFIED_SESSION_EMPTY_PAGE/);
});

test('exact admission budgets accept all verified text and preserve provenance identity',()=>{
  const x=input();
  x.bounds={maxPages:x.pages.length,maxMessages:x.index.sessions[0].messages.length,
    maxChars:x.pages.flatMap(p=>p.messages).reduce((n,m)=>n+Array.from(m.text).length,0)};
  const r=prepareVerifiedSessionWork(x);
  assert.equal(r.status,'PREPARED');
  const selected=x.index.sessions[0];
  assert.deepEqual(r.input.request.packet.evidence,selected.messages.map(m=>({
    sourceRef:'ss-message-v1:'+JSON.stringify([x.candidate.scope,x.candidate.provider,x.sessionId,m.message_id,m.role,m.search_class]),
    evidenceHash:'sha256:'+m.text_sha256,
    text:x.pages.flatMap(p=>p.messages).filter(part=>part.message_id===m.message_id).map(part=>part.text).join(''),
  })));
  assert.deepEqual(r.provenance.session,selected);
  assert.equal(r.input.request.packet.packetId,sha256Fingerprint(JSON.stringify([x.candidate.candidate_sha256,x.sessionId])));
  assert.equal(r.input.acceptedSourceFingerprint,sha256Fingerprint(JSON.stringify([
    'theseus.session-search-scoped-content-work.v1',x.candidate.scope,x.candidate.provider,x.sessionId,selected.title,selected.coverage_state,
    selected.messages.map(m=>[m.ordinal,m.message_id,m.role,m.search_class,m.create_time,m.text_sha256,m.canonical_message_sha256]),
  ])));
});

test('complete exposed session is admitted only with final coverage flag',()=>{
  const x=input();
  x.index.sessions[0].coverage_state='COMPLETE_EXPOSED_CONVERSATION';
  for(const p of x.pages)p.session_coverage='COMPLETE_EXPOSED_CONVERSATION';
  x.pages.at(-1).coverage_complete=true;
  const r=prepareVerifiedSessionWork(x);
  assert.equal(r.status,'PREPARED');
  assert.equal(r.input.request.packet.coverage.state,'COMPLETE');
  x.pages.at(-1).coverage_complete=false;
  assert.throws(()=>prepareVerifiedSessionWork(x),/VERIFIED_SESSION_PAGE_BINDING/);
});

test('empty admitted session yields no work, and cannot have continuation',()=>{
  const x=input();
  x.index.sessions[0].messages=[];
  x.pages=[{...x.pages[0],messages:[],has_more:false,next_position:null,next_cursor:null}];
  const r=prepareVerifiedSessionWork(x);
  assert.equal(r.status,'NO_USABLE_EVIDENCE');
  assert.equal(r.input,null);
  assert.deepEqual(r.provenance.session.messages,[]);
  x.pages[0].has_more=true;
  x.pages[0].next_position={ordinal:0,message_id:'m-u',offset:0};
  x.pages[0].next_cursor='synthetic-continuation';
  x.pages.push({...x.pages[0],has_more:false,next_position:null,next_cursor:null});
  assert.throws(()=>prepareVerifiedSessionWork(x),/VERIFIED_SESSION_EMPTY_PAGE/);
});

test('verified empty and whitespace messages do not create evidence work',()=>{
  for(const text of ['', '   ']){
    const x=input();
    const session=x.index.sessions[0];
    session.messages=[{...session.messages[0],text_sha256:hash(text)}];
    x.pages=[{...x.pages[0],messages:[{...x.pages[0].messages[0],text,text_offset:0,text_total_chars:text.length,complete_message:true}],has_more:false,next_position:null,next_cursor:null}];
    const r=prepareVerifiedSessionWork(x);
    assert.equal(r.status,'NO_USABLE_EVIDENCE');
    assert.equal(r.input,null);
  }
});

test('partial segment cannot be followed by another segment on the same page',()=>{
  const x=input();
  x.pages[0].messages.push(structuredClone(x.pages[1].messages[0]));
  assert.throws(()=>prepareVerifiedSessionWork(x),/VERIFIED_SESSION_PARTIAL_NOT_LAST/);
});

test('synthetic reader refuses a correctly rehashed non-synthetic custody scope',()=>{
  const x=input(),scope='ordinary-fixture';
  x.candidate.scope=scope;x.expected.scope=scope;
  for(const m of [x.candidate.previous_membership,x.candidate.current_membership]){
    m.scope=scope;delete m.snapshot_sha256;m.snapshot_sha256=hash(canonical(m));
  }
  x.expected.previousSnapshotSha256=x.candidate.previous_membership.snapshot_sha256;
  x.index.membership_snapshot_sha256=x.candidate.current_membership.snapshot_sha256;
  rehash(x.candidate);
  assert.throws(()=>prepareVerifiedSessionWork(x),/VERIFIED_SESSION_SCOPE_UNSUPPORTED/);
});

test('empty final page cannot discard indexed messages',()=>{
  const x=input();
  x.pages=[{...x.pages[0],messages:[],has_more:false,next_position:null,next_cursor:null}];
  assert.throws(()=>prepareVerifiedSessionWork(x),/VERIFIED_SESSION_EMPTY_PAGE/);
});
