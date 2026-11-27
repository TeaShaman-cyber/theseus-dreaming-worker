import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { createPostgresWorkStore } from '../src/dreaming/proposal-ledger-postgres.ts';
import { runDurablePilot2, validateWorkCompletion } from '../src/dreaming/durable-pilot2.ts';

const input = {
  acceptedSourceFingerprint: 'sha256:' + 'a'.repeat(64),
  analysisVersion: 'v1',
  request: {
    scope: 'SYNTHETIC_FIXTURE',
    task: 'Analyze synthetic evidence.',
    packet: {
      schema: 'theseus-evidence-packet-v1',
      packetId: 'fixture-durable',
      acceptedNewEvidence: true,
      coverage: { state: 'PARTIAL', currentness: 'UNKNOWN' },
      evidence: [{ sourceRef: 'fixture:1', evidenceHash: 'sha256:fixture', text: 'Synthetic observation.' }],
    },
  },
};
const proposal = {
  type: 'FACT', claim: 'Synthetic observation.',
  source_refs: [{ source_ref: 'fixture:1', evidence_hash: 'sha256:fixture' }],
};
function routes({ fail = false, duplicate = false, finish = 'stop' } = {}) {
  const calls = [];
  return {
    calls,
    adapters: ['a', 'b'].map(id => ({
      id, provider: 'configured-' + id, model: 'configured-' + id, modelFamily: id,
      infer: async request => {
        calls.push({ id, text: request.packet.evidence[0].text });
        if (fail && id === 'b') throw Error('fixture failure');
        return {
          provider: 'observed-' + id, model: 'observed-model-' + id, finishReason: finish,
          text: JSON.stringify({
            schema: 'theseus.dreaming-worker.proposals.v1',
            proposals: duplicate ? [proposal, proposal] : [proposal],
          }),
        };
      },
    })),
  };
}
function memoryStore({ failReserve = false, failCommit = false, loseAck = false, corrupt = false } = {}) {
  const reserved = new Map();
  const completions = new Map();
  let writes = 0;
  return {
    reserved, completions,
    get writes() { return writes; },
    async reserve(work, owner) {
      if (failReserve) throw Error('unknown reservation');
      if (reserved.has(work)) return false;
      reserved.set(work, owner);
      return true;
    },
    async complete(owner, completion) {
      assert.equal(reserved.get(completion.checkpoint.workFingerprint), owner);
      writes++;
      if (failCommit) throw Error('transaction failed');
      completions.set(completion.checkpoint.workFingerprint, structuredClone(completion));
      if (loseAck) throw Error('lost acknowledgement');
    },
    async readCompletion(work) {
      const value = structuredClone(completions.get(work) ?? null);
      if (value && corrupt) value.records[0].proposal.claim = 'changed';
      return value;
    },
  };
}
test('concurrent callers reserve once, preserve both perspectives and replay without calls', async () => {
  const store = memoryStore();
  const { calls, adapters } = routes();
  const outcomes = await Promise.all([runDurablePilot2(input, adapters, store), runDurablePilot2(input, adapters, store)]);
  const done = outcomes.find(result => result.decision === 'COMMITTED');
  assert.ok(done);
  assert.equal(calls.length, 2);
  assert.equal(store.writes, 1);
  assert.equal(done.attemptedPasses, 2);
  assert.equal(done.analysis.outcome, 'COMPLETE');
  assert.deepEqual(done.completionCandidate, done.completion);
  assert.equal(done.recovery, null);
  assert.equal(done.completion.records.length, 2);
  assert.notEqual(done.completion.records[0].recordId, done.completion.records[1].recordId);
  assert.equal(done.completion.records[0].proposalFingerprint, done.completion.records[1].proposalFingerprint);
  assert.deepEqual(done.completion.observed.map(item => item.model), ['observed-model-a', 'observed-model-b']);
  assert.equal(validateWorkCompletion(done.completion).projectionFingerprint, done.completion.projectionFingerprint);
  const again = await runDurablePilot2({
    ...input, request: { ...input.request, packet: { ...input.request.packet, packetId: 'transient-2' } },
  }, adapters, store);
  assert.equal(again.decision, 'ALREADY_PROCESSED');
  assert.equal(again.attemptedPasses, 0);
  assert.equal(again.analysis, null);
  assert.equal(again.completionCandidate, null);
  assert.deepEqual(again.completion, done.completion);
  assert.equal(calls.length, 2);
  const changed = await runDurablePilot2({ ...input, analysisVersion: 'v2' }, adapters, store);
  assert.equal(changed.decision, 'COMMITTED');
  assert.notEqual(changed.completion.records[0].recordId, done.completion.records[0].recordId);
  assert.equal(calls.length, 4);
});
test('no evidence, invalid input or ambiguous reservation causes no inference', async () => {
  const { calls, adapters } = routes();
  const store = memoryStore({ failReserve: true });
  const empty = { ...input, request: { ...input.request, packet: { ...input.request.packet, evidence: [], acceptedNewEvidence: false } } };
  assert.equal((await runDurablePilot2(empty, adapters, store)).decision, 'INTAKE_UNKNOWN');
  await assert.rejects(runDurablePilot2({ ...input, analysisVersion: ' ' }, adapters, store));
  const unknown = await runDurablePilot2(input, adapters, store);
  assert.equal(unknown.decision, 'STORAGE_UNKNOWN');
  assert.equal(unknown.completion, null);
  assert.equal(unknown.attemptedPasses, 0);
  assert.equal(unknown.recovery, null);
  assert.equal(calls.length, 0);
});
test('partial or unknown-finish analysis cannot complete or automatically retry', async () => {
  for (const options of [{ fail: true }, { finish: null }, { duplicate: true }]) {
    const { calls, adapters } = routes(options);
    const store = memoryStore();
    const result = await runDurablePilot2(input, adapters, store);
    assert.equal(result.decision, 'ANALYSIS_INCOMPLETE');
    assert.equal(result.completion, null);
    assert.equal(store.writes, 0);
    assert.ok(result.analysis);
    assert.equal(result.recovery, null);
    assert.equal(result.completionCandidate, null);
    if (options.fail) assert.equal(result.analysis.outcome, 'PARTIAL');
    assert.equal((await runDurablePilot2(input, adapters, store)).decision, 'RESERVATION_UNRESOLVED');
    assert.equal(calls.length, 2);
  }
});
test('completion is independently read back after a commit error, without re-executing', async () => {
  for (const [options, expected] of [
    [{ loseAck: true }, 'COMMITTED'],
    [{ failCommit: true }, 'STORAGE_UNKNOWN'],
    [{ corrupt: true }, 'STORAGE_UNKNOWN'],
  ]) {
    const { calls, adapters } = routes();
    const store = memoryStore(options);
    const result = await runDurablePilot2(input, adapters, store);
    assert.equal(result.decision, expected);
    assert.equal(result.completion !== null, expected === 'COMMITTED');
    assert.equal(result.analysis.outcome, 'COMPLETE');
    assert.ok(result.completionCandidate);
    assert.equal(calls.length, 2);
    const replay = await runDurablePilot2(input, adapters, store);
    assert.equal(replay.decision, options.loseAck ? 'ALREADY_PROCESSED' : options.corrupt ? 'STORAGE_UNKNOWN' : 'RESERVATION_UNRESOLVED');
    assert.equal(calls.length, 2);
  }
});
test('admitted snapshot cannot drift while reservation is being acquired', async () => {
  const raw = structuredClone(input);
  const { calls, adapters } = routes();
  const store = memoryStore();
  const reserve = store.reserve.bind(store);
  store.reserve = async (...args) => {
    raw.request.packet.evidence[0].text = 'mutated after admission';
    return reserve(...args);
  };
  const result = await runDurablePilot2(raw, adapters, store);
  assert.equal(result.decision, 'COMMITTED');
  assert.deepEqual(calls.map(call => call.text), ['Synthetic observation.', 'Synthetic observation.']);
});

