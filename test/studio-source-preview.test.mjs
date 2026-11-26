import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { MastraServer } from '@mastra/hono';
import { readFileSync } from 'node:fs';
import { Mastra } from '@mastra/core/mastra';

const workflows = async () => (await import('../src/mastra/workflows/source-batch-preview.ts')).developmentWorkflows;

test('Studio exposes the fixed synthetic source graph, not a production runner', async () => {
  assert.match(readFileSync(new URL('../src/mastra/index.ts', import.meta.url), 'utf8'), /workflows:\s*developmentWorkflows/);
  const mastra = new Mastra({ workflows: await workflows() });
  const app = new Hono();
  await new MastraServer({ app, mastra }).init();
  const response = await app.request('/api/workflows/dreaming-source-preview');
  assert.equal(response.status, 200);
  const graph = await response.json();
  assert.deepEqual(graph.stepGraph.map(x => x.step.id), [
    'verify-source', 'prepare-plan', 'analyze-selected', 'verify-receipt',
  ]);
  assert.ok(Object.values(graph.steps).every(s => s.inputSchema && s.outputSchema));
});

test('Studio preview reuses core on fixed synthetic evidence and cannot advance a source checkpoint', async () => {
  const wf = (await workflows())['dreaming-source-preview'];
  const run = await wf.createRun();
  const result = await run.start({ inputData: { fixture: 'source-reader' } });
  assert.equal(result.status, 'success');
  assert.equal(result.result.status, 'RECEIPT_CANDIDATE');
  assert.equal(result.result.storage, 'IN_MEMORY_PREVIEW');
  assert.equal(result.result.workCount, 2);
  assert.equal(result.result.syntheticCalls, 4);
  assert.equal(result.result.externalCalls, 0);
  assert.equal(result.result.checkpointAdvanced, false);
  assert.deepEqual(Object.keys(result.steps), ['input', 'verify-source', 'prepare-plan', 'analyze-selected', 'verify-receipt']);
});

test('Studio rejects any fixture selection outside its fixed synthetic scope', async () => {
  const wf = (await workflows())['dreaming-source-preview'];
  const run = await wf.createRun();
  const attempt = await run.start({ inputData: { fixture: 'private-history' } }).catch(error => ({ status: 'rejected', error }));
  assert.notEqual(attempt.status, 'success');
  assert.equal(attempt.result, undefined);
});
