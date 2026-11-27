import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from 'pg';

import { createProposalRecord, createSupersessionEvent } from '../src/dreaming/proposal-ledger.ts';
import { createPostgresProposalLedger } from '../src/dreaming/proposal-ledger-postgres.ts';

const routeA = { id: 'route-a', provider: 'provider-a', model: 'model-a', modelFamily: 'family-a' };
const routeB = { id: 'route-b', provider: 'provider-b', model: 'model-b', modelFamily: 'family-b' };

const hypothesis = claim => ({
  type: 'HYPOTHESIS',
  claim,
  why_plausible: 'Plausible from the bounded evidence packet.',
  source_refs: [{ source_ref: 'fixture:1', evidence_hash: 'sha256:e1' }],
  falsifier: 'A bounded counterexample disproves the candidate.',
  required_evidence: ['A bounded counterexample or supporting trace.'],
  competing_explanations: ['A competing mechanism.'],
  uncertainty: 'MEDIUM',
});

function origin(perspectiveId, route) {
  return {
    packetId: 'packet-001',
    evidenceFingerprint: 'sha256:evidence',
    requestFingerprint: 'sha256:request',
    perspectiveId,
    route,
  };
}

function events() {
  const a = createProposalRecord({ proposal: hypothesis('A'), origin: origin('route-a', routeA) });
  const b = createProposalRecord({ proposal: hypothesis('B'), origin: origin('route-b', routeB) });
  const supersede = createSupersessionEvent({
    supersededRecordId: a.recordId,
    replacementRecordId: b.recordId,
    reason: 'B is the newer candidate.',
  });
  return { a, b, supersede };
}

function rowFor(event, eventSeq) {
  if (event.eventType === 'PROPOSAL') {
    return {
      event_seq: eventSeq,
      event_type: 'PROPOSAL',
      schema_name: event.schema,
      authority: event.authority,
      record_id: event.recordId,
      proposal_fingerprint: event.proposalFingerprint,
      packet_id: event.origin.packetId,
      evidence_fingerprint: event.origin.evidenceFingerprint,
      request_fingerprint: event.origin.requestFingerprint,
      perspective_id: event.origin.perspectiveId,
      route_id: event.origin.route.id,
      route_provider: event.origin.route.provider,
      route_model: event.origin.route.model,
      route_model_family: event.origin.route.modelFamily,
      proposal: structuredClone(event.proposal),
      event_id: null,
      superseded_record_id: null,
      replacement_record_id: null,
      reason: null,
    };
  }
  return {
    event_seq: eventSeq,
    event_type: 'SUPERSEDE',
    schema_name: event.schema,
    authority: event.authority,
    record_id: null,
    proposal_fingerprint: null,
    packet_id: null,
    evidence_fingerprint: null,
    request_fingerprint: null,
    perspective_id: null,
    route_id: null,
    route_provider: null,
    route_model: null,
    route_model_family: null,
    proposal: null,
    event_id: event.eventId,
    superseded_record_id: event.supersededRecordId,
    replacement_record_id: event.replacementRecordId,
    reason: event.reason,
  };
}

function fakeClient({ rows = [], failOnInsert = null, failOnConnect = null } = {}) {
  const calls = [];
  let connected = false;
  let ended = false;
  return {
    calls,
    get connected() { return connected; },
    get ended() { return ended; },
    async connect() {
      if (failOnConnect) throw failOnConnect;
      connected = true;
    },
    async query(text, values = []) {
      calls.push({ text, values: structuredClone(values) });
      if (failOnInsert && /INSERT INTO dw_ledger\./.test(text)) throw failOnInsert;
      if (/FROM dw_ledger\.proposal_records/.test(text) && /UNION ALL/.test(text)) return { rows: structuredClone(rows) };
      return { rows: [] };
    },
    async end() { ended = true; },
  };
}

