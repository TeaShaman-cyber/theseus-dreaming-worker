import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPostgresSourceBatchStore } from '../../src/dreaming/source-batch-postgres.ts';
import { createPostgresPoolJournalStore, createPostgresWorkStore } from '../../src/dreaming/proposal-ledger-postgres.ts';
import { prepareSourceBatchExecution } from '../../src/dreaming/source-batch-receipt.ts';
import { runPooledSourceCycle } from '../../src/dreaming/source-cycle.ts';

const connectionString = process.env.LEDGER_DATABASE_URL;
assert.ok(connectionString);
const options = { connectionString };
const fixture = JSON.parse(readFileSync(new URL('../../test/fixtures/source-reader.json', import.meta.url), 'utf8'));
const limits = { maxRequests: 20, maxPageBytes: 8000, maxTotalBytes: 100000, timeoutMs: 1000, pageMessages: 2, pageChars: 3 };
const emit = value => writeSync(1, JSON.stringify(value) + '\n');

if (process.argv[2] === 'child') {
  const { input, mode, budget, rotation } = JSON.parse(readFileSync(0, 'utf8'));
  let calls = 0, pages = 0;
  const store = createPostgresSourceBatchStore(options);
  const routes = ['a', 'b'].map(id => ({
    id, provider: 'process-provider-' + id, model: 'process-model-' + id, modelFamily: id,
    admission: 'FREE_RESEARCH', qualifiedTasks: ['analysis'], catalog: 'PRESENT', catalogValidUntilMs: 100000,
    async infer(request) {
      calls++;
      emit({ dispatch: id, pid: process.pid });
      if (mode === 'crash-inference' && calls === 2) process.exit(73);
      return { provider: 'process-provider-' + id, model: 'process-model-' + id, finishReason: 'stop',
        text: JSON.stringify({ schema: 'theseus.dreaming-worker.proposals.v1', proposals: [{
          type: 'HYPOTHESIS', claim: 'Synthetic hypothesis from ' + id,
          why_plausible: 'Synthetic evidence.', falsifier: 'A conflicting synthetic observation.',
          required_evidence: ['Independent observation.'], competing_explanations: ['Synthetic alternative.'],
          uncertainty: 'LOW',
          source_refs: request.packet.evidence.map(e => ({ source_ref: e.sourceRef, evidence_hash: e.evidenceHash })),
        }] }) };
    },
  }));
  const result = await runPooledSourceCycle(input, {
    limits, transport: async request => {
      const entry = fixture.entries.find(e => e.session_id === request.session_id);
      assert.equal(request.generation_id, entry.index.generation_id);
      assert.equal(request.shard_id, entry.index.shard_id);
      const i = request.cursor ? entry.pages.findIndex(p => p.next_cursor === request.cursor) + 1 : 0;
      assert.ok(i >= 0 && i < entry.pages.length);
      pages++;
      return Response.json(entry.pages[i]);
    },
    store: mode === 'crash-ack' ? { ...store, acknowledge: async () => { emit({ beforeAck: true }); process.exit(74); } } : store,
    policy: { routes, taskClass: 'analysis', maxAttempts: 4, maxInvocations: budget, rotation, cooldowns: [], clock: () => 100 },
  });
  emit({ result, calls, pages, pid: process.pid });
} else {
  const store = createPostgresSourceBatchStore(options);
  const journal = createPostgresPoolJournalStore(options);
  const completions = createPostgresWorkStore(options);
  async function start(analysisVersion) {
    const input = {
      candidate: fixture.candidate, expected: fixture.expected, analysisVersion,
      task: 'Synthetic process loss witness.', maxSessions: 2,
      bounds: { maxPages: 20, maxChars: 1000, maxMessages: 50 },
      indexes: fixture.entries.map(e => ({ sessionId: e.session_id, index: e.index })),
    };
    const root = await store.initialize(input);
    assert.equal(root.status, 'ACKNOWLEDGED');
    input.previousCheckpoint = root.receipt.receiptFingerprint;
    const { indexes: _indexes, ...base } = input;
    const { prepared } = prepareSourceBatchExecution({
      ...base, entries: fixture.entries.map(e => ({ sessionId: e.session_id, index: e.index, pages: e.pages })),
    });
    return { input, root: root.receipt, prepared };
  }
  function run(input, mode, budget, rotation = 0, expectedExit = 0) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'child'], {
      input: JSON.stringify({ input, mode, budget, rotation }), encoding: 'utf8', timeout: 45000,
    });
    assert.ifError(child.error);
    assert.equal(child.status, expectedExit, child.stderr + child.stdout);
    const records = child.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    return { records, dispatch: records.filter(x => x.dispatch).map(x => x.dispatch), final: records.find(x => x.result) };
  }
  const positive = await start('process-loss-positive-v1');
  const first = run(positive.input, 'normal', 2);
  assert.equal(first.final.result.status, 'BUDGET_EXHAUSTED');
  assert.equal(first.final.result.attemptedPasses, 2);
  assert.equal(first.final.pages, 12);
  assert.equal(first.dispatch.length, 2);
  const frozen = (await journal.read(positive.prepared[0].input)).state;
  assert.equal(frozen.validated.length, 2);
  assert.deepEqual(await store.readTip(positive.input), positive.root);
  const firstCompletion = await completions.readCompletion(positive.prepared[0].workFingerprint);
  assert.ok(firstCompletion);
  assert.equal(await completions.readCompletion(positive.prepared[1].workFingerprint), null);

  const interrupted = run(positive.input, 'crash-ack', 2, first.final.result.run.nextRotation, 74);
  assert.equal(interrupted.dispatch.length, 2);
  assert.ok(interrupted.records.some(x => x.beforeAck));
  assert.deepEqual((await journal.read(positive.prepared[0].input)).state, frozen);
  assert.deepEqual(await completions.readCompletion(positive.prepared[0].workFingerprint), firstCompletion);
  const complete = await Promise.all(positive.prepared.map(e => completions.readCompletion(e.workFingerprint)));
  for (const c of complete) {
    assert.ok(c);
    assert.equal(c.records.length, 2);
    assert.equal(new Set(c.records.map(r => r.origin.route.modelFamily)).size, 2);
    assert.ok(c.records.every(r => r.authority === 'DERIVED_ONLY' && r.proposal.type === 'HYPOTHESIS'));
  }
  assert.deepEqual(await store.readTip(positive.input), positive.root);
  const recovered = run(positive.input, 'normal', 0);
  assert.equal(recovered.final.result.status, 'ACKNOWLEDGED');
  assert.equal(recovered.final.result.attemptedPasses, 0);
  assert.deepEqual(recovered.dispatch, []);
  const receipt = recovered.final.result.run.receipt;
  assert.deepEqual(await store.readTip(positive.input), receipt);
  assert.equal(receipt.work.length, 2);
  const replay = run(positive.input, 'normal', 0);
  assert.equal(replay.final.result.status, 'ALREADY_ACKNOWLEDGED');
  assert.deepEqual(replay.final.result.run.receipt, receipt);
  assert.deepEqual(replay.dispatch, []);

  const negative = await start('process-loss-unknown-v1');
  const crashed = run(negative.input, 'crash-inference', 4, 0, 73);
  assert.equal(crashed.dispatch.length, 2);
  const state = (await journal.read(negative.prepared[0].input)).state;
  assert.equal(state.validated.length, 1);
  assert.ok(state.pending);
  assert.equal(state.unresolved, true);
  assert.equal(await completions.readCompletion(negative.prepared[0].workFingerprint), null);
  assert.deepEqual(await store.readTip(negative.input), negative.root);
  const blocked = run(negative.input, 'normal', 4);
  assert.equal(blocked.final.result.status, 'WORK_UNRESOLVED');
  assert.equal(blocked.final.result.run.work[0].decision, 'BLOCKED_UNKNOWN');
  assert.deepEqual(blocked.dispatch, []);
  assert.equal(blocked.final.result.attemptedPasses, 0);
  assert.deepEqual((await journal.read(negative.prepared[0].input)).state, state);
  assert.equal((await journal.read(negative.prepared[1].input)).status, 'ABSENT');
  assert.deepEqual(await store.readTip(negative.input), negative.root);
  console.log('SOURCE_PROCESS_LOSS_PG_PASS completed=2 synthetic_calls=4 recovery_calls=0 replay_calls=0 pending_unknown_blocked=true external_calls=0');
}
