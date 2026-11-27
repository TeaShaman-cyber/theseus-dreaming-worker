#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { decodeSourceHandoff } from '../../src/dreaming/source-handoff.ts';
import { prepareSourceBatchExecution, sourceReceiptFingerprint } from '../../src/dreaming/source-batch-receipt.ts';
import { readVerifiedCompletion } from '../../src/dreaming/durable-pilot2.ts';
import { buildPoolCompletion } from '../../src/dreaming/pool-completion.ts';
import { createPostgresSourceBatchStore } from '../../src/dreaming/source-batch-postgres.ts';
import { createPostgresPoolJournalStore, createPostgresWorkStore } from '../../src/dreaming/proposal-ledger-postgres.ts';

// Independent observations, not an atomic snapshot or an authorization gate.
export async function inspectSourceCycle(raw, readers) {
  const input = structuredClone(raw);
  if (!decodeSourceHandoff(input.candidate, input.expected).scope.startsWith('synthetic:')) {
    throw Error('SOURCE_INSPECTION_SCOPE');
  }
  const { plan, prepared } = prepareSourceBatchExecution(input);
  const report = {
    schema: 'theseus.dreaming-worker.source-inspection.v1',
    snapshot: 'INDEPENDENT_READS',
    planFingerprint: plan.planFingerprint,
    previousCheckpoint: input.previousCheckpoint,
    resumeAuthorized: false,
    sourceCustodyVerified: false,
    tip: { status: 'UNKNOWN' },
    plan: { status: 'UNKNOWN' },
    work: [],
  };
  try {
    const tip = await readers.source.readTip(input);
    report.tip = tip === null ? { status: 'ABSENT' } : {
      status: tip.receiptFingerprint === input.previousCheckpoint ? 'PARENT'
        : tip.schema === 'theseus.dreaming-worker.source-batch-receipt.v2'
          && tip.previousCheckpoint === input.previousCheckpoint
          && tip.currentPlanFingerprint === plan.planFingerprint ? 'MATCHED_ACK' : 'OTHER_TIP',
      fingerprint: tip.receiptFingerprint,
    };
  } catch { /* unknown, never infer absence */ }
  try {
    const plans = await readers.source.readPlans(input, input.previousCheckpoint, 100);
    const matches = plans.filter(p => p.planFingerprint === plan.planFingerprint);
    report.plan = { status: matches.length === 0 ? 'ABSENT'
      : matches.length === 1 && sourceReceiptFingerprint(matches[0]) === sourceReceiptFingerprint(plan)
        ? 'MATCHED' : 'READ_INCONSISTENT' };
  } catch { /* unknown */ }
  for (const entry of prepared) {
    const observation = { workFingerprint: entry.workFingerprint, status: 'UNKNOWN' };
    try {
      const journal = await readers.journal.read(entry.input);
      const completion = await readVerifiedCompletion(readers.work, entry.workFingerprint);
      if (completion) observation.completionFingerprint = completion.projectionFingerprint;
      if (journal.status === 'JOURNAL') {
        const state = journal.state;
        Object.assign(observation, {
          journalTip: state.tip, attempted: state.attempts.length,
          validated: state.validated.length, knownFailures: state.failures.length,
          remainingAttempts: state.remainingAttempts, pendingAttemptId: state.pending?.attemptId ?? null,
        });
        if (journal.completionExists !== Boolean(completion)) observation.status = 'READ_INCONSISTENT';
        else if (completion) {
          observation.status = !state.unresolved && state.validated.length === 2
            && buildPoolCompletion(entry.input, state.entries).projectionFingerprint === completion.projectionFingerprint
            ? 'POOL_COMPLETION_MATCHED' : 'READ_INCONSISTENT';
        } else if (state.unresolved) observation.status = 'BLOCKED_UNKNOWN';
        else if (state.validated.length === 2) observation.status = 'VALIDATED_NOT_COMMITTED';
        else observation.status = 'PARTIAL';
      } else if (journal.status === 'ABSENT') observation.status = completion ? 'READ_INCONSISTENT' : 'NOT_ADMITTED';
      else if (journal.status === 'LEGACY_UNRESOLVED') observation.status = completion ? 'READ_INCONSISTENT' : 'LEGACY_UNRESOLVED';
      else if (journal.status === 'COMPLETION_EXISTS') observation.status = completion ? 'LEGACY_COMPLETION_OBSERVED' : 'READ_INCONSISTENT';
    } catch { observation.status = 'UNKNOWN'; }
    report.work.push(observation);
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3 || !process.env.LEDGER_DATABASE_URL) throw Error();
    const input = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
    const options = { connectionString: process.env.LEDGER_DATABASE_URL };
    const report = await inspectSourceCycle(input, {
      source: createPostgresSourceBatchStore(options),
      journal: createPostgresPoolJournalStore(options),
      work: createPostgresWorkStore(options),
    });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } catch {
    console.error('SOURCE_INSPECTION_REJECTED: supply an exact synthetic batch JSON and explicit existing LEDGER_DATABASE_URL');
    process.exitCode = 2;
  }
}