async function completedFixture() {
  const { adapters } = routes();
  const result = await runDurablePilot2(input, adapters, memoryStore());
  assert.equal(result.decision, 'COMMITTED');
  return result.completion;
}

function rehash(value) {
  const { projectionFingerprint: _old, ...payload } = value;
  return { ...payload, projectionFingerprint: 'sha256:' + createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}

test('completion validation rejects wrong perspective, origin, absent perspective and corrupt identity even with a new digest', async () => {
  const valid = await completedFixture();
  for (const [mutate, expected] of [
    [v => { v.observed.reverse(); }, /WORK_PERSPECTIVE_MISMATCH/],
    [v => { v.records[0].origin.requestFingerprint = 'wrong'; }, /WORK_RECORD_ORIGIN_MISMATCH/],
    [v => { v.records[0].origin.perspectiveId = 'wrong'; }, /WORK_RECORD_ORIGIN_MISMATCH/],
    [v => { v.records[0].recordId = 'wrong'; }, /LEDGER_EVENT_ID_MISMATCH/],
  ]) {
    const candidate = structuredClone(valid);
    mutate(candidate);
    assert.throws(() => validateWorkCompletion(rehash(candidate)), expected);
  }
  const missing = structuredClone(valid);
  const record = missing.records[0];
  // Two distinct valid records in one perspective cannot substitute for two perspectives.
  const { createProposalRecord } = await import('../src/dreaming/proposal-ledger.ts');
  missing.records[1] = createProposalRecord({ origin: record.origin, proposal: { ...record.proposal, claim: 'Another claim.' } });
  assert.throws(() => validateWorkCompletion(rehash(missing)), /WORK_PERSPECTIVE_MISSING/);
});

test('a valid completion for another work key is not a valid readback', async () => {
  const existing = await completedFixture();
  const { calls, adapters } = routes();
  const store = memoryStore();
  store.reserve = async () => false;
  store.readCompletion = async () => existing;
  const result = await runDurablePilot2({ ...input, analysisVersion: 'different' }, adapters, store);
  assert.equal(result.decision, 'STORAGE_UNKNOWN');
  assert.equal(result.completion, null);
  assert.equal(calls.length, 0);
});

const connectionString = 'postgresql://fixture_user:fixture_password@fixture.invalid:54329/fixture_db';
const token = '01234567-89ab-4def-8123-456789abcdef';

function clientWith(query) {
  const calls = [];
  let opened = false;
  let closed = false;
  return {
    calls,
    get opened() { return opened; },
    get closed() { return closed; },
    async connect() { opened = true; },
    async query(sql, values = []) {
      assert.equal(opened, true);
      calls.push({ sql, values });
      return { rows: await query(sql, values) };
    },
    async end() { closed = true; },
  };
}
function asStore(client) {
  return createPostgresWorkStore({ connectionString, clientFactory: url => {
    assert.equal(url, connectionString);
    return client;
  } });
}

test('PostgreSQL reservation only succeeds on the exact returned token', async () => {
  const work = (await completedFixture()).checkpoint.workFingerprint;
  for (const [rows, expected] of [
    [[], false],
    [[{ owner_token: token }], true],
    [[{ owner_token: 'another' }], 'invalid'],
    [[{ owner_token: token }, { owner_token: token }], 'invalid'],
  ]) {
    const client = clientWith((sql, values) => {
      assert.match(sql, /INSERT INTO dw_ledger\.work_reservations.*ON CONFLICT.*DO NOTHING RETURNING owner_token/);
      assert.deepEqual(values, [work, token]);
      return rows;
    });
    const store = asStore(client);
    if (expected === 'invalid') await assert.rejects(store.reserve(work, token), /WORK_RESERVATION_RESPONSE_INVALID/);
    else assert.equal(await store.reserve(work, token), expected);
    assert.equal(client.closed, true);
  }
});

test('work store default client uses supplied connection and closes on failure', async t => {
  const captured = [];
  t.mock.method(Client.prototype, 'connect', async function () {
    const { host, port, user, database } = this.connectionParameters;
    captured.push({ host, port, user, database });
    throw Error('fixture connect error');
  });
  t.mock.method(Client.prototype, 'end', async () => { captured.push('closed'); });
  const store = createPostgresWorkStore({ connectionString });
  await assert.rejects(store.readCompletion('unused'), /fixture connect error/);
  assert.deepEqual(captured, [{ host: 'fixture.invalid', port: 54329, user: 'fixture_user', database: 'fixture_db' }, 'closed']);
});

test('PostgreSQL completion uses one transaction with exact records, receipt and ordered membership', async () => {
  const completion = await completedFixture();
  const { checkpoint, observed, records, projectionFingerprint } = completion;
  const client = clientWith(() => []);
  await asStore(client).complete(token, completion);
  assert.equal(client.closed, true);
  assert.deepEqual(client.calls.map(({ sql }) => {
    if (sql.includes('pg_advisory_xact_lock')) return 'LOCK';
    if (sql.includes('UNION ALL')) return 'READ';
    if (sql === 'SELECT 1 FROM dw_ledger.work_pool_journal WHERE work_fingerprint=$1 LIMIT 1') return 'POOL_GUARD';
    if (sql.includes('INSERT INTO dw_ledger.proposal_records')) return 'RECORD';
    if (sql.includes('INSERT INTO dw_ledger.work_completions')) return 'COMPLETION';
    if (sql.includes('INSERT INTO dw_ledger.work_membership')) return 'MEMBER';
    return sql;
  }), ['BEGIN', 'LOCK', 'POOL_GUARD', 'READ', 'RECORD', 'RECORD', 'COMPLETION', 'MEMBER', 'MEMBER', 'COMMIT']);
  assert.deepEqual(client.calls[2].values,[checkpoint.workFingerprint]);
  assert.deepEqual(client.calls[6].values, [checkpoint.workFingerprint, token, checkpoint.requestFingerprint, checkpoint.resultFingerprint, projectionFingerprint, JSON.stringify(observed)]);
  assert.deepEqual(client.calls.slice(7, 9).map(call => call.values), records.map((record, i) => [checkpoint.workFingerprint, i, record.recordId]));
  for (const sql of ['INSERT INTO dw_ledger.proposal_records', 'INSERT INTO dw_ledger.work_completions', 'INSERT INTO dw_ledger.work_membership', 'COMMIT']) {
    const faulty = clientWith(query => {
      if (query.includes(sql)) throw Error('fixture write failed');
      if (query === 'ROLLBACK') throw Error('fixture rollback failed');
      return [];
    });
    await assert.rejects(asStore(faulty).complete(token, completion), /fixture write failed/);
    assert.equal(faulty.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(faulty.closed, true);
  }
  const invalid = clientWith(() => { throw Error('unexpected SQL'); });
  await assert.rejects(asStore(invalid).complete(token, { ...completion, projectionFingerprint: 'invalid' }));
  assert.equal(invalid.opened, false);
});

function completionRows(completion) {
  const { checkpoint, records, observed, projectionFingerprint } = completion;
  return records.map((record, ordinal) => ({
    work_fingerprint: checkpoint.workFingerprint,
    request_fingerprint: checkpoint.requestFingerprint,
    result_fingerprint: checkpoint.resultFingerprint,
    projection_fingerprint: projectionFingerprint,
    observed, ordinal,
    record: {
      schema_name: record.schema, authority: record.authority, record_id: record.recordId,
      proposal_fingerprint: record.proposalFingerprint, packet_id: record.origin.packetId,
      evidence_fingerprint: record.origin.evidenceFingerprint, request_fingerprint: record.origin.requestFingerprint,
      perspective_id: record.origin.perspectiveId, route_id: record.origin.route.id,
      route_provider: record.origin.route.provider, route_model: record.origin.route.model,
      route_model_family: record.origin.route.modelFamily, proposal: record.proposal,
    },
  }));
}

test('PostgreSQL readback reconstructs exact committed projection and rejects missing or reordered members', async () => {
  const completion = await completedFixture();
  const work = completion.checkpoint.workFingerprint;
  const good = completionRows(completion);
  for (const [rows, expected] of [
    [good, completion],
    [[], null],
    [[{ ...good[0], work_fingerprint: 'different' }, good[1]], /WORK_READBACK_IDENTITY_MISMATCH/],
    [[{ ...good[0], ordinal: 1 }, good[1]], /WORK_MEMBERSHIP_INVALID/],
    [[{ ...good[0], record: null }, good[1]], /WORK_MEMBERSHIP_INVALID/],
    [[good[0]], /records/],
    [[{ ...good[0], projection_fingerprint: 'sha256:' + 'b'.repeat(64) }, good[1]], /WORK_PROJECTION_MISMATCH/],
  ]) {
    const client = clientWith((sql, values) => {
      assert.match(sql, /LEFT JOIN dw_ledger\.work_membership/);
      assert.match(sql, /ORDER BY m.ordinal/);
      assert.deepEqual(values, [work]);
      return rows;
    });
    const operation = asStore(client).readCompletion(work);
    if (expected instanceof RegExp) await assert.rejects(operation, expected);
    else assert.deepEqual(await operation, expected);
    assert.equal(client.closed, true);
  }
});

test('retained complete candidate recovers after rollback without reservation or inference', async () => {
  const { recoverDurableCompletion } = await import('../src/dreaming/durable-pilot2.ts');
  const { calls, adapters } = routes();
  const store = memoryStore({ failCommit: true });
  const original = await runDurablePilot2(input, adapters, store);
  assert.equal(original.decision, 'STORAGE_UNKNOWN');
  assert.ok(original.recovery);
  assert.deepEqual(original.recovery.candidate, original.completionCandidate);
  assert.equal(original.recovery.ownerToken, store.reserved.get(original.workFingerprint));
  const noReserve = { ...store, reserve: async () => { throw Error('unexpected reservation'); },
    complete: async (owner, candidate) => {
      assert.equal(owner, store.reserved.get(candidate.checkpoint.workFingerprint));
      store.completions.set(candidate.checkpoint.workFingerprint, structuredClone(candidate));
    },
  };
  const recovered = await recoverDurableCompletion(original.recovery, noReserve);
  assert.equal(recovered.decision, 'COMMITTED');
  assert.deepEqual(recovered.completion, original.completionCandidate);
  const replay = await recoverDurableCompletion(original.recovery, {
    ...noReserve, complete: async () => { throw Error('unexpected write'); },
  });
  assert.equal(replay.decision, 'ALREADY_PROCESSED');
  assert.deepEqual(replay.completion, recovered.completion);
  assert.equal(calls.length, 2);
});

test('recovery does not write if read is unavailable, corrupt or conflicting', async () => {
  const { recoverDurableCompletion } = await import('../src/dreaming/durable-pilot2.ts');
  const { adapters } = routes();
  const original = await runDurablePilot2(input, adapters, memoryStore({ failCommit: true }));
  const other = await completedFixture();
  const changed = structuredClone(other);
  changed.checkpoint.resultFingerprint = 'sha256:' + 'c'.repeat(64);
  const conflict = rehash(changed);
  for (const readCompletion of [
    async () => { throw Error('unavailable'); },
    async () => ({ ...other, projectionFingerprint: 'invalid' }),
    async () => conflict,
  ]) {
    let writes = 0;
    const result = await recoverDurableCompletion(original.recovery, {
      readCompletion, complete: async () => { writes++; },
    });
    assert.equal(result.decision, 'STORAGE_UNKNOWN');
    assert.equal(result.completion, null);
    assert.equal(writes, 0);
  }
  let writes = 0;
  await assert.rejects(recoverDurableCompletion({ ...original.recovery, ownerToken: 'bad' }, {
    complete: async () => { writes++; }, readCompletion: async () => null,
  }));
  assert.equal(writes, 0);
});

test('recovery attempts one write and verifies readback even after a commit error', async () => {
  const { recoverDurableCompletion } = await import('../src/dreaming/durable-pilot2.ts');
  const { adapters } = routes();
  const original = await runDurablePilot2(input, adapters, memoryStore({ failCommit: true }));
  for (const commit of [true, false]) {
    let writes = 0;
    let stored = null;
    const recovered = await recoverDurableCompletion(original.recovery, {
      readCompletion: async () => stored,
      complete: async (owner, candidate) => {
        assert.equal(owner, original.recovery.ownerToken);
        writes++;
        if (commit) stored = structuredClone(candidate);
        throw Error('unknown commit');
      },
    });
    assert.equal(writes, 1);
    assert.equal(recovered.decision, commit ? 'COMMITTED' : 'STORAGE_UNKNOWN');
    assert.deepEqual(recovered.completion, stored);
  }
});

test('projection validation preserves exact perspective identifiers and canonical metadata', async () => {
  const valid = await completedFixture();
  const ids = [valid.checkpoint.workFingerprint + ':pass-1', valid.checkpoint.workFingerprint + ':pass-2'];
  assert.deepEqual(valid.observed.map(item => item.perspectiveId), ids);
  assert.deepEqual(valid.records.map(item => item.origin.perspectiveId), ids);
  for (const field of ['provider', 'model']) {
    const spaced = structuredClone(valid);
    spaced.observed[0][field] = ' ' + valid.observed[0][field] + ' ';
    assert.deepEqual(validateWorkCompletion(spaced), valid);
    spaced.observed[0][field] = ' ';
    assert.throws(() => validateWorkCompletion(spaced), error =>
      error.issues?.some(issue => issue.path.join('.') === 'observed.0.' + field && issue.code === 'too_small'));
  }
  for (const value of ['x' + valid.projectionFingerprint, valid.projectionFingerprint + 'x']) {
    assert.throws(() => validateWorkCompletion({ ...valid, projectionFingerprint: value }), error =>
      error.issues?.some(issue => issue.path.join('.') === 'projectionFingerprint' && issue.code === 'invalid_format'));
  }
  const oneWrong = structuredClone(valid);
  oneWrong.observed[0].perspectiveId = 'wrong';
  assert.throws(() => validateWorkCompletion(rehash(oneWrong)), /WORK_PERSPECTIVE_MISMATCH/);
});

test('pure completion projection rejects mismatched analysis digest and incomplete pass', async () => {
  const { buildWorkCompletion } = await import('../src/dreaming/durable-pilot2.ts');
  const { adapters } = routes();
  const done = await runDurablePilot2(input, adapters, memoryStore());
  const checkpoint = done.completion.checkpoint;
  assert.deepEqual(buildWorkCompletion(checkpoint, done.analysis), done.completion);
  assert.throws(() => buildWorkCompletion({ ...checkpoint, resultFingerprint: 'sha256:' + '0'.repeat(64) }, done.analysis), /WORK_ANALYSIS_MISMATCH/);
  const failed = await runDurablePilot2(input, routes({ fail: true }).adapters, memoryStore());
  const hash = 'sha256:' + createHash('sha256').update(JSON.stringify(failed.analysis)).digest('hex');
  assert.throws(() => buildWorkCompletion({ ...checkpoint, resultFingerprint: hash }, failed.analysis), /WORK_ANALYSIS_INCOMPLETE/);
});

test('shared verified readback distinguishes wrong work identity from absent result', async () => {
  const { readVerifiedCompletion } = await import('../src/dreaming/durable-pilot2.ts');
  const valid = await completedFixture();
  assert.deepEqual(await readVerifiedCompletion({ readCompletion: async () => valid }, valid.checkpoint.workFingerprint), valid);
  await assert.rejects(readVerifiedCompletion({ readCompletion: async () => valid }, 'sha256:' + '0'.repeat(64)), /WORK_READBACK_IDENTITY_MISMATCH/);
  assert.equal(await readVerifiedCompletion({ readCompletion: async () => null }, valid.checkpoint.workFingerprint), null);
});
test('ordinary completion rejects any pooled journal before inserting derived records',async()=>{
  const completion=await completedFixture();
  const client=clientWith((sql,values)=>{
    if(sql==='SELECT 1 FROM dw_ledger.work_pool_journal WHERE work_fingerprint=$1 LIMIT 1'){
      assert.deepEqual(values,[completion.checkpoint.workFingerprint]);return [{'exists':1}];
    }
    return [];
  });
  await assert.rejects(asStore(client).complete(token,completion),{message:'WORK_POOL_CUSTODY_REQUIRED'});
  assert.deepEqual(client.calls.map(c=>c.sql),['BEGIN',"SELECT pg_advisory_xact_lock(hashtext('dw_ledger:v1'))",'SELECT 1 FROM dw_ledger.work_pool_journal WHERE work_fingerprint=$1 LIMIT 1','ROLLBACK']);
  assert.equal(client.closed,true);
});

const {createPostgresPooledCompletionStore}=await import('../src/dreaming/proposal-ledger-postgres.ts');
const {preparePoolJournal,poolJournalAdmission,makePoolJournalEntry}=await import('../src/dreaming/pool-attempt-journal.ts');
const {buildPoolCompletion}=await import('../src/dreaming/pool-completion.ts');
const pooledContext=preparePoolJournal(input);
const journalEntries=[makePoolJournalEntry(null,poolJournalAdmission(pooledContext,4))];
for(const [i,id] of ['a','b'].entries()){
  const attemptId='00000000-0000-4000-8000-00000000000'+(i+1);
  const route={id,provider:'provider-'+id,model:'model-'+id,modelFamily:id};
  journalEntries.push(makePoolJournalEntry(journalEntries.at(-1),{kind:'START',attemptId,slot:i,route}));
  journalEntries.push(makePoolJournalEntry(journalEntries.at(-1),{kind:'VALIDATED',attemptId,receipt:{
    packetId:pooledContext.request.packet.packetId,evidenceFingerprint:pooledContext.evidenceFingerprint,
    requestFingerprint:pooledContext.requestFingerprint,provider:route.provider,model:route.model,finishReason:'stop',
    externalModelCalls:1,toolsUsed:0,memoryUsed:false,canonicalWrites:0,
  },proposalSet:{schema:'theseus.dreaming-worker.proposals.v1',proposals:[proposal]}}));
}
const pooledCandidate=buildPoolCompletion(input,journalEntries);
const pooledRows=(entries=journalEntries,owner=token,completed=false)=>entries.map(entry=>({owner_token:owner,ordinal:entry.ordinal,entry,completion_exists:completed}));
const pooledSQL=`SELECT r.owner_token, j.ordinal, j.entry,
      EXISTS(SELECT 1 FROM dw_ledger.work_completions c WHERE c.work_fingerprint=r.work_fingerprint) AS completion_exists
      FROM dw_ledger.work_reservations r
      LEFT JOIN dw_ledger.work_pool_journal j
        ON j.work_fingerprint=r.work_fingerprint AND j.owner_token=r.owner_token
      WHERE r.work_fingerprint=$1 ORDER BY j.ordinal`;
function scopedPoolStore(client,raw=input){
  return createPostgresPooledCompletionStore({connectionString,clientFactory:url=>{assert.equal(url,connectionString);return client;}},raw);
}
test('pooled completion reads exact immutable input and journal under lock before writing',async()=>{
  const client=clientWith((sql,values)=>{
    if(sql===pooledSQL){assert.deepEqual(values,[pooledContext.workFingerprint]);return pooledRows();}
    return [];
  });
  const raw=structuredClone(input);
  const store=scopedPoolStore(client,raw);
  raw.analysisVersion='different after constructor';
  await store.complete(token,pooledCandidate);
  assert.equal(client.closed,true);
  assert.deepEqual(client.calls.slice(0,3).map(c=>c.sql),['BEGIN',"SELECT pg_advisory_xact_lock(hashtext('dw_ledger:v1'))",pooledSQL]);
  assert.match(client.calls[3].sql,/UNION ALL/);
  const insert=client.calls.find(c=>c.sql.includes('INSERT INTO dw_ledger.work_completions'));
  assert.deepEqual(insert.values,[pooledContext.workFingerprint,token,pooledContext.requestFingerprint,journalEntries.at(-1).entryFingerprint,pooledCandidate.projectionFingerprint,JSON.stringify(pooledCandidate.observed)]);
  assert.equal(client.calls.at(-1).sql,'COMMIT');
});
test('pooled completion rejects missing, legacy, wrong owner, completed or partial journal',async()=>{
  for(const [rows,message] of [
    [[], 'POOL_COMPLETION_CUSTODY'],
    [[{owner_token:token,ordinal:null,entry:null,completion_exists:false}],'POOL_COMPLETION_CUSTODY'],
    [pooledRows(journalEntries,'other-owner'),'POOL_COMPLETION_CUSTODY'],
    [pooledRows(journalEntries,token,true),'POOL_COMPLETION_CUSTODY'],
    [pooledRows(journalEntries.slice(0,2)),'POOL_COMPLETION_INCOMPLETE'],
    [pooledRows(journalEntries.slice(0,3)),'POOL_COMPLETION_INCOMPLETE'],
  ]){
    const client=clientWith((sql,values)=>{
      if(sql===pooledSQL){assert.deepEqual(values,[pooledContext.workFingerprint]);return rows;}
      return [];
    });
    await assert.rejects(scopedPoolStore(client).complete(token,pooledCandidate),{message});
    assert.deepEqual(client.calls.map(c=>c.sql),['BEGIN',"SELECT pg_advisory_xact_lock(hashtext('dw_ledger:v1'))",pooledSQL,'ROLLBACK']);
    assert.equal(client.closed,true);
  }
});
test('pooled completion rejects wrong input or ordinary projection before inserting records',async()=>{
  const ordinary=await completedFixture();
  const cases=[
    [{...input,analysisVersion:'other'},pooledCandidate,'POOL_COMPLETION_WORK_MISMATCH',false],
    [input,ordinary,'POOL_COMPLETION_PROJECTION_MISMATCH',true],
  ];
  for(const [raw,candidate,message,readExpected] of cases){
    const client=clientWith(sql=>sql===pooledSQL?pooledRows():[]);
    await assert.rejects(scopedPoolStore(client,raw).complete(token,candidate),{message});
    assert.deepEqual(client.calls.map(c=>c.sql),['BEGIN',"SELECT pg_advisory_xact_lock(hashtext('dw_ledger:v1'))",...(readExpected?[pooledSQL]:[]),'ROLLBACK']);
    assert.equal(client.closed,true);
  }
});
