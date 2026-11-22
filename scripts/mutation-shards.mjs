export const MUTATION_SHARDS = Object.freeze({
  'pilot0-1': Object.freeze({
    mutate: Object.freeze([
      'src/dreaming/dry-run.ts',
      'src/dreaming/pilot1-runner.ts',
      'src/dreaming/proposal-schema.ts',
    ]),
    tests: Object.freeze([
      'test/dry-run.test.mjs',
      'test/pilot1-runner.test.mjs',
      'test/proposal-schema.test.mjs',
    ]),
  }),
  pilot2: Object.freeze({
    mutate: Object.freeze([
      'src/dreaming/pilot2-runner.ts',
      'src/dreaming/pilot2-live-composition.ts',
    ]),
    tests: Object.freeze([
      'test/pilot2-runner.test.mjs',
      'test/pilot2-live-composition.test.mjs',
    ]),
  }),
  critique: Object.freeze({
    mutate: Object.freeze([
      'src/dreaming/pilot2-critique.ts',
    ]),
    tests: Object.freeze([
      'test/pilot2-critique.test.mjs',
    ]),
  }),
  observability: Object.freeze({
    mutate: Object.freeze([
      'src/mastra/observability-routing.ts',
      'src/mastra/pilot1-tracing.ts',
    ]),
    tests: Object.freeze([
      'test/observability-routing.test.mjs',
      'test/pilot1-tracing.test.mjs',
    ]),
  }),
});

export function getMutationShard(name) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('MUTATION_SHARD_REQUIRED');
  }
  const shard = MUTATION_SHARDS[name];
  if (!shard) {
    throw new Error(`MUTATION_SHARD_UNKNOWN: ${name}`);
  }
  return shard;
}
