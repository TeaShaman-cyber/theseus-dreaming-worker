export default {
  plugins: ['@stryker-mutator/typescript-checker'],
  mutate: ['src/dreaming/dry-run.ts', 'src/dreaming/pilot1-runner.ts', 'src/dreaming/pilot2-runner.ts', 'src/dreaming/pilot2-live-composition.ts', 'src/dreaming/proposal-schema.ts', 'src/mastra/observability-routing.ts', 'src/mastra/pilot1-tracing.ts'],
  ignorePatterns: ['.claude/**', '.agents/**', '.mastra/**', 'reports/**'],
  testRunner: 'command',
  commandRunner: {
    command: 'node --test test/dry-run.test.mjs test/pilot1-runner.test.mjs test/pilot2-runner.test.mjs test/pilot2-live-composition.test.mjs test/proposal-schema.test.mjs test/observability-routing.test.mjs test/pilot1-tracing.test.mjs'
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