test('readEvents reconstructs one exact append order across proposal and supersession rows', async () => {
  const { a, b, supersede } = events();
  const client = fakeClient({ rows: [rowFor(a, 1), rowFor(b, 2), rowFor(supersede, 3)] });
  const ledger = createPostgresProposalLedger({
    connectionString: 'postgresql://runtime:secret@example.invalid/dreaming_issue23',
    clientFactory: () => client,
  });

  const result = await ledger.readEvents();

  assert.deepEqual(result, [a, b, supersede]);
  assert.equal(client.connected, true);
  assert.equal(client.ended, true);
  const read = client.calls.find(call => /UNION ALL/.test(call.text));
  assert.match(read.text, /ORDER BY event_seq ASC/);
});

test('appendEvent writes a proposal with parameters after validating current ledger state', async () => {
  const { a } = events();
  const client = fakeClient();
  const ledger = createPostgresProposalLedger({
    connectionString: 'postgresql://runtime:secret@example.invalid/dreaming_issue23',
    clientFactory: () => client,
  });

  await ledger.appendEvent(a);

  const insert = client.calls.find(call => /INSERT INTO dw_ledger\.proposal_records/.test(call.text));
  assert.ok(insert);
  assert.ok(insert.values.includes(a.recordId));
  assert.equal(insert.values[13], JSON.stringify(a.proposal));
  assert.match(insert.text, /\$14::jsonb/);
  assert.ok(client.calls.some(call => /pg_advisory_xact_lock/.test(call.text)));
  assert.ok(client.calls.some(call => /^COMMIT$/i.test(call.text.trim())));
  assert.equal(client.ended, true);
});

test('appendEvent writes a supersession only after existing records validate', async () => {
  const { a, b, supersede } = events();
  const client = fakeClient({ rows: [rowFor(a, 1), rowFor(b, 2)] });
  const ledger = createPostgresProposalLedger({
    connectionString: 'postgresql://runtime:secret@example.invalid/dreaming_issue23',
    clientFactory: () => client,
  });

  await ledger.appendEvent(supersede);

  const insert = client.calls.find(call => /INSERT INTO dw_ledger\.supersession_events/.test(call.text));
  assert.ok(insert);
  assert.deepEqual(insert.values.slice(0, 4), [
    supersede.eventId,
    supersede.schema,
    supersede.authority,
    supersede.supersededRecordId,
  ]);
  assert.ok(insert.values.includes(supersede.replacementRecordId));
  assert.ok(insert.values.includes(supersede.reason));
});

test('appendEvent rolls back and closes the client when persistence fails', async () => {
  const { a } = events();
  const expected = new Error('synthetic insert failure');
  const client = fakeClient({ failOnInsert: expected });
  const ledger = createPostgresProposalLedger({
    connectionString: 'postgresql://runtime:secret@example.invalid/dreaming_issue23',
    clientFactory: () => client,
  });

  await assert.rejects(() => ledger.appendEvent(a), expected);
  assert.ok(client.calls.some(call => /^ROLLBACK$/i.test(call.text.trim())));
  assert.equal(client.ended, true);
});

test('appendEvent rejects a cycle against persisted history before issuing INSERT', async () => {
  const { a, b } = events();
  const first = createSupersessionEvent({
    supersededRecordId: a.recordId,
    replacementRecordId: b.recordId,
    reason: 'A -> B',
  });
  const cycle = createSupersessionEvent({
    supersededRecordId: b.recordId,
    replacementRecordId: a.recordId,
    reason: 'B -> A',
  });
  const client = fakeClient({ rows: [rowFor(a, 1), rowFor(b, 2), rowFor(first, 3)] });
  const ledger = createPostgresProposalLedger({
    connectionString: 'postgresql://runtime:secret@example.invalid/dreaming_issue23',
    clientFactory: () => client,
  });

  await assert.rejects(() => ledger.appendEvent(cycle), /LEDGER_SUPERSESSION_CYCLE/);
  assert.equal(client.calls.some(call => /INSERT INTO dw_ledger\./.test(call.text)), false);
  assert.ok(client.calls.some(call => /^ROLLBACK$/i.test(call.text.trim())));
  assert.equal(client.ended, true);
});


