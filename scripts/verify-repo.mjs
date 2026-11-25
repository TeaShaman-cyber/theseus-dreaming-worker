#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const required = [
  'README.md',
  'AGENTS.md',
  'contracts/dreaming-worker.yaml',
  'contracts/dreaming-worker-invariants.json',
  'specd.yaml',
  'specs/pilot1/bounded-inference/spec.md',
  'specs/pilot1/bounded-inference/verify.md',
  'specs/pilot1/bounded-inference/spec-lock.json',
  'specs/README.md',
  'specs/worker/core-contract/spec.md',
  'specs/worker/core-contract/verify.md',
  'specs/pilot2/independent-perspectives/spec.md',
  'specs/pilot2/independent-perspectives/verify.md',
  'specs/pilot2/independent-perspectives/spec-lock.json',
  'src/dreaming/pilot2-runner.ts',
  'specs/intake/session-search-boundary/spec.md',
  'specs/intake/session-search-boundary/verify.md',
  'src/dreaming/AGENTS.md',
  'docs/qa.md',
  'docs/observability.md',
  'docs/exe-dev-remote-mcp.md',
  'tools/dev/check',
  'tools/dev/specd-check',
  'tools/specd/install',
  'tools/specd/package.json',
  'tools/specd/package-lock.json',
  'tools/ci/build-check',
  'tools/ci/mutation-test',
  'tools/reverse_trace/check_current.py',
  'tools/reverse_trace/reverse_trace_contract.py',
  'scripts/review_gate_required.py',
  'scripts/codex_review_status.py',
  'scripts/codex_review_bounded_status.py',
  'scripts/codex_review_changed_files.py',
  'tools/pr/codex-review-status.sh',
  'tools/pr/codex-review-wait.sh',
  '.github/workflows/qa.yml',
  '.github/workflows/mutation.yml',
  '.github/workflows/review-gate.yml',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'biome.json',
  'stryker.config.mjs'
];

for (const path of required) {
  if (!existsSync(path)) throw new Error('REPO_VERIFY_FAIL missing: ' + path);
}

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const forbiddenSuffixes = ['.db', '.sqlite', '.sqlite3', '.pem', '.key', '.p12', '.pfx'];
for (const path of tracked) {
  const lower = path.toLowerCase();
  if (
    lower === '.env' ||
    (lower.startsWith('.env.') && lower !== '.env.example') ||
    forbiddenSuffixes.some(suffix => lower.endsWith(suffix)) ||
    lower.startsWith('.mastra/') ||
    lower.startsWith('node_modules/') ||
    lower.startsWith('dist/') ||
    lower.startsWith('reports/')
  ) {
    throw new Error('REPO_VERIFY_FAIL forbidden tracked artifact: ' + path);
  }
}

const textExts = new Set(['.md', '.json', '.mjs', '.js', '.ts', '.yaml', '.yml', '.sh', '.txt']);
const secretPatterns = [
  /github_pat_[A-Za-z0-9_]{20,}/i,
  /gh[pousr]_[A-Za-z0-9]{20,}/i,
  /sk-[A-Za-z0-9_-]{20,}/,
  /Bearer\s+[A-Za-z0-9._~+/=-]{24,}/i
];

for (const path of tracked) {
  if (path === 'scripts/verify-repo.mjs' || path.endsWith('pnpm-lock.yaml')) continue;
  if (!textExts.has(extname(path)) && path !== 'README.md' && path !== 'AGENTS.md') continue;
  const text = readFileSync(path, 'utf8');
  if (secretPatterns.some(pattern => pattern.test(text))) {
    throw new Error('REPO_VERIFY_FAIL likely secret in: ' + path);
  }
}

const qaWorkflow = readFileSync('.github/workflows/qa.yml', 'utf8');
if (!qaWorkflow.includes('./tools/dev/check')) {
  throw new Error('REPO_VERIFY_FAIL CI does not call tools/dev/check');
}

const devCheck = readFileSync('tools/dev/check', 'utf8');
if (!devCheck.split('\n').includes('./tools/dev/specd-check') || !qaWorkflow.includes('run: ./tools/specd/install')) {
  throw new Error('REPO_VERIFY_FAIL missing unconditional SpecD QA wiring');
}

const mutationWorkflow = readFileSync('.github/workflows/mutation.yml', 'utf8');
if (!mutationWorkflow.includes('npm run mutation')) {
  throw new Error('REPO_VERIFY_FAIL mutation CI does not call repository mutation endpoint');
}

for (const name of readdirSync('.github/workflows')) {
  if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
  const path = join('.github/workflows', name);
  const text = readFileSync(path, 'utf8');
  for (const match of text.matchAll(/^\s*-\s*uses:\s*([^@\s]+)@([^\s#]+)/gm)) {
    const [, action, ref] = match;
    if (action.startsWith('./')) continue;
    if (!/^[0-9a-f]{40}$/i.test(ref)) {
      throw new Error('REPO_VERIFY_FAIL unpinned action in ' + path + ': ' + action + '@' + ref);
    }
  }
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
for (const name of ['lint', 'test', 'typecheck', 'build', 'build:check', 'mutation']) {
  if (!pkg.scripts?.[name]) throw new Error('REPO_VERIFY_FAIL missing package script: ' + name);
}
if (pkg.scripts.check !== './tools/dev/check') {
  throw new Error('REPO_VERIFY_FAIL npm check does not delegate to canonical tools/dev/check');
}

console.log('REPO_VERIFY_PASS tracked=' + tracked.length + ' required=' + required.length);
