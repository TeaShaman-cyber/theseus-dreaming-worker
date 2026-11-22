import path from 'node:path';

const reportPath = process.env.PROVIDER_ADAPTER_MUTATION_REPORT
  ? path.resolve(process.env.PROVIDER_ADAPTER_MUTATION_REPORT)
  : path.resolve('reports/provider-adapter-readiness/mutation.json');

export default {
  mutate: ['src/dreaming/openai-provider-adapter.ts'],
  ignorePatterns: ['.claude/**', '.agents/**', '.mastra/**', 'reports/**'],
  testRunner: 'command',
  commandRunner: {
    command: 'node --test test/openai-provider-adapter.test.mjs',
  },
  coverageAnalysis: 'off',
  concurrency: 2,
  reporters: ['json'],
  jsonReporter: {
    fileName: reportPath,
  },
  thresholds: {
    high: 90,
    low: 75,
    break: null,
  },
};
