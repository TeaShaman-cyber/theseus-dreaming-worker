import { readFileSync } from 'node:fs';

const sourceBatchPath = 'src/dreaming/source-batch-run.ts';

// Resolve the top-level fixed/pooled boundary against this checkout, not
// stale line constants. Canonical QA compares the actual mutant inventory.
export function sourceBatchMutationRanges(content) {
  const lines = content.split('\n');
  const boundaries = lines.flatMap((line, index) => line.startsWith('type PooledStore =') ? [index] : []);
  if (boundaries.length !== 1 || boundaries[0] < 2 || boundaries[0] >= lines.length - 1) {
    throw new Error('SOURCE_BATCH_MUTATION_BOUNDARY_INVALID');
  }
  const split = boundaries[0];
  return [sourceBatchPath + ':1-' + split, sourceBatchPath + ':' + (split + 1) + '-' + lines.length];
}
const [sourceBatchFixed, sourceBatchPooled] = sourceBatchMutationRanges(
  readFileSync(new URL('../' + sourceBatchPath, import.meta.url), 'utf8'),
);

export const MUTATION_SHARDS = Object.freeze({
  'pilot0-1': Object.freeze({
    mutate: Object.freeze([
      'src/dreaming/dry-run.ts',
      'src/dreaming/pilot1-runner.ts',
      'src/dreaming/proposal-schema.ts',
      'src/dreaming/structured-output-recovery.ts',
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
  checkpoint: Object.freeze({
    mutate: Object.freeze([
      'src/dreaming/checkpoint-pilot2.ts',
      'src/dreaming/durable-pilot2.ts',
    ]),
    tests: Object.freeze([
      'test/checkpoint-pilot2.test.mjs',
      'test/durable-pilot2.test.mjs',
    ]),
  }),
  serializer: Object.freeze({
    mutate: Object.freeze([
      'src/dreaming/serializer-benchmark.ts',
      'src/dreaming/serializer-benchmark-runner.ts',
    ]),
    tests: Object.freeze([
      'test/serializer-benchmark.test.mjs',
      'test/serializer-benchmark-runner.test.mjs',
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
  'critique-live': Object.freeze({
    mutate: Object.freeze([
      'src/dreaming/pilot2-critique-live.ts',
    ]),
    tests: Object.freeze([
      'test/pilot2-critique-live.test.mjs',
    ]),
  }),
  'ledger-core': Object.freeze({
    mutate: Object.freeze(['src/dreaming/proposal-ledger.ts']),
    tests: Object.freeze([
      'test/proposal-ledger.test.mjs',
      'test/proposal-ledger-postgres.test.mjs',
      'test/durable-pilot2.test.mjs',
    ]),
  }),
  'ledger-postgres': Object.freeze({
    mutate: Object.freeze(['src/dreaming/proposal-ledger-postgres.ts']),
    tests: Object.freeze([
      'test/proposal-ledger.test.mjs',
      'test/proposal-ledger-postgres.test.mjs',
      'test/durable-pilot2.test.mjs',
    ]),
  }),
  'source-batch-fixed': Object.freeze({
    mutate: Object.freeze([sourceBatchFixed]),
    tests: Object.freeze(['test/source-batch-run.test.mjs']),
  }),
  'source-batch-pooled': Object.freeze({
    mutate: Object.freeze([sourceBatchPooled]),
    tests: Object.freeze(['test/source-batch-run.test.mjs']),
  }),
  'source-cycle': Object.freeze({
    mutate: Object.freeze(['src/dreaming/source-cycle.ts']),
    tests: Object.freeze(['test/source-cycle.test.mjs']),
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