test('readEvents rejects persisted proposal rows whose fingerprint no longer matches the payload', async () => {
  const { a } = events();
  const row = rowFor(a, 1);
  row.proposal_fingerprint = 'sha256:' + '0'.repeat(64);
  const client = fakeClient({ rows: [row] });
  const ledger = createPostgresProposalLedger({
    connectionString: 'postgresql://runtime:secret@example.invalid/dreaming_issue23',
    clientFactory: () => client,
  });

  await assert.rejects(() => ledger.readEvents(), /LEDGER_PROPOSAL_FINGERPRINT_MISMATCH/);
  assert.equal(client.ended, true);
});


test('appendEvent closes the client when connection establishment fails', async () => {
  const { a } = events();
  const expected = new Error('synthetic connect failure');
  const client = fakeClient({ failOnConnect: expected });
  const ledger = createPostgresProposalLedger({
    connectionString: 'postgresql://runtime:secret@example.invalid/dreaming_issue23',
    clientFactory: () => client,
  });

  await assert.rejects(() => ledger.appendEvent(a), expected);
  assert.equal(client.ended, true);
  assert.equal(client.calls.some(call => /^ROLLBACK$/i.test(call.text.trim())), false);
});

test('default client receives exact connection parameters without network I/O', async (t) => {
  const seen = [];
  t.mock.method(Client.prototype, 'connect', async function () {
    const { host, port, user, database, password } = this.connectionParameters;
    seen.push({ host, port, user, database, password });
  });
  t.mock.method(Client.prototype, 'query', async () => ({ rows: [] }));
  t.mock.method(Client.prototype, 'end', async () => {});
  const ledger = createPostgresProposalLedger({
    connectionString: 'postgresql://fixture_user:fixture_password@fixture.invalid:54329/fixture_db',
  });
  assert.deepEqual(await ledger.readEvents(), []);
  assert.deepEqual(seen, [{
    host: 'fixture.invalid', port: 54329, user: 'fixture_user',
    database: 'fixture_db', password: 'fixture_password',
  }]);
});

test('transaction starts before the lock and read, then commits after INSERT', async () => {
  const { a } = events();
  const client = fakeClient();
  const ledger = createPostgresProposalLedger({
    connectionString: 'postgresql://fixture.invalid/fixture', clientFactory: () => client,
  });
  await ledger.appendEvent(a);
  const stages = client.calls.map(({ text }) => {
    const sql = text.trim();
    if (sql === 'BEGIN' || sql === 'COMMIT') return sql;
    if (sql.startsWith('SELECT pg_advisory_xact_lock(')) return 'LOCK';
    if (sql.includes('UNION ALL')) return 'READ';
    if (sql.startsWith('INSERT INTO dw_ledger.proposal_records')) return 'INSERT';
    return 'UNEXPECTED';
  });
  assert.deepEqual(stages, ['BEGIN', 'LOCK', 'READ', 'INSERT', 'COMMIT']);
});

test('all required null row fields fail closed with exact field diagnostics', async () => {
  const { a, b, supersede } = events();
  const cases = [
    [a, ['record_id', 'proposal_fingerprint', 'packet_id', 'evidence_fingerprint',
      'request_fingerprint', 'perspective_id', 'route_id', 'route_provider', 'route_model', 'route_model_family']],
    [supersede, ['event_id', 'superseded_record_id', 'replacement_record_id', 'reason']],
  ];
  for (const [event, fields] of cases) {
    for (const field of fields) {
      const row = { ...rowFor(event, 3), [field]: null };
      const rows = event.eventType === 'PROPOSAL' ? [row] : [rowFor(a, 1), rowFor(b, 2), row];
      const client = fakeClient({ rows });
      const ledger = createPostgresProposalLedger({
        connectionString: 'postgresql://fixture.invalid/fixture', clientFactory: () => client,
      });
      await assert.rejects(() => ledger.readEvents(), { message: 'LEDGER_STORAGE_ROW_INVALID: ' + field });
      assert.equal(client.ended, true);
    }
  }
});

