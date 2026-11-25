import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
