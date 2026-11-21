export default {
  plugins: ['@stryker-mutator/typescript-checker'],
  mutate: ['src/dreaming/dry-run.ts', 'src/dreaming/pilot1-runner.ts'],
  ignorePatterns: ['.claude/**', '.agents/**', '.mastra/**', 'reports/**'],
  testRunner: 'command',
  commandRunner: {
    command: 'node --test test/dry-run.test.mjs test/pilot1-runner.test.mjs'
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
