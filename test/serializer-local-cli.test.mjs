import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const cli = readFileSync('tools/agent/run-local-serializer.mjs', 'utf8');
const config = JSON.parse(
  readFileSync('fixtures/serializer/qwen3-0.6b-q8_0-exe-dev.json', 'utf8'),
);

test('local serializer CLI is a thin wrapper over canonical adapter and suite', () => {
  assert.equal(
    packageJson.scripts['serializer:local'],
    'node tools/agent/run-local-serializer.mjs',
  );
  assert.match(cli, /runSerializerCandidateSuite/);
  assert.match(cli, /createLocalLlamaSerializerExecutor/);
  assert.equal(cli.includes('fetch('), false);
  assert.equal(cli.includes('child_process'), false);
});

test('Qwen local baseline config pins exact model and runtime artifacts', () => {
  assert.equal(config.schema, 'theseus.dreaming-worker.local-serializer-config.v1');
  assert.equal(config.candidate.kind, 'LOCAL_MODEL');
  assert.equal(config.candidate.host, 'EXE_DEV');
  assert.equal(config.runtime.baseURL, 'http://127.0.0.1:18081/v1');
  assert.equal(config.runtime.revision, 'b12659');
  assert.equal(config.runtime.commit, '51fc2f90e');
  assert.equal(config.repeat, 2);
  assert.equal(config.artifacts.model.sizeBytes, 639446688);
  assert.equal(
    config.artifacts.model.sha256,
    '9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031',
  );
  assert.equal(config.artifacts.runtimeArchive.sizeBytes, 23298837);
  assert.equal(
    config.artifacts.runtimeArchive.sha256,
    'dcaa5764aab4c87ade003f136cd2e2e3c0a0d37dee00ac684e792c877061f9d8',
  );
});
