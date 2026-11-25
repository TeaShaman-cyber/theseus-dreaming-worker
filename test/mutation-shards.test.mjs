import assert from 'node:assert/strict';
import test from 'node:test';

import { MUTATION_SHARDS, getMutationShard } from '../scripts/mutation-shards.mjs';

test('heavy mutation is split into explicit hosted shards', () => {
  assert.deepEqual(Object.keys(MUTATION_SHARDS).sort(), [
    'checkpoint',
    'critique',
    'critique-live',
    'ledger',
    'observability',
    'pilot0-1',
    'pilot2',
    'serializer',
  ]);

  assert.deepEqual(MUTATION_SHARDS.checkpoint.mutate, ['src/dreaming/checkpoint-pilot2.ts']);
  assert.deepEqual(MUTATION_SHARDS.checkpoint.tests, ['test/checkpoint-pilot2.test.mjs']);
  assert.deepEqual(MUTATION_SHARDS.critique.mutate, [
    'src/dreaming/pilot2-critique.ts',
  ]);
  assert.deepEqual(MUTATION_SHARDS['critique-live'].mutate, [
    'src/dreaming/pilot2-critique-live.ts',
  ]);
  assert.deepEqual(MUTATION_SHARDS.ledger.mutate, [
    'src/dreaming/proposal-ledger.ts',
  ]);
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
