// New scopes earn a measured baseline before entering the existing blocking matrix.
import { resolve } from 'node:path';
const scopes = {
  'verified-session-work': ['test/verified-session-work.test.mjs', 'test/source-batch-run.test.mjs', 'test/source-cycle.test.mjs'],
  'pooled-durable-pilot2': ['test/pooled-durable-pilot2.test.mjs', 'test/source-batch-run.test.mjs', 'test/source-cycle.test.mjs'],
  'pool-attempt-journal': ['test/pool-attempt-journal.test.mjs', 'test/pooled-durable-pilot2.test.mjs', 'test/source-batch-run.test.mjs'],
};
const scope = process.env.CRAP_MUTATION_SCOPE;
if (!Object.hasOwn(scopes, scope)) throw Error('CRAP_MUTATION_SCOPE_REQUIRED');
export default {
  plugins: ['@stryker-mutator/typescript-checker'],
  mutate: ['src/dreaming/' + scope + '.ts'],
  ignorePatterns: ['.claude/**', '.agents/**', '.mastra/**', 'reports/**'],
  testRunner: 'command',
  commandRunner: { command: 'node --test --test-concurrency=2 ' + scopes[scope].join(' ') },
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  coverageAnalysis: 'off',
  concurrency: 2,
  reporters: ['clear-text', 'json'],
  jsonReporter: { fileName: resolve('reports/crap-mutation/' + scope + '/mutation.json') },
  thresholds: { high: 90, low: 75, break: null },
};
