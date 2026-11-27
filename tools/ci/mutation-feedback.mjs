import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MUTATION_SHARDS } from '../../scripts/mutation-shards.mjs';

const all = () => Object.keys(MUTATION_SHARDS);

export function planMutation(eventName, event, paths = null) {
  const full = { mode: 'full', shards: all() };
  if (eventName === 'workflow_dispatch' && event.inputs?.shard) {
    if (typeof event.inputs.shard !== 'string' || !Object.hasOwn(MUTATION_SHARDS, event.inputs.shard)) throw Error('MUTATION_SHARD_UNKNOWN');
    return { mode: 'feedback', shards: [event.inputs.shard] };
  }
  if (eventName !== 'pull_request' || event.action === 'ready_for_review' || event.pull_request?.draft !== true) return full;
  const fallback = { mode: 'feedback', shards: all() };
  if (!Array.isArray(paths) || !paths.length) return fallback;
  const entries = Object.entries(MUTATION_SHARDS);
  if (paths.some(path => !entries.some(([, shard]) => shard.tests.includes(path)))) return fallback;
  return { mode: 'feedback', shards: entries.filter(([, shard]) => paths.some(path => shard.tests.includes(path))).map(([name]) => name) };
}

export function parseChangedPaths(raw) {
  if (!raw.endsWith('\0')) return null;
  const fields = raw.slice(0, -1).split('\0');
  if (!fields.length || fields.length % 2 !== 0) return null;
  const paths = [];
  for (let i = 0; i < fields.length; i += 2) {
    if (fields[i] !== 'M' || !fields[i + 1]) return null;
    paths.push(fields[i + 1]);
  }
  return paths;
}

function draftPaths(event) {
  const sha = /^[0-9a-f]{40}$/;
  const head = event.pull_request?.head?.sha;
  const base = event.action === 'synchronize' ? event.before : event.pull_request?.base?.sha;
  if (!sha.test(head ?? '') || !sha.test(base ?? '')) return null;
  try {
    if (event.action === 'synchronize') {
      if (event.after !== head) return null;
      execFileSync('git', ['merge-base', '--is-ancestor', base, head], { stdio: 'ignore' });
    }
    const range = event.action === 'synchronize' ? `${base}..${head}` : `${base}...${head}`;
    return parseChangedPaths(execFileSync('git', ['diff', '--name-status', '-z', '--no-renames', range, '--'], { encoding: 'utf8' }));
  } catch { return null; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const name = process.env.GITHUB_EVENT_NAME;
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const paths = name === 'pull_request' && event.pull_request?.draft === true ? draftPaths(event) : null;
  const plan = planMutation(name, event, paths);
  console.log(JSON.stringify(plan));
  appendFileSync(process.env.GITHUB_OUTPUT, `mode=${plan.mode}\nshards=${JSON.stringify(plan.shards)}\n`);
}
