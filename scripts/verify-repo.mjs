#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const required = [
  'README.md',
  'AGENTS.md',
  'contracts/dreaming-worker.yaml',
  'docs/qa.md',
  'docs/exe-dev-remote-mcp.md',
  'tools/dev/check',
  'tools/ci/build-check',
  'tools/ci/mutation-test',
  '.github/workflows/qa.yml',
  '.github/workflows/mutation.yml',
  'package.json',
  'pnpm-lock.yaml',
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