// Pool journal SQL boundary: independent scripted query receipts, including
// inconsistent reads and lost acknowledgements that real PG cannot easily emit.
const {createPostgresPoolJournalStore}=await import('../src/dreaming/proposal-ledger-postgres.ts');
const {preparePoolJournal,poolJournalAdmission,makePoolJournalEntry,replayPoolJournal}=await import('../src/dreaming/pool-attempt-journal.ts');
const poolInput={
  acceptedSourceFingerprint:'sha256:'+'a'.repeat(64),analysisVersion:'pool-sql-test',
  request:{scope:'SYNTHETIC_FIXTURE',task:'Analyze fixture.',packet:{
    schema:'theseus-evidence-packet-v1',packetId:'pool-sql',acceptedNewEvidence:true,
    coverage:{state:'COMPLETE',currentness:'CURRENT'},
    evidence:[{sourceRef:'fixture:1',evidenceHash:'sha256:fixture',text:'Synthetic observation.'}],
  }},
};
const poolContext=preparePoolJournal(poolInput);
const poolOwner='00000000-0000-4000-8000-000000000001';
const poolOther='00000000-0000-4000-8000-000000000002';
const poolFirst=makePoolJournalEntry(null,poolJournalAdmission(poolContext,4));
const poolDifferent=makePoolJournalEntry(null,poolJournalAdmission(poolContext,5));
const poolStart={kind:'START',attemptId:'00000000-0000-4000-8000-000000000003',slot:0,route:routeA};
const poolNext=makePoolJournalEntry(poolFirst,poolStart);
const poolReadSQL=`SELECT r.owner_token, j.ordinal, j.entry,
      EXISTS(SELECT 1 FROM dw_ledger.work_completions c WHERE c.work_fingerprint=r.work_fingerprint) AS completion_exists
      FROM dw_ledger.work_reservations r
      LEFT JOIN dw_ledger.work_pool_journal j
        ON j.work_fingerprint=r.work_fingerprint AND j.owner_token=r.owner_token
      WHERE r.work_fingerprint=$1 ORDER BY j.ordinal`;
