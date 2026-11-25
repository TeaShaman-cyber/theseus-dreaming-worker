import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { createProposalRecord } from '../../src/dreaming/proposal-ledger.ts';
import { sha256Fingerprint } from '../../src/dreaming/proposal-schema.ts';

const connectionString = process.env.LEDGER_DATABASE_URL;
assert.ok(connectionString, 'LEDGER_DATABASE_URL is required');

const a = new Client({ connectionString });
const b = new Client({ connectionString });
const reader = new Client({ connectionString });
const clients = [a, b, reader];

const fingerprint = value => sha256Fingerprint(JSON.stringify(value));
const reservation = async (client, work, token) => (
  await client.query(
    'INSERT INTO dw_work_probe.reservations (work_fingerprint, owner_token) VALUES ($1, $2) ON CONFLICT (work_fingerprint) DO NOTHING RETURNING owner_token',
    [work, token],
  )
).rows;

function record(work, perspective) {
  return createProposalRecord({
    proposal: {
      type: 'FACT',
      claim: 'Synthetic work atomicity observation.',
      source_refs: [{ source_ref: 'fixture:atomicity', evidence_hash: 'sha256:fixture' }],
    },
    origin: {
      packetId: 'atomicity-fixture',
      evidenceFingerprint: fingerprint('evidence'),
      requestFingerprint: work,
      perspectiveId: perspective,
      route: { id: perspective, provider: 'fixture', model: perspective, modelFamily: perspective },
    },
  });
}

