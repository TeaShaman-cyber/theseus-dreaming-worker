import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareMutationReports,
  summarizeMutationReport,
  buildExecutionReceipt,
  isSupportedNodeVersion,
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
