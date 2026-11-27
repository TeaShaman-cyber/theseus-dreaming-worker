import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { MUTATION_SHARDS, getMutationShard, sourceBatchMutationRanges } from '../scripts/mutation-shards.mjs';

test('heavy mutation is split into explicit hosted shards', () => {
  assert.deepEqual(Object.keys(MUTATION_SHARDS).sort(), [
    'checkpoint',
    'critique',
    'critique-live',
    'ledger-core',
    'ledger-postgres',
    'observability',
    'pilot0-1',
    'pilot2',
    'serializer',
    'source-batch-fixed',
    'source-batch-pooled',
    'source-cycle',
  ]);

  assert.deepEqual(MUTATION_SHARDS.checkpoint.mutate, ['src/dreaming/checkpoint-pilot2.ts', 'src/dreaming/durable-pilot2.ts']);
  assert.deepEqual(MUTATION_SHARDS.checkpoint.tests, ['test/checkpoint-pilot2.test.mjs', 'test/durable-pilot2.test.mjs']);
  assert.deepEqual(MUTATION_SHARDS.critique.mutate, [
    'src/dreaming/pilot2-critique.ts',
  ]);
  assert.deepEqual(MUTATION_SHARDS['critique-live'].mutate, [
    'src/dreaming/pilot2-critique-live.ts',
  ]);
  assert.deepEqual(MUTATION_SHARDS['ledger-core'].mutate, ['src/dreaming/proposal-ledger.ts']);
  assert.deepEqual(MUTATION_SHARDS['ledger-postgres'].mutate, ['src/dreaming/proposal-ledger-postgres.ts']);
  for (const name of ['ledger-core', 'ledger-postgres']) {
    assert.deepEqual(MUTATION_SHARDS[name].tests, [
      'test/proposal-ledger.test.mjs',
      'test/proposal-ledger-postgres.test.mjs',
      'test/durable-pilot2.test.mjs',
    ]);
  }
  assert.ok(MUTATION_SHARDS['pilot0-1'].mutate.includes('src/dreaming/pilot1-runner.ts'));
  assert.ok(MUTATION_SHARDS['pilot0-1'].mutate.includes('src/dreaming/structured-output-recovery.ts'));
  assert.ok(MUTATION_SHARDS.pilot2.mutate.includes('src/dreaming/pilot2-live-composition.ts'));
  assert.deepEqual(MUTATION_SHARDS.serializer.mutate, [
    'src/dreaming/serializer-benchmark.ts',
    'src/dreaming/serializer-benchmark-runner.ts',
  ]);
  assert.deepEqual(MUTATION_SHARDS.serializer.tests, [
    'test/serializer-benchmark.test.mjs',
    'test/serializer-benchmark-runner.test.mjs',
  ]);
  assert.ok(MUTATION_SHARDS.observability.mutate.includes('src/mastra/observability-routing.ts'));
});

test('mutation shard selection fails closed when no explicit shard is supplied', () => {
  assert.throws(() => getMutationShard(undefined), /MUTATION_SHARD_REQUIRED/);
  assert.throws(() => getMutationShard(''), /MUTATION_SHARD_REQUIRED/);
  assert.throws(() => getMutationShard('all'), /MUTATION_SHARD_UNKNOWN: all/);
  assert.equal(getMutationShard('serializer'), MUTATION_SHARDS.serializer);
});

test('source orchestration mutation scopes are independent and use their behavior tests', () => {
  for (const name of ['source-batch-fixed', 'source-batch-pooled']) {
    assert.deepEqual(MUTATION_SHARDS[name].tests, ['test/source-batch-run.test.mjs']);
    assert.match(MUTATION_SHARDS[name].mutate[0], /^src\/dreaming\/source-batch-run\.ts:[0-9]+-[0-9]+$/);
  }
  assert.deepEqual(MUTATION_SHARDS['source-cycle'].mutate, ['src/dreaming/source-cycle.ts']);
  assert.deepEqual(MUTATION_SHARDS['source-cycle'].tests, ['test/source-cycle.test.mjs']);
});


// Compare the actual pinned Stryker instrumenter's mutant identities, not just
// line counts. A new mutation spanning the boundary must fail this fast gate.
test('source-batch range partition preserves the complete disjoint mutant inventory', async () => {
  const require = createRequire(import.meta.url);
  const fromCore = createRequire(require.resolve('@stryker-mutator/core'));
  const { Instrumenter } = await import(pathToFileURL(fromCore.resolve('@stryker-mutator/instrumenter')));
  const logger = { debug() {}, info() {}, warn() {}, error() {}, isDebugEnabled() { return false; } };
  const instrumenter = new Instrumenter(logger);
  const name = 'src/dreaming/source-batch-run.ts';
  const content = readFileSync(new URL('../' + name, import.meta.url), 'utf8');
  const instrument = async mutate => (await instrumenter.instrument(
    [{ name, content, mutate }], { plugins: null, excludedMutations: [], ignorers: [] },
  )).mutants.map(({ id: _id, ...identity }) => JSON.stringify(identity)).sort();
  const bounds = ['source-batch-fixed', 'source-batch-pooled'].map(shard => {
    const patterns = MUTATION_SHARDS[shard].mutate;
    assert.equal(patterns.length, 1);
    const match = /^(.+):([0-9]+)-([0-9]+)$/.exec(patterns[0]);
    assert.ok(match);
    assert.equal(match[1], name);
    return [Number(match[2]), Number(match[3])];
  });
  assert.equal(bounds[0][0], 1);
  assert.equal(bounds[0][1] + 1, bounds[1][0]);
  assert.equal(bounds[1][1], content.split('\n').length);
  const full = await instrument(true);
  const parts = [];
  for (const [start, end] of bounds) {
    parts.push(await instrument([{ start: { line: start - 1, column: 0 }, end: { line: end - 1, column: Number.MAX_SAFE_INTEGER } }]));
  }
  const [fixed, pooled] = parts;
  assert.ok(fixed.length > 0 && pooled.length > 0);
  const fixedSet = new Set(fixed);
  assert.ok(pooled.every(identity => !fixedSet.has(identity)), 'overlapping mutation inventories');
  assert.deepEqual([...fixed, ...pooled].sort(), full, 'lost or duplicated mutants');
  console.log(JSON.stringify({ full: full.length, fixed: fixed.length, pooled: pooled.length }));
});


test('source-batch range selection fails closed if the top-level boundary is lost or ambiguous', () => {
  assert.throws(() => sourceBatchMutationRanges('no boundary'), /SOURCE_BATCH_MUTATION_BOUNDARY_INVALID/);
  assert.throws(() => sourceBatchMutationRanges('x\ntype PooledStore = 1;\ntype PooledStore = 2;\ny'), /SOURCE_BATCH_MUTATION_BOUNDARY_INVALID/);
  assert.throws(() => sourceBatchMutationRanges('type PooledStore = 1;\nx'), /SOURCE_BATCH_MUTATION_BOUNDARY_INVALID/);
});