// Fixture-only SQL: exercise the real ledger schema. The eventual application
// must reuse the adapter's transaction-scoped insertion/validation path.
async function insertRecord(client, event) {
  await client.query(
    `INSERT INTO dw_ledger.proposal_records (
      record_id, schema_name, authority, proposal_fingerprint,
      packet_id, evidence_fingerprint, request_fingerprint, perspective_id,
      route_id, route_provider, route_model, route_model_family, proposal_type, proposal
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
    [event.recordId, event.schema, event.authority, event.proposalFingerprint,
      event.origin.packetId, event.origin.evidenceFingerprint, event.origin.requestFingerprint,
      event.origin.perspectiveId, event.origin.route.id, event.origin.route.provider,
      event.origin.route.model, event.origin.route.modelFamily,
      event.proposal.type, JSON.stringify(event.proposal)],
  );
}

async function complete(client, work, token, records, { failAfterFirst = false, loseAck = false } = {}) {
  const result = fingerprint(records.map(item => item.recordId));
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('dw_ledger:v1'))");
    for (const [index, item] of records.entries()) {
      await insertRecord(client, item);
      if (index === 0 && failAfterFirst) throw new Error('INJECTED_BEFORE_COMPLETION');
    }
    await client.query(
      'INSERT INTO dw_work_probe.completions (work_fingerprint, owner_token, result_fingerprint) VALUES ($1,$2,$3)',
      [work, token, result],
    );
    for (const item of records) {
      await client.query('INSERT INTO dw_work_probe.membership (work_fingerprint, record_id) VALUES ($1,$2)', [work, item.recordId]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  // Simulate the caller losing the acknowledgement AFTER successful commit.
  // This is not a network fault-injection claim.
  if (loseAck) throw new Error('SIMULATED_ACK_LOST');
  return result;
}

async function readback(work) {
  const { rows } = await reader.query(
    `SELECT c.owner_token, c.result_fingerprint,
      ARRAY(SELECT record_id FROM dw_work_probe.membership m
        WHERE m.work_fingerprint=c.work_fingerprint ORDER BY record_id) AS record_ids
      FROM dw_work_probe.completions c WHERE c.work_fingerprint=$1`,
    [work],
  );
  return rows[0] ?? null;
}

async function recordCount(records) {
  const { rows } = await reader.query(
    'SELECT count(*)::int AS count FROM dw_ledger.proposal_records WHERE record_id=ANY($1::text[])',
    [records.map(item => item.recordId)],
  );
  return rows[0].count;
}

try {
  await Promise.all(clients.map(client => client.connect()));
  for (const client of clients) {
    const { rows } = await client.query('SELECT current_database() AS db, current_user AS role');
    assert.deepEqual(rows[0], { db: 'dreaming_worker_contract', role: 'dw_runtime_issue23' });
  }
  const work = fingerprint('completed-work');
  const tokens = [randomUUID(), randomUUID()];
  const claims = await Promise.all([reservation(a, work, tokens[0]), reservation(b, work, tokens[1])]);
  assert.equal(claims.flat().length, 1, 'exactly one contender may win');
  const winner = claims[0].length ? a : b;
  const token = claims.flat()[0].owner_token;
  assert.ok(tokens.includes(token));
  const records = [record(work, 'a'), record(work, 'b')];
  assert.notEqual(records[0].recordId, records[1].recordId);
  assert.equal(records[0].proposalFingerprint, records[1].proposalFingerprint);

  // The losing owner cannot commit; all its attempted inserts roll back.
  const wrongToken = tokens.find(value => value !== token);
  await assert.rejects(() => complete(winner, work, wrongToken, records), { code: '23503' });
  assert.equal(await recordCount(records), 0);
  assert.equal(await readback(work), null);

  // Successful commit with lost acknowledgement: independent readback must
  // recover the exact receipt and membership, not re-admit the work.
  await assert.rejects(() => complete(winner, work, token, records, { loseAck: true }), /SIMULATED_ACK_LOST/);
  assert.deepEqual(await readback(work), {
    owner_token: token,
    result_fingerprint: fingerprint(records.map(item => item.recordId)),
    record_ids: records.map(item => item.recordId).sort(),
  });
  assert.equal(await recordCount(records), 2);
  assert.deepEqual(await reservation(reader, work, randomUUID()), []);

  const failedWork = fingerprint('failed-work');
  const failedToken = randomUUID();
  assert.equal((await reservation(a, failedWork, failedToken)).length, 1);
  const failedRecords = [record(failedWork, 'a'), record(failedWork, 'b')];
  await assert.rejects(() => complete(a, failedWork, failedToken, failedRecords, { failAfterFirst: true }), /INJECTED_BEFORE_COMPLETION/);
  assert.equal(await recordCount(failedRecords), 0);
  assert.equal(await readback(failedWork), null);
  assert.deepEqual(await reservation(b, failedWork, randomUUID()), []);
  const state = await reader.query('SELECT owner_token FROM dw_work_probe.reservations WHERE work_fingerprint=$1', [failedWork]);
  assert.deepEqual(state.rows, [{ owner_token: failedToken }]);

  for (const table of ['reservations', 'completions', 'membership']) {
    await assert.rejects(() => reader.query('DELETE FROM dw_work_probe.' + table), { code: '42501' });
    await assert.rejects(() => reader.query('UPDATE dw_work_probe.' + table + ' SET work_fingerprint=work_fingerprint'), { code: '42501' });
  }
  console.log('WORK_ATOMICITY_PROBE_PASS contenders=2 winners=1 rollback=verified wrong_owner=rejected ack_loss=simulated_readback replay=blocked append_only=verified');
} finally {
  await Promise.allSettled(clients.map(client => client.end()));
}

// End-to-end lab integration: real PostgreSQL store, actual Pilot 2 logic,
// only the external inference boundary is synthetic.
const { runDurablePilot2 } = await import('../../src/dreaming/durable-pilot2.ts');
const { createPostgresWorkStore } = await import('../../src/dreaming/proposal-ledger-postgres.ts');
const store = createPostgresWorkStore({ connectionString });
const durableInput = {
  acceptedSourceFingerprint: fingerprint('durable-accepted-source'),
  analysisVersion: 'v1',
  request: {
    scope: 'SYNTHETIC_FIXTURE', task: 'Analyze work atomicity.',
    packet: {
      schema: 'theseus-evidence-packet-v1', packetId: 'durable-work-fixture',
      acceptedNewEvidence: true, coverage: { state: 'PARTIAL', currentness: 'UNKNOWN' },
      evidence: [{ sourceRef: 'fixture:atomicity', evidenceHash: 'sha256:fixture', text: 'Synthetic observation.' }],
    },
  },
};
const calls = [];
function makeRoutes(fail = false) {
  return ['a', 'b'].map(id => ({
    id, provider: 'fixture-configured', model: id, modelFamily: id,
    infer: async () => {
      calls.push(id);
      if (fail && id === 'b') throw Error('synthetic provider failure');
      return {
        provider: 'fixture-observed', model: 'observed-' + id, finishReason: 'stop',
        text: JSON.stringify({ schema: 'theseus.dreaming-worker.proposals.v1', proposals: [{
          type: 'FACT', claim: 'Synthetic observation.',
          source_refs: [{ source_ref: 'fixture:atomicity', evidence_hash: 'sha256:fixture' }],
        }] }),
      };
    },
  }));
}

const pair = await Promise.all([
  runDurablePilot2(durableInput, makeRoutes(), store),
  runDurablePilot2(durableInput, makeRoutes(), store),
]);
const done = pair.find(item => item.decision === 'COMMITTED');
assert.ok(done, JSON.stringify(pair.map(item => item.decision)));
assert.equal(pair.filter(item => item.decision === 'COMMITTED').length, 1);
assert.equal(calls.length, 2);
assert.deepEqual(await store.readCompletion(done.workFingerprint), done.completion);
assert.deepEqual(done.completion.observed.map(item => item.model), ['observed-a', 'observed-b']);
assert.notEqual(done.completion.records[0].recordId, done.completion.records[1].recordId);
assert.equal(done.completion.records[0].proposalFingerprint, done.completion.records[1].proposalFingerprint);
assert.equal((await runDurablePilot2(durableInput, makeRoutes(), store)).decision, 'ALREADY_PROCESSED');
assert.equal(calls.length, 2);

function faultStore(mode) {
  return createPostgresWorkStore({
    connectionString,
    clientFactory: url => {
      const client = new Client({ connectionString: url });
      return {
        connect: () => client.connect(),
        end: () => client.end(),
        query: async (sql, values) => {
          if (mode === 'rollback' && sql.includes('INSERT INTO dw_ledger.work_membership')) {
            throw Error('fixture transaction interruption');
          }
          const result = await client.query(sql, values);
          if (mode === 'ack' && sql === 'COMMIT') throw Error('simulated acknowledgement loss');
          return result;
        },
      };
    },
  });
}
const ackInput = { ...durableInput, analysisVersion: 'ack-v2' };
const ack = await runDurablePilot2(ackInput, makeRoutes(), faultStore('ack'));
assert.equal(ack.decision, 'COMMITTED');
assert.deepEqual(await store.readCompletion(ack.workFingerprint), ack.completion);
assert.notEqual(ack.completion.records[0].recordId, done.completion.records[0].recordId);
const failedInput = { ...durableInput, analysisVersion: 'rollback-v3' };
const failed = await runDurablePilot2(failedInput, makeRoutes(), faultStore('rollback'));
assert.equal(failed.decision, 'STORAGE_UNKNOWN');
assert.equal(await store.readCompletion(failed.workFingerprint), null);
assert.equal((await runDurablePilot2(failedInput, makeRoutes(), store)).decision, 'RESERVATION_UNRESOLVED');
const partialInput = { ...durableInput, analysisVersion: 'partial-v4' };
const partial = await runDurablePilot2(partialInput, makeRoutes(true), store);
assert.equal(partial.decision, 'ANALYSIS_INCOMPLETE');
assert.equal(await store.readCompletion(partial.workFingerprint), null);
assert.equal((await runDurablePilot2(partialInput, makeRoutes(), store)).decision, 'RESERVATION_UNRESOLVED');
assert.equal(calls.length, 8);
const independent = new Client({ connectionString });
try {
  await independent.connect();
  const { rows } = await independent.query(
    'SELECT count(*)::int AS count FROM dw_ledger.proposal_records WHERE perspective_id=ANY($1::text[])',
    [[failed.workFingerprint + ':pass-1', failed.workFingerprint + ':pass-2', partial.workFingerprint + ':pass-1', partial.workFingerprint + ':pass-2']],
  );
  assert.equal(rows[0].count, 0);
  // An append-only client can add an unrelated membership row. The FK alone
  // is insufficient: independent readback must detect changed membership.
  await independent.query(
    'INSERT INTO dw_ledger.work_membership (work_fingerprint, ordinal, record_id) VALUES ($1,$2,$3)',
    [done.workFingerprint, 2, ack.completion.records[0].recordId],
  );
  await assert.rejects(() => store.readCompletion(done.workFingerprint), /WORK_PROJECTION_MISMATCH/);
  assert.equal((await runDurablePilot2(durableInput, makeRoutes(), store)).decision, 'STORAGE_UNKNOWN');
  assert.equal(calls.length, 8);
} finally {
  await independent.end();
}
console.log('DURABLE_PILOT2_INTEGRATION_PASS concurrent=one_execution replay=zero_calls rollback=verified ack_loss=simulated_readback partial=blocked tampered_membership=rejected');


// Explicit recovery with the retained candidate and original reservation.
// No provider call is accepted by the recovery API.
const { recoverDurableCompletion } = await import('../../src/dreaming/durable-pilot2.ts');
assert.ok(failed.recovery);
const denied = await recoverDurableCompletion({ ...failed.recovery, ownerToken: randomUUID() }, store);
assert.equal(denied.decision, 'STORAGE_UNKNOWN');
assert.equal(await store.readCompletion(failed.workFingerprint), null);
const recoveryPair = await Promise.all([
  recoverDurableCompletion(failed.recovery, store),
  recoverDurableCompletion(failed.recovery, store),
]);
for (const outcome of recoveryPair) {
  assert.ok(['COMMITTED', 'ALREADY_PROCESSED'].includes(outcome.decision));
  assert.deepEqual(outcome.completion, failed.completionCandidate);
}
assert.deepEqual(await store.readCompletion(failed.workFingerprint), failed.completionCandidate);
assert.equal((await recoverDurableCompletion(failed.recovery, store)).decision, 'ALREADY_PROCESSED');
assert.equal((await runDurablePilot2(failedInput, makeRoutes(), store)).decision, 'ALREADY_PROCESSED');
assert.equal(partial.recovery, null);
assert.equal(calls.length, 8);
console.log('COMPLETION_ONLY_RECOVERY_PASS wrong_owner=rejected rollback=recovered concurrent_recovery=verified inference_repeated=0');

// Reference for source-level acknowledgement, not production schema or intake.
// Source membership, exact promoted catalog and complete expected work list
// are trusted synthetic fixture inputs. No private source or external model.
const { prepareCheckpointedPilot2 } = await import('../../src/dreaming/checkpoint-pilot2.ts');
const { readVerifiedCompletion } = await import('../../src/dreaming/durable-pilot2.ts');
const batchScope = 'synthetic:source-checkpoint:v1';
const rootReceipt = { scope: batchScope, previous: null, acceptedSet: fingerprint('initial-set'), work: [] };
// Hash the entire receipt, not JSONB object insertion order. This is a
// JS-local fixture encoding, not the Python source wire digest.
const canonicalReceipt = value => Array.isArray(value) ? '[' + value.map(canonicalReceipt).join(',') + ']'
  : value !== null && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalReceipt(value[k])).join(',') + '}'
    : JSON.stringify(value);
const checkpointKey = receipt => sha256Fingerprint(canonicalReceipt(receipt));
const rootKey = checkpointKey(rootReceipt);
const sourceClient = new Client({ connectionString });
const peerClient = new Client({ connectionString });
const sourceReader = new Client({ connectionString });
const sourceClients = [sourceClient, peerClient, sourceReader];

function batchWork(name) {
  const item = { ...durableInput, acceptedSourceFingerprint: fingerprint('scope:' + name) };
  const prepared = prepareCheckpointedPilot2({ ...item, checkpoint: { status: 'AVAILABLE', committed: null } });
  return { item, key: prepared.workFingerprint };
}
const firstWork = batchWork('first'), secondWork = batchWork('second');
const batch = {
  scope: batchScope, previous: rootKey, acceptedSet: fingerprint('refreshed-set'),
  work: [firstWork.key, secondWork.key].sort(),
};
const batchKey = checkpointKey(batch);
async function readSuccessor(previous, scope = batchScope) {
  const { rows } = await sourceReader.query(
    'SELECT checkpoint_fingerprint, receipt FROM dw_work_probe.source_checkpoints WHERE scope=$1 AND previous_checkpoint=$2',
    [scope, previous],
  );
  if (rows.length === 0) return null;
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.receipt.scope, scope);
  assert.equal(row.receipt.previous, previous);
  assert.equal(row.checkpoint_fingerprint, checkpointKey(row.receipt));
  return row;
}
async function appendCheckpoint(client, candidate, { loseAck = false, expectedScope = batchScope } = {}) {
  // Reference only: the caller supplies the complete expected set. Empty
  // batches require an independent non-work proof and are not admitted here.
  assert.equal(candidate.scope, expectedScope);
  assert.ok(candidate.work.length > 0);
  assert.deepEqual(candidate.work, [...new Set(candidate.work)].sort());
  const key = checkpointKey(candidate);
  const existing = await readSuccessor(candidate.previous, expectedScope);
  if (existing) {
    return existing.checkpoint_fingerprint === key ? 'ALREADY_ACKNOWLEDGED' : 'CONFLICT';
  }
  for (const work of candidate.work) {
    if (!await readVerifiedCompletion(store, work)) return 'PENDING';
  }
  await client.query(
    'INSERT INTO dw_work_probe.source_checkpoints (scope,checkpoint_fingerprint,previous_checkpoint,receipt) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING',
    [candidate.scope, key, candidate.previous, JSON.stringify(candidate)],
  );
  if (loseAck) throw Error('SIMULATED_BATCH_ACK_LOST');
  const persisted = await readSuccessor(candidate.previous, expectedScope);
  return persisted?.checkpoint_fingerprint === key ? 'ACKNOWLEDGED' : 'CONFLICT';
}
try {
  await Promise.all(sourceClients.map(client => client.connect()));
  await sourceClient.query(
    'INSERT INTO dw_work_probe.source_checkpoints (scope,checkpoint_fingerprint,previous_checkpoint,receipt) VALUES ($1,$2,NULL,$3::jsonb)',
    [batchScope, rootKey, JSON.stringify(rootReceipt)],
  );
  const beforeCalls = calls.length;
  assert.equal(await appendCheckpoint(sourceClient, batch), 'PENDING');
  assert.equal(await readSuccessor(rootKey), null);
  assert.equal((await runDurablePilot2(firstWork.item, makeRoutes(), store)).decision, 'COMMITTED');
  assert.equal(await appendCheckpoint(sourceClient, batch), 'PENDING');
  assert.equal(await readSuccessor(rootKey), null);

  // Restart: exact work identity is retained; first completion skips inference.
  assert.equal((await runDurablePilot2(firstWork.item, makeRoutes(), store)).decision, 'ALREADY_PROCESSED');
  assert.equal(calls.length, beforeCalls + 2);
  assert.equal((await runDurablePilot2(secondWork.item, makeRoutes(), store)).decision, 'COMMITTED');
  assert.equal(calls.length, beforeCalls + 4);

  // Two competing successor receipts from the same source checkpoint: the
  // database, not a read-then-write race, enforces one winner.
  const competing = { ...batch, acceptedSet: fingerprint('different-refreshed-set') };
  const lost = appendCheckpoint(sourceClient, batch, { loseAck: true });
  const conflict = appendCheckpoint(peerClient, competing);
  const outcomes = await Promise.allSettled([lost, conflict]);
  assert.ok(outcomes.every(outcome => outcome.status === 'fulfilled'
    || outcome.reason.message === 'SIMULATED_BATCH_ACK_LOST'));
  const persisted = await readSuccessor(rootKey);
  const winner = persisted.checkpoint_fingerprint === batchKey ? batch : competing;
  const loser = winner === batch ? competing : batch;
  assert.equal(persisted.checkpoint_fingerprint, checkpointKey(winner));
  assert.deepEqual(persisted.receipt, winner);
  assert.equal(await appendCheckpoint(sourceClient, winner), 'ALREADY_ACKNOWLEDGED');
  assert.equal(await appendCheckpoint(peerClient, loser), 'CONFLICT');
  const counts = await sourceReader.query(
    'SELECT count(*)::int AS count FROM dw_work_probe.source_checkpoints WHERE scope=$1', [batchScope],
  );
  assert.equal(counts.rows[0].count, 2);
  assert.equal(await readSuccessor(rootKey, 'different-scope'), null);
  await assert.rejects(() => sourceClient.query(
    'UPDATE dw_work_probe.source_checkpoints SET receipt=receipt WHERE scope=$1', [batchScope],
  ), { code: '42501' });
  await assert.rejects(() => sourceClient.query(
    'DELETE FROM dw_work_probe.source_checkpoints WHERE scope=$1', [batchScope],
  ), { code: '42501' });
  assert.equal(calls.length, beforeCalls + 4);

  // Lost acknowledgement on a single deterministic successor: new connection
  // reads exact stored receipt and repeats zero inference.
  const next = { ...winner, previous: checkpointKey(winner), acceptedSet: fingerprint('next-set') };
  await assert.rejects(() => appendCheckpoint(sourceClient, next, { loseAck: true }), /SIMULATED_BATCH_ACK_LOST/);
  assert.deepEqual((await readSuccessor(next.previous)).receipt, next);
  assert.equal(await appendCheckpoint(peerClient, next), 'ALREADY_ACKNOWLEDGED');
  assert.equal(calls.length, beforeCalls + 4);
  // The existing test deliberately corrupted done's completion membership.
  // A batch cannot use this corrupt record as evidence of completion.
  const bad = { ...next, previous: checkpointKey(next), work: [done.workFingerprint] };
  await assert.rejects(() => appendCheckpoint(sourceClient, bad), /WORK_PROJECTION_MISMATCH/);
  assert.equal(await readSuccessor(bad.previous), null);
  await assert.rejects(() => appendCheckpoint(sourceClient, { ...bad, work: [] }));
  assert.equal(await readSuccessor(bad.previous), null);

  // Even direct competing insert cannot create a second successor.
  await assert.rejects(() => sourceClient.query(
    'INSERT INTO dw_work_probe.source_checkpoints (scope,checkpoint_fingerprint,previous_checkpoint,receipt) VALUES ($1,$2,$3,$4::jsonb)',
    [loser.scope, checkpointKey(loser), loser.previous, JSON.stringify(loser)],
  ), { code: '23505' });
  const orphan = { ...next, previous: fingerprint('missing-parent') };
  await assert.rejects(() => appendCheckpoint(sourceClient, orphan), { code: '23503' });
  assert.equal(await readSuccessor(orphan.previous), null);
  assert.equal(calls.length, beforeCalls + 4);
  // Integrate the actual verified-session adapter, not manually invented work
  // fingerprints. Fixture recorded from actual SS PG16 router/shard reads.
  const { prepareVerifiedSessionWork } = await import('../../src/dreaming/verified-session-work.ts');
  const { decodeSourceHandoff } = await import('../../src/dreaming/source-handoff.ts');
  const fixture = JSON.parse(readFileSync(new URL('../../test/fixtures/source-reader.json', import.meta.url), 'utf8'));
  const handoff = decodeSourceHandoff(fixture.candidate, fixture.expected);
  const scope = handoff.scope + ':batch-reference-v1';
  const task = 'Analyze synthetic selected session.';
  const analysisVersion = 'batch-reference-v1';
  const sourceRoot = { scope, previous: null, acceptedSet: handoff.previous_membership.accepted_set_sha256,
    work: [], membership: handoff.previous_membership, task, analysisVersion };
  const sourceRootKey = checkpointKey(sourceRoot);
  await sourceClient.query(
    'INSERT INTO dw_work_probe.source_checkpoints (scope,checkpoint_fingerprint,previous_checkpoint,receipt) VALUES ($1,$2,NULL,$3::jsonb)',
    [scope, sourceRootKey, JSON.stringify(sourceRoot)],
  );
  const prepared = fixture.entries.map(entry => {
    const result = prepareVerifiedSessionWork({
      candidate: fixture.candidate, expected: fixture.expected, index: entry.index,
      sessionId: entry.session_id, pages: entry.pages, task, analysisVersion,
      bounds: { maxPages: 20, maxChars: 1000, maxMessages: 50 },
    });
    assert.equal(result.status, 'PREPARED');
    const { workFingerprint } = prepareCheckpointedPilot2({
      ...result.input, checkpoint: { status: 'AVAILABLE', committed: null },
    });
    return { ...result, workFingerprint };
  });
  // Fixture-only composition. No disposition for empty or removed sessions
  // is invented. Exhaustive selected-set binding precedes any acknowledgement.
  async function receiptFor(entries) {
    assert.deepEqual(handoff.removed, []);
    assert.ok(handoff.selected.length > 0);
    assert.deepEqual(entries.map(e => e.provenance.session.session_id).sort(),
      handoff.selected.map(e => e.session_id).sort());
    const lineage = [];
    for (const entry of entries) {
      assert.equal(entry.provenance.candidate_sha256, handoff.candidate_sha256);
      const completion = await readVerifiedCompletion(store, entry.workFingerprint);
      if (!completion) return null;
      const refs = entry.input.request.packet.evidence.map(e => ({
        source_ref: e.sourceRef, evidence_hash: e.evidenceHash,
      }));
      for (const record of completion.records) {
        assert.deepEqual(record.proposal.source_refs, refs);
      }
      lineage.push({ workFingerprint: entry.workFingerprint,
        completionFingerprint: completion.projectionFingerprint, provenance: entry.provenance });
    }
    return { scope, previous: sourceRootKey, acceptedSet: handoff.current_membership.accepted_set_sha256,
      work: lineage.map(e => e.workFingerprint).sort(), task, analysisVersion, handoff,
      lineage: lineage.sort((a,b) => a.workFingerprint.localeCompare(b.workFingerprint)) };
  }
  let sourceCalls = 0;
  const sourceRoutes = ['a', 'b'].map(id => ({
    id, provider: 'synthetic', model: id, modelFamily: id,
    infer: async request => {
      sourceCalls++;
      return { provider: 'synthetic', model: id, finishReason: 'stop',
        text: JSON.stringify({ schema: 'theseus.dreaming-worker.proposals.v1', proposals: [{
          type: 'FACT', claim: 'Synthetic selected-session observation.',
          source_refs: request.packet.evidence.map(e => ({
            source_ref: e.sourceRef, evidence_hash: e.evidenceHash,
          })),
        }] }) };
    },
  }));
  assert.equal(prepared.length, 2);
  await assert.rejects(() => receiptFor(prepared.slice(0,1)));
  await assert.rejects(() => receiptFor([prepared[0], prepared[0]]));
  assert.equal(await receiptFor(prepared), null);
  assert.equal((await runDurablePilot2(prepared[0].input, sourceRoutes, store)).decision, 'COMMITTED');
  assert.equal(await receiptFor(prepared), null);
  assert.equal(await readSuccessor(sourceRootKey, scope), null);
  // Fresh store instance represents a restarted executor.
  const restarted = createPostgresWorkStore({ connectionString });
  assert.equal((await runDurablePilot2(prepared[0].input, sourceRoutes, restarted)).decision, 'ALREADY_PROCESSED');
  assert.equal(sourceCalls, 2);
  assert.equal((await runDurablePilot2(prepared[1].input, sourceRoutes, restarted)).decision, 'COMMITTED');
  const integratedReceipt = await receiptFor(prepared);
  assert.ok(integratedReceipt);
  const integratedKey = checkpointKey(integratedReceipt);
  // A lineage change must affect the entire receipt fingerprint.
  const tampered = structuredClone(integratedReceipt);
  tampered.lineage[0].provenance.session.messages[0].sources[0].source_object_sha256 = '0'.repeat(64);
  assert.notEqual(checkpointKey(tampered), integratedKey);
  await assert.rejects(() => appendCheckpoint(sourceClient, integratedReceipt, { expectedScope: scope, loseAck: true }),
    /SIMULATED_BATCH_ACK_LOST/);
  const storedReceipt = await readSuccessor(sourceRootKey, scope);
  assert.equal(storedReceipt.checkpoint_fingerprint, integratedKey);
  assert.deepEqual(storedReceipt.receipt, integratedReceipt);
  assert.deepEqual(storedReceipt.receipt.handoff.current_membership, handoff.current_membership);
  assert.ok(storedReceipt.receipt.lineage.every(e => e.provenance.session.messages.every(m =>
    !Object.hasOwn(m, 'text') && m.sources.length > 0)));
  assert.equal(await appendCheckpoint(peerClient, integratedReceipt, { expectedScope: scope }), 'ALREADY_ACKNOWLEDGED');
  for (const entry of prepared) {
    assert.equal((await runDurablePilot2(entry.input, sourceRoutes, restarted)).decision, 'ALREADY_PROCESSED');
  }
  assert.equal(sourceCalls, 4);
  const { prepareSourceBatchReceipt } = await import('../../src/dreaming/source-batch-receipt.ts');
  const runtimeCandidate = await prepareSourceBatchReceipt({
    candidate: fixture.candidate, expected: fixture.expected, previousCheckpoint: sourceRootKey,
    task, analysisVersion, maxSessions: 2, bounds: { maxPages: 20, maxChars: 1000, maxMessages: 50 },
    entries: fixture.entries.map(e => ({ sessionId: e.session_id, index: e.index, pages: e.pages })),
  }, restarted);
  assert.equal(runtimeCandidate.status, 'RECEIPT_CANDIDATE');
  assert.deepEqual(runtimeCandidate.receipt.handoff, handoff);
  assert.deepEqual(runtimeCandidate.receipt.work.map(e => e.workFingerprint).sort(), integratedReceipt.work);
  assert.equal(runtimeCandidate.receipt.checkpointAdvanced, false);
  assert.equal(sourceCalls, 4);
  const { createPostgresSourceBatchStore } = await import('../../src/dreaming/source-batch-postgres.ts');
  const sourceStore = createPostgresSourceBatchStore({ connectionString });
  const args = {
    candidate: fixture.candidate, expected: fixture.expected, previousCheckpoint: sourceRootKey,
    task, analysisVersion, maxSessions: 2, bounds: { maxPages: 20, maxChars: 1000, maxMessages: 50 },
    entries: fixture.entries.map(e => ({ sessionId: e.session_id, index: e.index, pages: e.pages })),
  };
  assert.equal((await sourceStore.acknowledge(args)).status, 'CONFLICT');
  const root = await sourceStore.initialize(args);
  assert.equal(root.status, 'ACKNOWLEDGED');
  const exact = { ...args, previousCheckpoint: root.receipt.receiptFingerprint };
  assert.equal((await sourceStore.initialize(args)).status, 'ALREADY_ACKNOWLEDGED');
  const pending = { ...args, analysisVersion: 'unprocessed-v1' };
  const pendingRoot = await sourceStore.initialize(pending);
  assert.equal(pendingRoot.status, 'ACKNOWLEDGED');
  assert.equal((await sourceStore.acknowledge({ ...pending, previousCheckpoint: pendingRoot.receipt.receiptFingerprint })).status, 'PENDING');
  const wrongParent = { ...exact, previousCheckpoint: pendingRoot.receipt.receiptFingerprint };
  assert.equal((await sourceStore.acknowledge(wrongParent)).status, 'CONFLICT');
  const badMembership = structuredClone(exact);
  badMembership.candidate.previous_membership = badMembership.candidate.current_membership;
  badMembership.expected.previousSnapshotSha256 = badMembership.candidate.previous_membership.snapshot_sha256;
  delete badMembership.candidate.candidate_sha256;
  badMembership.candidate.candidate_sha256 = sha256Fingerprint(canonicalReceipt(badMembership.candidate)).slice(7);
  assert.equal((await sourceStore.acknowledge(badMembership)).status, 'CONFLICT');
  // Alternate witness for the same work is not the same successor receipt.
  const alternate = structuredClone(exact);
  alternate.entries[0].index.sessions[0].messages[0].sources.push({
    ...alternate.entries[0].index.sessions[0].messages[0].sources[0], member_name: 'synthetic-alternate-witness',
  });
  const lostAckStore = createPostgresSourceBatchStore({ connectionString, clientFactory: url => {
    const client = new Client({ connectionString: url });
    return {
      connect: () => client.connect(), end: () => client.end(),
      query: async (sql, values) => {
        const result = await client.query(sql, values);
        if (sql === 'COMMIT') throw Error('simulated commit acknowledgement loss');
        return result;
      },
    };
  } });
  const race = await Promise.all([lostAckStore.acknowledge(exact), sourceStore.acknowledge(alternate)]);
  assert.equal(race.filter(r => r.status === 'ACKNOWLEDGED').length, 1);
  assert.equal(race.filter(r => r.status === 'CONFLICT').length, 1);
  const winnerArgs = race[0].status === 'ACKNOWLEDGED' ? exact : alternate;
  const winning = race.find(r => r.status === 'ACKNOWLEDGED');
  assert.deepEqual(await sourceStore.readTip(args), winning.receipt);
  assert.equal((await sourceStore.acknowledge(winnerArgs)).status, 'ALREADY_ACKNOWLEDGED');
  assert.equal((await sourceStore.acknowledge({ ...winnerArgs, previousCheckpoint: winning.receipt.receiptFingerprint })).status, 'CONFLICT');
  assert.equal(sourceCalls, 4);
  const count = await sourceReader.query('SELECT count(*)::int AS count FROM dw_ledger.source_checkpoints');
  assert.equal(count.rows[0].count, 3);
  await assert.rejects(() => sourceClient.query('UPDATE dw_ledger.source_checkpoints SET receipt=receipt'), { code: '42501' });
  await assert.rejects(() => sourceClient.query('DELETE FROM dw_ledger.source_checkpoints'), { code: '42501' });
  console.log('SOURCE_BATCH_STORE_PG_PASS root=explicit partial=blocked fork=blocked replay=verified lost_ack=readback append_only=verified');
  console.log('SOURCE_BATCH_RECEIPT_PG_PASS exact_selected=2 real_completion_readback=true writes=0 extra_inference=0');
  console.log('VERIFIED_SOURCE_BATCH_PG_PASS selected=2 pages=12 partial=blocked missing=blocked duplicate=blocked lineage=readback ack_loss=resolved replay_extra_calls=0 external_calls=0');
  console.log('SOURCE_CHECKPOINT_REFERENCE_PASS partial=blocked restart=zero_duplicate_calls competing_successors=one ack_loss=readback scope=isolated append_only=verified corrupt_completion=rejected orphan=rejected empty=blocked');
} finally {
  await Promise.allSettled(sourceClients.map(client => client.end()));
}
