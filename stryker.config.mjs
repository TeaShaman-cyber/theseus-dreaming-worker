import { getMutationShard } from './scripts/mutation-shards.mjs';

const shard = getMutationShard(process.env.MUTATION_SHARD);

export default {
  plugins: ['@stryker-mutator/typescript-checker'],
  mutate: [...shard.mutate],
  ignorePatterns: ['.claude/**', '.agents/**', '.mastra/**', 'reports/**'],
  testRunner: 'command',
  commandRunner: {
    command: `node --test ${shard.tests.join(' ')}`
  },
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  coverageAnalysis: 'off',
  concurrency: 2,
  reporters: ['clear-text', 'json'],
  jsonReporter: {
    fileName: 'reports/mutation/mutation.json'
  },
  thresholds: {
    high: 90,
    low: 75,
    break: 100
  }
};
