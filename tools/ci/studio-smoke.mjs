import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const outputDir = resolve(process.argv[2] ?? '.mastra/output');
const configuredModel = process.argv[3];
const expectedBuilder = Boolean(configuredModel?.trim());
const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((resolveClose, rejectClose) => listener.close(error => error ? rejectClose(error) : resolveClose()));

const child = spawn(process.execPath, ['index.mjs'], {
  cwd: outputDir,
  env: { PATH: process.env.PATH ?? '', HOME: outputDir, MASTRA_PORT: String(port), ...(configuredModel === undefined ? {} : { BUILDER_MODEL: configuredModel }) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let tail = '';
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', bytes => { tail = (tail + bytes.toString()).slice(-6000); });
}
let spawnError;
child.on('error', error => { spawnError = error; });
const closed = once(child, 'close').catch(() => null);
const base = 'http://127.0.0.1:' + port + '/api/workflows/dreaming-source-preview';
const stages = ['verify-source', 'prepare-plan', 'analyze-selected', 'verify-receipt'];

async function request(path = '', body) {
  const response = await fetch(base + path, {
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(3000),
  });
  assert.equal(response.status, 200);
  return response.json();
}

try {
  let graph;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null) throw Error('STUDIO_SMOKE_SERVER_EXIT');
    try { graph = await request(); break; } catch { await delay(250); }
  }
  assert.ok(graph, 'built Studio workflow API did not become ready');
  const agentsResponse = await fetch('http://127.0.0.1:' + port + '/api/agents', { signal: AbortSignal.timeout(3000) });
  assert.equal(agentsResponse.status, 200);
  const agents = await agentsResponse.json();
  assert.equal(Object.hasOwn(agents, 'builder-agent'), expectedBuilder, 'Builder must have an explicit nonblank model');
  assert.deepEqual(graph.stepGraph.map(x => x.step.id), stages);
  assert.ok(Object.values(graph.steps).every(x => x.inputSchema && x.outputSchema));
  const { runId } = await request('/create-run', {});
  assert.ok(runId);
  const run = await request('/start-async?runId=' + encodeURIComponent(runId), { inputData: { fixture: 'source-reader' } });
  assert.equal(run.status, 'success', JSON.stringify(run.error));
  assert.equal(run.result.status, 'RECEIPT_CANDIDATE');
  assert.equal(run.result.storage, 'IN_MEMORY_PREVIEW');
  assert.equal(run.result.workCount, 2);
  assert.equal(run.result.syntheticCalls, 4);
  assert.equal(run.result.externalCalls, 0);
  assert.equal(run.result.checkpointAdvanced, false);
  const readback = await request('/runs/' + encodeURIComponent(runId) + '?fields=result,steps');
  assert.equal(readback.status, 'success');
  assert.deepEqual(readback.result, run.result);
  assert.ok(stages.every(id => readback.steps[id]?.status === 'success'));
  console.log('STUDIO_BUNDLED_HTTP_PASS graph=4 steps=4 syntheticCalls=4 externalCalls=0 checkpointAdvanced=false');
} catch (error) {
  console.error(tail);
  throw error;
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    const ended = await Promise.race([closed.then(() => true), delay(2000, false, { ref: false })]);
    if (!ended) { child.kill('SIGKILL'); await closed; }
  }
}
