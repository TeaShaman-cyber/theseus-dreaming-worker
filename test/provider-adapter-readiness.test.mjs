import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  compareMutationReports,
  summarizeMutationReport,
  buildExecutionReceipt,
  isSupportedNodeVersion,
  loadBaselineSnapshot,
  runLogged,
  focusedTestArgs,
} from '../tools/dev/provider-adapter-readiness.mjs';

function report(mutants) {
  return {
    files: {
      'src/dreaming/openai-provider-adapter.ts': { mutants },
    },
  };
}

const duplicateLocation = {
  location: {
    start: { line: 42, column: 1 },
    end: { line: 42, column: 9 },
  },
  mutatorName: 'StringLiteral',
  replacement: '""',
};

test('mutation delta is correlated by stable mutant id, not non-unique location or replacement', () => {
  const baseline = report([
    { id: '1', status: 'Survived', ...duplicateLocation },
    { id: '2', status: 'Killed', ...duplicateLocation },
  ]);
  const current = report([
    { id: '1', status: 'Killed', ...duplicateLocation },
    { id: '2', status: 'Killed', ...duplicateLocation },
  ]);

  const delta = compareMutationReports(baseline, current);

  assert.deepEqual(delta.transitions, {
    'Survived->Killed': ['1'],
  });
  assert.deepEqual(delta.missingFromCurrent, []);
  assert.deepEqual(delta.newInCurrent, []);
});

test('mutation summary preserves score inputs and non-scored statuses', () => {
  const summary = summarizeMutationReport(report([
    { id: '1', status: 'Killed' },
    { id: '2', status: 'Survived' },
    { id: '3', status: 'Timeout' },
    { id: '4', status: 'NoCoverage' },
    { id: '5', status: 'CompileError' },
    { id: '6', status: 'Ignored' },
  ]));

  assert.deepEqual(summary, {
    total: 6,
    killed: 1,
    survived: 1,
    timeout: 1,
    noCoverage: 1,
    compileError: 1,
    ignored: 1,
    mutationScore: 50,
  });
});

test('execution receipt preserves a failed sub-step and marks later work not run', () => {
  const receipt = buildExecutionReceipt({
    head: 'abc123',
    branch: 'feature/readiness',
    worktree: 'CLEAN',
    steps: {
      focusedTests: { status: 'PASS', exitCode: 0, tests: 50, pass: 50, log: 'focused.log' },
      canonicalQa: { status: 'FAIL', exitCode: 1, log: 'qa.log' },
      mutation: { status: 'NOT_RUN', exitCode: null, log: 'mutation.log' },
    },
    baseline: null,
  });

  assert.equal(receipt.executionStatus, 'FAIL');
  assert.equal(receipt.exitCode, 1);
  assert.equal(receipt.steps.canonicalQa.status, 'FAIL');
  assert.equal(receipt.steps.mutation.status, 'NOT_RUN');
});

test('readiness runner requires the repository Node 22.13+ runtime', () => {
  assert.equal(isSupportedNodeVersion('22.13.0'), true);
  assert.equal(isSupportedNodeVersion('22.23.5'), true);
  assert.equal(isSupportedNodeVersion('22.12.9'), false);
  assert.equal(isSupportedNodeVersion('18.19.1'), false);
});


test('baseline receipt is snapshotted before its mutation report can be overwritten', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'readiness-baseline-'));
  const mutationPath = path.join(dir, 'mutation.json');
  const receiptPath = path.join(dir, 'receipt.json');
  writeFileSync(mutationPath, JSON.stringify(report([{ id: '1', status: 'Killed' }])), 'utf8');
  writeFileSync(receiptPath, JSON.stringify({
    schema: 'theseus.dreaming-worker.provider-adapter-readiness.v1',
    artifacts: { mutationReport: 'mutation.json' },
  }), 'utf8');

  const snapshot = loadBaselineSnapshot(receiptPath);
  writeFileSync(mutationPath, JSON.stringify(report([{ id: '1', status: 'Survived' }])), 'utf8');

  assert.equal(snapshot.report.files['src/dreaming/openai-provider-adapter.ts'].mutants[0].status, 'Killed');
});

test('missing subprocess executable is returned as a failed result instead of rejecting receipt flow', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'readiness-spawn-'));
  const logPath = path.join(dir, 'spawn.log');
  const result = await runLogged(process.cwd(), '/definitely/missing/provider-adapter-readiness-command', [], logPath);

  assert.equal(result.exitCode, 127);
  assert.match(result.spawnError, /ENOENT|not found/i);
  assert.match(readFileSync(logPath, 'utf8'), /spawn/i);
});

test('focused provider-adapter tests explicitly select TAP reporter', () => {
  assert.deepEqual(focusedTestArgs(), [
    '--test',
    '--test-reporter=tap',
    'test/openai-provider-adapter.test.mjs',
  ]);
});
