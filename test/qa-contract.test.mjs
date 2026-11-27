import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planMutation } from '../tools/ci/mutation-feedback.mjs';

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
    'src/dreaming/proposal-ledger.ts',
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
  assert.match(workflow, /fromJSON\(needs\.plan\.outputs\.shards\)/);
  assert.match(workflow, /node tools\/ci\/mutation-feedback\.mjs/);
  assert.match(workflow, /npm run mutation -- \$\{\{ matrix\.shard \}\}/);
  assert.match(workflow, /mutation-receipt-\$\{\{ matrix\.shard \}\}-\$\{\{ github\.sha \}\}/);
  assert.match(wrapper, /MUTATION_SHARD_REQUIRED/);
});

test('Neon ledger preview workflow is project-scoped, data-free, ephemeral, and cannot promote production', () => {
  const workflow = readFileSync('.github/workflows/neon-ledger-preview.yml', 'utf8');

  assert.match(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /^\s*push:/m);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.match(workflow, /infra\/postgres\/\*\*/);
  assert.match(workflow, /vars\.NEON_PREVIEW_ENABLED\s*==\s*'true'/);
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository/);
  assert.match(workflow, /vars\.NEON_PROJECT_ID/);
  assert.match(workflow, /secrets\.NEON_API_KEY/);

  assert.match(workflow, /neondatabase\/create-branch-action@72ed4f69a12b6be9c16aebfad893f6a21e9aba8b/);
  assert.doesNotMatch(workflow, /neondatabase\/reset-branch-action@/);
  assert.match(workflow, /neondatabase\/schema-diff-action@80cfa8521628e890015b60f5291a7738926617dc/);
  assert.match(workflow, /neondatabase\/delete-branch-action@4468d825d5a88ef4012f1705a82f02ec3072f776/);
  assert.match(workflow, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);

  assert.match(workflow, /preview\/dw-ledger-pr-\$\{\{ github\.event\.number \}\}-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /parent_branch:\s*main/);
  assert.match(workflow, /branch_type:\s*schema-only/);
  assert.match(workflow, /database:\s*dreaming_issue23/);
  assert.match(workflow, /role:\s*dreaming_issue23_owner/);
  assert.match(workflow, /expires_at:/);

  const createIndex = workflow.indexOf('neondatabase/create-branch-action@');
  const checkoutIndex = workflow.indexOf('actions/checkout@');
  const migrateIndex = workflow.indexOf('Apply ledger migration twice');
  assert.ok(createIndex >= 0 && checkoutIndex > createIndex && migrateIndex > checkoutIndex);

  assert.match(workflow, /DATABASE_URL:\s*\$\{\{ steps\.create_branch\.outputs\.db_url \}\}/);
  assert.match(workflow, /infra\/postgres\/dw_ledger_v1\.sql/);
  assert.match(workflow, /infra\/postgres\/verify_dw_ledger_v1\.sql/);
  assert.match(workflow, /needs:\s*\[preview, schema_diff\]/);
  assert.match(workflow, /continue-on-error:\s*true/);
  assert.doesNotMatch(workflow, /ALTER\s+ROLE|connection_uri/is);
});

test('hosted PostgreSQL contract lane uses the runner PostgreSQL service without registry pulls', () => {
  const workflow = readFileSync('.github/workflows/heavy-postgres.yml', 'utf8');
  const runner = readFileSync('tools/ci/heavy-postgres', 'utf8');

  assert.match(workflow, /systemctl start postgresql\.service/);
  assert.match(workflow, /PG_EXPECTED_MAJOR:\s*'18'/);
  assert.doesNotMatch(workflow, /docker\/library\/postgres|services:\s*[\s\S]*postgres:/);
  assert.match(workflow, /tools\/ci\/heavy-postgres/);
  assert.match(workflow, /node-version:\s*'22'/);
  assert.match(workflow, /persist-credentials:\s*false/);

  assert.match(runner, /infra\/postgres\/dw_ledger_v1\.sql/);
  assert.match(runner, /infra\/postgres\/verify_dw_ledger_v1\.sql/);
  assert.match(runner, /qa\/postgres\/ledger-adapter-integration\.mjs/);
  assert.match(runner, /server_version_num/);
});

test('ledger mutation shard covers the Postgres storage adapter', () => {
  const manifest = readFileSync('scripts/mutation-shards.mjs', 'utf8');
  assert.match(manifest, /src\/dreaming\/proposal-ledger-postgres\.ts/);
  assert.match(manifest, /test\/proposal-ledger-postgres\.test\.mjs/);
});


test('hosted PostgreSQL remains a path-scoped database QA lane, not a global PR gate', () => {
  const workflow = readFileSync('.github/workflows/heavy-postgres.yml', 'utf8');

  assert.match(workflow, /pull_request:\s*\n\s+paths:/);
  assert.match(workflow, /infra\/postgres\/\*\*/);
  assert.match(workflow, /src\/dreaming\/proposal-ledger-postgres\.ts/);
  assert.doesNotMatch(workflow, /- ['"]src\/\*\*['"]/);
  assert.doesNotMatch(workflow, /- ['"]docs\/\*\*['"]/);
  assert.doesNotMatch(workflow, /^\s*push:/m);
});

test('ledger mutation receives a bounded extended runner deadline without weakening other shards', () => {
  const workflow = readFileSync('.github/workflows/mutation.yml', 'utf8');
  assert.ok(workflow.includes("timeout-minutes: ${{ startsWith(matrix.shard, 'ledger-') && 60 || 30 }}"));
  const config = readFileSync('stryker.config.mjs', 'utf8');
  assert.match(config, /break:\s*100/);
});

test('source orchestration mutation checks run on separate hosted matrix jobs', () => {
  const workflow = readFileSync('.github/workflows/mutation.yml', 'utf8');
  assert.match(workflow, /fromJSON\(needs\.plan\.outputs\.shards\)/);
  const names = planMutation('push', {}).shards;
  assert.equal(names.filter(name => name === 'source-batch-fixed').length, 1);
  assert.equal(names.filter(name => name === 'source-batch-pooled').length, 1);
  assert.ok(!names.includes('source-batch'));
  assert.equal(names.filter(name => name === 'source-cycle').length, 1);
});
