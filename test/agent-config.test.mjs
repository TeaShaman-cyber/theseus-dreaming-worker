import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(
  readFileSync('config/agents/dreaming-worker-pilot1.json', 'utf8'),
);

test('Pilot 1 Git config keeps model authority bounded', () => {
  const desired = config.desired;

  assert.equal(config.id, 'dreaming-worker-pilot1');
  assert.equal(desired.memory, null);
  assert.deepEqual(desired.tools, {});
  assert.deepEqual(desired.defaultOptions.activeTools, []);
  assert.equal(desired.defaultOptions.toolChoice, 'none');
  assert.equal(desired.defaultOptions.maxSteps, 1);
  assert.equal(desired.metadata.receiptAuthority, 'DETERMINISTIC_OUTER_RUNNER');
  assert.match(desired.instructions, /Do not produce or estimate RUN_RECEIPT/);
});

test('Pilot 1 Git config permits only synthetic/publication-safe inference', () => {
  const desired = config.desired;

  assert.equal(desired.metadata.externalInference, 'SYNTHETIC_FIXTURES_ONLY');
  assert.equal(desired.metadata.privateEvidenceEgress, 'DISABLED');
  assert.equal(desired.metadata.canonicalWrites, 'DISABLED');
  assert.match(desired.instructions, /SYNTHETIC_FIXTURE or PUBLICATION_SAFE/);
});

test('Pilot 1 agent is instructed to emit only the typed proposal JSON contract', () => {
  const instructions = config.desired.instructions;

  assert.match(instructions, /theseus\.dreaming-worker\.proposals\.v1/);
  assert.match(instructions, /FACT/);
  assert.match(instructions, /INFERENCE/);
  assert.match(instructions, /HYPOTHESIS/);
  assert.match(instructions, /UNKNOWN/);
  assert.match(instructions, /source_ref/);
  assert.match(instructions, /evidence_hash/);
  assert.match(instructions, /falsifier/);
  assert.match(instructions, /required_evidence/);
  assert.match(instructions, /JSON only/i);
  assert.match(instructions, /no markdown/i);
});