const poolReserveSQL='INSERT INTO dw_ledger.work_reservations (work_fingerprint, owner_token) VALUES ($1,$2) ON CONFLICT (work_fingerprint) DO NOTHING RETURNING owner_token';
const poolAdmitSQL='INSERT INTO dw_ledger.work_pool_journal(work_fingerprint,owner_token,ordinal,entry) VALUES ($1,$2,0,$3::jsonb)';
const poolAppendSQL='INSERT INTO dw_ledger.work_pool_journal(work_fingerprint,owner_token,ordinal,entry) VALUES ($1,$2,$3,$4::jsonb)';
const poolLockSQL="SELECT pg_advisory_xact_lock(hashtext('dw_ledger:v1'))";
const poolRows=(entries,completion=false)=>entries.map(entry=>({owner_token:poolOwner,ordinal:entry.ordinal,entry,completion_exists:completion}));
const poolLegacy=completion=>[{owner_token:poolOwner,ordinal:null,entry:null,completion_exists:completion}];
const poolQ=(sql,params=[],rows=[])=>({sql,params,rows});
const poolRead=rows=>poolQ(poolReadSQL,[poolContext.workFingerprint],rows);
const poolTx=steps=>[poolQ('BEGIN'),poolQ(poolLockSQL),...steps,poolQ('COMMIT')];
const poolRollback=steps=>[poolQ('BEGIN'),poolQ(poolLockSQL),...steps,poolQ('ROLLBACK')];
const poolReserve=rows=>poolQ(poolReserveSQL,[poolContext.workFingerprint,poolOwner],rows);
const poolAdmit=poolQ(poolAdmitSQL,[poolContext.workFingerprint,poolOwner,JSON.stringify(poolFirst)]);
const poolAppend=poolQ(poolAppendSQL,[poolContext.workFingerprint,poolOwner,1,JSON.stringify(poolNext)]);
function poolScript(groups){
  let opened=0,closed=0;
  const unexpected=[];
  const store=createPostgresPoolJournalStore({
    connectionString:'postgresql://fixture.invalid/pool',
    clientFactory(connectionString){
      assert.equal(connectionString,'postgresql://fixture.invalid/pool');
      const group=groups[opened++];assert.ok(group,'unexpected client');
      let index=0;
      return {
        async connect(){if(group.connectError)throw group.connectError;},
        async query(sql,params=[]){
          const step=group.steps[index++];
          // Preserve protocol errors independently of production catch/rollback.
          try{assert.ok(step,'unexpected query');assert.equal(sql,step.sql);assert.deepEqual(params,step.params);}
          catch(e){unexpected.push(e);throw e;}
          if(step.error)throw step.error;
          return {rows:structuredClone(step.rows)};
        },
        async end(){
          closed++;
          try{assert.equal(index,group.steps.length,'unconsumed query receipts');}
          catch(e){unexpected.push(e);throw e;}
        },
      };
    },
  });
  return {store,done(){assert.deepEqual(unexpected,[]);assert.equal(opened,groups.length);assert.equal(closed,opened);}};
}
const group=steps=>({steps});
const poolState=entries=>replayPoolJournal(poolContext,entries);
const poolView=(entries,completionExists=false)=>({status:'JOURNAL',ownerToken:poolOwner,completionExists,state:poolState(entries)});
test('pool journal reads absent, legacy, completion, and exact ordered journal rows',async()=>{
  for(const [rows,expected] of [
    [[],{status:'ABSENT'}],[poolLegacy(false),{status:'LEGACY_UNRESOLVED'}],
    [poolLegacy(true),{status:'COMPLETION_EXISTS'}],
    [poolRows([poolFirst]),poolView([poolFirst])],
    [poolRows([poolFirst,poolNext],true),poolView([poolFirst,poolNext],true)],
    [poolRows([poolFirst,poolNext]),poolView([poolFirst,poolNext])],
  ]){
    const s=poolScript([group([poolRead(rows)])]);
    assert.deepEqual(await s.store.read(poolInput),expected);s.done();
  }
});
test('pool journal rejects each inconsistent storage row independently',async()=>{
  const rows=poolRows([poolFirst,poolNext]);
  const cases=[
    [...poolLegacy(false),...rows],
    [{...poolLegacy(false)[0],entry:poolFirst}],
    [{...rows[0],ordinal:1}],
    [rows[0],{...rows[1],ordinal:0}],
    [rows[0],{...rows[1],entry:null}],
    [rows[0],{...rows[1],owner_token:poolOther}],
    [rows[0],{...rows[1],completion_exists:true}],
  ];
  for(const bad of cases){
    const s=poolScript([group([poolRead(bad)])]);
    await assert.rejects(s.store.read(poolInput),{message:'POOL_JOURNAL_ROW_INVALID'});s.done();
  }
});
test('pool journal admission writes reservation and first entry atomically then reads back',async()=>{
  const s=poolScript([group(poolTx([poolRead([]),poolReserve([{owner_token:poolOwner}]),poolAdmit])),
    group([poolRead(poolRows([poolFirst]))])]);
  assert.deepEqual(await s.store.admit(poolInput,4,poolOwner),poolView([poolFirst]));s.done();
});
test('pool journal admission never takes over an existing reservation',async()=>{
  for(const [rows,expected] of [
    [poolLegacy(false),{status:'LEGACY_UNRESOLVED'}],[poolLegacy(true),{status:'COMPLETION_EXISTS'}],
    [poolRows([poolFirst]),poolView([poolFirst])],
  ]){
    const s=poolScript([group(poolTx([poolRead(rows)])),group([poolRead(rows)])]);
    assert.deepEqual(await s.store.admit(poolInput,4,poolOther),expected);s.done();
  }
  const s=poolScript([group(poolRollback([poolRead(poolRows([poolDifferent]))]))]);
  await assert.rejects(s.store.admit(poolInput,4,poolOwner),{message:'POOL_JOURNAL_ADMISSION_CONFLICT'});s.done();
});
test('pool journal admission rejects reservation conflicts and missing or changed readback',async()=>{
  for(const rows of [[],[{owner_token:poolOther}],[{owner_token:poolOwner},{owner_token:poolOther}]]){
    const s=poolScript([group(poolRollback([poolRead([]),poolReserve(rows)]))]);
    await assert.rejects(s.store.admit(poolInput,4,poolOwner),{message:'POOL_JOURNAL_RESERVATION_CONFLICT'});s.done();
  }
  for(const rows of [[],poolRows([poolDifferent])]){
    const s=poolScript([group(poolTx([poolRead([]),poolReserve([{owner_token:poolOwner}]),poolAdmit])),group([poolRead(rows)])]);
    await assert.rejects(s.store.admit(poolInput,4,poolOwner),{message:'POOL_JOURNAL_ADMISSION_READBACK'});s.done();
  }
});
test('pool journal append verifies exact tip, inserts exact next entry and reads back',async()=>{
  const s=poolScript([group(poolTx([poolRead(poolRows([poolFirst])),poolAppend])),
    group([poolRead(poolRows([poolFirst,poolNext]))])]);
  assert.deepEqual(await s.store.append(poolInput,poolFirst.entryFingerprint,poolStart),poolState([poolFirst,poolNext]));s.done();
});
test('pool journal append rejects absent, completed, stale or invalid transition before insert',async()=>{
  for(const [rows,tip] of [[[],poolFirst.entryFingerprint],[poolLegacy(false),poolFirst.entryFingerprint],
    [poolRows([poolFirst],true),poolFirst.entryFingerprint],[poolRows([poolFirst]),poolNext.entryFingerprint]]){
    const s=poolScript([group(poolRollback([poolRead(rows)]))]);
    await assert.rejects(s.store.append(poolInput,tip,poolStart),{message:'POOL_JOURNAL_TIP_CONFLICT'});s.done();
  }
  const s=poolScript([group(poolRollback([poolRead(poolRows([poolFirst,poolNext]))]))]);
  await assert.rejects(s.store.append(poolInput,poolNext.entryFingerprint,{...poolStart,attemptId:poolOther}),{message:'POOL_JOURNAL_START_REJECTED'});s.done();
});
test('pool journal append rejects missing, completed or stale post-commit readback',async()=>{
  for(const rows of [[],poolLegacy(false),poolRows([poolFirst,poolNext],true),poolRows([poolFirst])]){
    const s=poolScript([group(poolTx([poolRead(poolRows([poolFirst])),poolAppend])),group([poolRead(rows)])]);
    await assert.rejects(s.store.append(poolInput,poolFirst.entryFingerprint,poolStart),{message:'POOL_JOURNAL_APPEND_READBACK'});s.done();
  }
});
test('pool journal preserves original failure on insert, commit and rollback errors',async()=>{
  const err=Error('fixture persistence error');
  for(const steps of [
    poolRollback([poolRead(poolRows([poolFirst])),{...poolAppend,error:err}]),
    [poolQ('BEGIN'),poolQ(poolLockSQL),poolRead(poolRows([poolFirst])),poolAppend,{...poolQ('COMMIT'),error:err},poolQ('ROLLBACK')],
    [poolQ('BEGIN'),poolQ(poolLockSQL),poolRead(poolRows([poolFirst])),{...poolAppend,error:err},{...poolQ('ROLLBACK'),error:Error('rollback failure')}],
  ]){
    const s=poolScript([group(steps)]);
    await assert.rejects(s.store.append(poolInput,poolFirst.entryFingerprint,poolStart),err);s.done();
  }
  const s=poolScript([{steps:[],connectError:err}]);
  await assert.rejects(s.store.read(poolInput),err);s.done();
});
test('pool journal default client uses exact connection and closes after read',async t=>{
  const calls=[];
  t.mock.method(Client.prototype,'connect',async function(){calls.push(['connect',this.connectionParameters.host]);});
  t.mock.method(Client.prototype,'query',async function(sql,params){calls.push([sql,params]);return {rows:[]};});
  t.mock.method(Client.prototype,'end',async function(){calls.push(['end']);});
  const store=createPostgresPoolJournalStore({connectionString:'postgresql://fixture.invalid/pool'});
  assert.deepEqual(await store.read(poolInput),{status:'ABSENT'});
  assert.deepEqual(calls,[['connect','fixture.invalid'],[poolReadSQL,[poolContext.workFingerprint]],['end']]);
});
