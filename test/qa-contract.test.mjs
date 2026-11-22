import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('repository exposes one canonical development QA gate', () => {
  const gate = readFileSync('tools/dev/check', 'utf8');

  for (const required of [
    'scripts/verify-repo.mjs',
    'npm run lint',
    'npm run test',
    "python3 -m unittest discover -s test_py -p 'test_*.py'",
    'npm run typecheck',
    'npm run build:check',
    'python3 tools/reverse_trace/check_current.py',
    'git diff --check',
  ]) {
    assert.ok(gate.includes(required), 'missing canonical QA command: ' + required);
  }
});

test('hosted QA invokes the same canonical gate', () => {
  const workflow = readFileSync('.github/workflows/qa.yml', 'utf8');
  assert.match(workflow, /\.\/tools\/dev\/check/);
  assert.match(workflow, /persist-credentials:\s*false/);
});

test('QA documentation keeps fast and targeted-heavy lanes separate', () => {
  const qa = readFileSync('docs/qa.md', 'utf8');
  assert.match(qa, /Fast gate/i);
  assert.match(qa, /Targeted-heavy/i);
  assert.match(qa, /mutation/i);
});

test('targeted mutation workflow delegates scope to the shard manifest', () => {
  const workflow = readFileSync('.github/workflows/mutation.yml', 'utf8');
  const manifest = readFileSync('scripts/mutation-shards.mjs', 'utf8');

  assert.match(workflow, /npm run mutation -- \$\{\{ matrix\.shard \}\}/);
  assert.match(workflow, /scripts\/mutation-shards\.mjs/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /pnpm-workspace\.yaml/);

  for (const required of [
    'src/dreaming/dry-run.ts',
    'src/dreaming/pilot1-runner.ts',
    'src/dreaming/pilot2-runner.ts',
    'src/dreaming/pilot2-live-composition.ts',
    'src/dreaming/pilot2-critique.ts',
    'src/dreaming/pilot2-critique-live.ts',
    'src/dreaming/proposal-schema.ts',
    'src/mastra/observability-routing.ts',
    'src/mastra/pilot1-tracing.ts',
    'test/pilot2-critique.test.mjs',
  ]) {
    assert.ok(manifest.includes(required), 'missing mutation shard entry: ' + required);
  }
});

test('Pilot 2 CLI stays a thin wrapper over the canonical live-composition seam', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  const cli = readFileSync('tools/agent/run-pilot2.mjs', 'utf8');

  assert.equal(packageJson.scripts.pilot2, 'node tools/agent/run-pilot2.mjs');
  assert.match(cli, /runPilot2WithProviders/);
  assert.match(cli, /resolvePilot2RouteSecrets/);
  assert.doesNotMatch(cli, /pilot2-e2e\.ts/);
  assert.doesNotMatch(cli, /exe\.xyz|int\.exe|cloudflare/i);
});

test('targeted mutation scope keeps Pilot 2 live composition in the shard manifest', () => {
  const manifest = readFileSync('scripts/mutation-shards.mjs', 'utf8');
  const config = readFileSync('stryker.config.mjs', 'utf8');
  const wrapper = readFileSync('tools/ci/mutation-test', 'utf8');

  assert.match(manifest, /src\/dreaming\/pilot2-live-composition\.ts/);
  assert.match(manifest, /test\/pilot2-live-composition\.test\.mjs/);
  assert.match(config, /getMutationShard/);
  assert.match(wrapper, /getMutationShard/);
});


test('hosted mutation uses parallel named shards instead of one monolithic job', () => {
  const workflow = readFileSync('.github/workflows/mutation.yml', 'utf8');
  const wrapper = readFileSync('tools/ci/mutation-test', 'utf8');

  assert.match(workflow, /matrix:/);
  assert.match(workflow, /pilot0-1/);
  assert.match(workflow, /pilot2/);
  assert.match(workflow, /critique/);
  assert.match(workflow, /critique-live/);
  assert.match(workflow, /observability/);
  assert.match(workflow, /npm run mutation -- \$\{\{ matrix\.shard \}\}/);
  assert.match(workflow, /mutation-receipt-\$\{\{ matrix\.shard \}\}-\$\{\{ github\.sha \}\}/);
  assert.match(wrapper, /MUTATION_SHARD_REQUIRED/);
});
