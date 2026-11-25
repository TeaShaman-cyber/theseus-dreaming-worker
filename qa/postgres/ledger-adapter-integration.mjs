import assert from 'node:assert/strict';
import { Client } from 'pg';

import {
  createProposalRecord,
  createSupersessionEvent,
  materializeLedger,
} from '../../src/dreaming/proposal-ledger.ts';
import { createPostgresProposalLedger } from '../../src/dreaming/proposal-ledger-postgres.ts';

const connectionString = process.env.LEDGER_DATABASE_URL;
assert.ok(connectionString, 'LEDGER_DATABASE_URL is required');

const routeA = { id: 'pg-route-a', provider: 'fixture', model: 'fixture-a', modelFamily: 'fixture' };
const routeB = { id: 'pg-route-b', provider: 'fixture', model: 'fixture-b', modelFamily: 'fixture' };

const proposal = claim => ({
  type: 'HYPOTHESIS',
  claim,
  why_plausible: 'PostgreSQL integration fixture.',
  source_refs: [{ source_ref: 'fixture:pg', evidence_hash: 'sha256:e1' }],
  falsifier: 'A bounded counterexample disproves the fixture candidate.',
  required_evidence: ['A bounded counterexample or supporting trace.'],
  competing_explanations: ['A competing fixture mechanism.'],
  uncertainty: 'LOW',
});

const origin = (perspectiveId, route) => ({
  packetId: 'packet-pg',
  evidenceFingerprint: 'sha256:evidence-pg',
  requestFingerprint: 'sha256:request-pg',
  perspectiveId,
  route,
});

const ledger = createPostgresProposalLedger({ connectionString });
const a = createProposalRecord({ proposal: proposal('PostgreSQL fixture A'), origin: origin('a', routeA) });
const b = createProposalRecord({ proposal: proposal('PostgreSQL fixture B'), origin: origin('b', routeB) });

await Promise.all([ledger.appendEvent(a), ledger.appendEvent(b)]);

let persisted = await ledger.readEvents();
assert.equal(persisted.length, 2);
assert.deepEqual(new Set(persisted.map(event => event.recordId)), new Set([a.recordId, b.recordId]));

const supersede = createSupersessionEvent({
  supersededRecordId: a.recordId,
  replacementRecordId: b.recordId,
  reason: 'B supersedes A in the integration fixture.',
});
await ledger.appendEvent(supersede);

persisted = await ledger.readEvents();
assert.equal(persisted.length, 3);
assert.equal(persisted[2].eventType, 'SUPERSEDE');
const view = materializeLedger(persisted);
assert.equal(view.records.find(item => item.record.recordId === a.recordId).state, 'SUPERSEDED');
assert.equal(view.records.find(item => item.record.recordId === b.recordId).state, 'ACTIVE');

await assert.rejects(() => ledger.appendEvent(a), /LEDGER_DUPLICATE_EVENT/);

const cycle = createSupersessionEvent({
  supersededRecordId: b.recordId,
  replacementRecordId: a.recordId,
  reason: 'Invalid reverse edge for cycle probe.',
});
await assert.rejects(() => ledger.appendEvent(cycle), /LEDGER_SUPERSESSION_CYCLE/);

const client = new Client({ connectionString });
await client.connect();
try {
  await assert.rejects(
    () => client.query("UPDATE dw_ledger.proposal_records SET authority = authority"),
    /permission denied/i,
  );
  const counts = await client.query(`
    SELECT
      (SELECT count(*)::int FROM dw_ledger.proposal_records) AS proposals,
      (SELECT count(*)::int FROM dw_ledger.supersession_events) AS supersessions
  `);
  assert.deepEqual(counts.rows[0], { proposals: 2, supersessions: 1 });
} finally {
  await client.end();
}

console.log('LEDGER_POSTGRES_INTEGRATION_PASS');
