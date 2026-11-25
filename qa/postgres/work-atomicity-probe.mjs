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
