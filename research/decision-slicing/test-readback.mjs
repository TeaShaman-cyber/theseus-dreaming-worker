import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const path = name => fileURLToPath(new URL(name, import.meta.url));
const files = ['extraction', 'bothub-nemotron', 'nim-nemotron', 'nim-ultra'];
const fixture = JSON.parse(readFileSync(path('new-cases-gold.json'), 'utf8'));
const dir = mkdtempSync(join(tmpdir(), 'dw-extraction-readback-'));
let negatives = 0;
try {
  for (const name of files) {
    const file = path(name + '-observation.jsonl');
    const script = path(name === 'extraction' ? 'extract.mjs' : 'extract-nemotron.mjs');
    const rows = readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
    function verify(input, pass) {
      const candidate = join(dir, 'candidate.jsonl');
      writeFileSync(candidate, input.map(r => JSON.stringify(r)).join('\n') + '\n');
      const result = spawnSync(process.execPath, [script, '--verify', candidate], { encoding: 'utf8', timeout: 10000 });
      assert.ifError(result.error);
      assert.equal(result.status, pass ? 0 : 1, result.stdout + result.stderr);
      if (!pass) negatives++;
    }
    verify(rows, true);
    verify(rows.filter(r => r.kind !== 'case'), false);
    verify(rows.filter(r => !(r.kind === 'case' && r.id === 'linden')), false);
    const wrongId = structuredClone(rows);
    wrongId.find(r => r.kind === 'attempt').id = 'not-a-case';
    verify(wrongId, false);
    if (name === 'extraction') {
      const changed = structuredClone(rows);
      const failed = changed.find(r => r.kind === 'case' && r.status === 'FAILED');
      const {supportSets,premises} = fixture.linden;
      failed.rawFinal = JSON.stringify({policyRef:'E1',supportSets,premises});
      verify(changed, false);
      const wrongError = structuredClone(rows);
      wrongError.find(r => r.kind === 'case' && r.status === 'FAILED').error = 'different failure';
      verify(wrongError, false);
    }
  }
} finally { rmSync(dir, {recursive:true,force:true}); }
console.log('EXTRACTION_NEGATIVE_READBACK_PASS', {positive:files.length,negative:negatives});
