// Verify the actual runtime parser against a pinned external conformance corpus.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseStrictModelJson } from '../../src/dreaming/strict-model-json.ts';

const revision = '1ef36fa01286573e846ac449e8683f8833c5b26a';
const root = process.argv[2];
assert.ok(root, 'JSONTestSuite checkout required');
assert.equal(execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), revision);
assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).trim(), '');
const dir = join(root, 'test_parsing');
const files = readdirSync(dir).filter(name => /^[yni]_.*\.json$/.test(name)).sort();
const duplicatePolicy = new Set(['y_object_duplicated_key.json', 'y_object_duplicated_key_and_value.json']);
const deepInvalid = new Set(['n_structure_100000_opening_arrays.json', 'n_structure_open_array_object.json']);
const counts = { resourceRejected: 0, y: 0, n: 0, i: 0, accepted: 0, policyRejected: 0, invalidRejected: 0, implementationDefinedAccepted: 0 };
for (const file of files) {
  const kind = file[0];
  counts[kind]++;
  const bytes = readFileSync(join(dir, file));
  let result, raw, accepted = false;
  try {
    raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
  if (raw !== undefined) {
    try {
      result = parseStrictModelJson(raw);
      accepted = true;
    } catch (error) {
      if (error instanceof RangeError && deepInvalid.has(file) && error.message === 'Maximum call stack size exceeded') {
        counts.resourceRejected++;
      } else if (!(error instanceof SyntaxError)) throw error;
    }
  }
  if (kind === 'i') {
    if (accepted) counts.implementationDefinedAccepted++;
    continue;
  }
  if (kind === 'n' || duplicatePolicy.has(file)) {
    assert.equal(accepted, false, file);
    if (kind === 'n') counts.invalidRejected++;
    else counts.policyRejected++;
  } else {
    assert.ok(accepted, file);
    assert.deepEqual(result, JSON.parse(raw), file);
    counts.accepted++;
  }
}
assert.deepEqual([counts.y, counts.n, counts.i, counts.accepted, counts.policyRejected, counts.invalidRejected], [95, 188, 35, 93, 2, 188]);
console.log('JSON_CONFORMANCE_PASS', JSON.stringify(counts));
