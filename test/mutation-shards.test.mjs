import assert from 'node:assert/strict';
import test from 'node:test';

import { MUTATION_SHARDS, getMutationShard } from '../scripts/mutation-shards.mjs';

test('heavy mutation is split into three explicit hosted shards', () => {
  assert.deepEqual(Object.keys(MUTATION_SHARDS).sort(), [
    'critique',
    'dreaming-core',
    'observability',
  ]);

  assert.deepEqual(MUTATION_SHARDS.critique.mutate, [
    'src/dreaming/pilot2-critique.ts',
  ]);
  assert.ok(MUTATION_SHARDS['dreaming-core'].mutate.includes('src/dreaming/pilot2-live-composition.ts'));
  assert.ok(MUTATION_SHARDS.observability.mutate.includes('src/mastra/observability-routing.ts'));
});

test('mutation shard selection fails closed when no explicit shard is supplied', () => {
  assert.throws(() => getMutationShard(undefined), /MUTATION_SHARD_REQUIRED/);
  assert.throws(() => getMutationShard(''), /MUTATION_SHARD_REQUIRED/);
  assert.throws(() => getMutationShard('all'), /MUTATION_SHARD_UNKNOWN: all/);
});
