import assert from 'node:assert/strict';
import test from 'node:test';

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

function fakeClient({ rows = [], failOnInsert = null } = {}) {
  const calls = [];
  let connected = false;
  let ended = false;
  return {
    calls,
    get connected() { return connected; },
    get ended() { return ended; },
    async connect() { connected = true; },
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
