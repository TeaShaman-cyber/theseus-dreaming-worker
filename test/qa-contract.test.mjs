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

test('targeted mutation workflow runs the repository mutation endpoint', () => {
  const workflow = readFileSync('.github/workflows/mutation.yml', 'utf8');
  assert.match(workflow, /npm run mutation/);
  assert.match(workflow, /src\/dreaming\/dry-run\.ts/);
  assert.match(workflow, /src\/dreaming\/pilot1-runner\.ts/);
  assert.match(workflow, /src\/dreaming\/proposal-schema\.ts/);
  assert.match(workflow, /src\/mastra\/observability-routing\.ts/);
  assert.match(workflow, /src\/mastra\/pilot1-tracing\.ts/);
  assert.match(workflow, /test\/dry-run\.test\.mjs/);
  assert.match(workflow, /test\/pilot1-runner\.test\.mjs/);
  assert.match(workflow, /test\/proposal-schema\.test\.mjs/);
  assert.match(workflow, /test\/observability-routing\.test\.mjs/);
  assert.match(workflow, /test\/pilot1-tracing\.test\.mjs/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /pnpm-workspace\.yaml/);
});
