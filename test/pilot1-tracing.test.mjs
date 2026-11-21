import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPilot1TracingEnvelope } from '../src/mastra/pilot1-tracing.ts';
import {
  EXTERNAL_SAFE_SCOPE,
  OBSERVABILITY_SCOPE_KEY,
} from '../src/mastra/observability-routing.ts';

const correlation = {
  scope: 'SYNTHETIC_FIXTURE',
  phase: 'PILOT_1_SYNTHETIC_INFERENCE',
  proposalSchema: 'theseus.dreaming-worker.proposals.v1',
  requestFingerprint: 'sha256:req',
  evidenceFingerprint: 'sha256:evidence',
};

test('Pilot 1 tracing envelope selects external-safe exporters', () => {
  const envelope = buildPilot1TracingEnvelope(correlation);

  assert.deepEqual(envelope.requestContext, {
    [OBSERVABILITY_SCOPE_KEY]: EXTERNAL_SAFE_SCOPE,
  });
  assert.deepEqual(envelope.tracingOptions.requestContextKeys, [
    OBSERVABILITY_SCOPE_KEY,
  ]);
});

test('Pilot 1 tracing envelope carries only non-sensitive correlation metadata', () => {
  const envelope = buildPilot1TracingEnvelope(correlation);

  assert.deepEqual(envelope.tracingOptions.metadata, {
    'theseus.request_fingerprint': 'sha256:req',
    'theseus.evidence_fingerprint': 'sha256:evidence',
    'theseus.phase': 'PILOT_1_SYNTHETIC_INFERENCE',
    'theseus.proposal_schema': 'theseus.dreaming-worker.proposals.v1',
    'theseus.scope': 'SYNTHETIC_FIXTURE',
  });
  assert.deepEqual(envelope.tracingOptions.tags, [
    'theseus',
    'pilot1',
    'scope:SYNTHETIC_FIXTURE',
  ]);

  const serialized = JSON.stringify(envelope);
  assert.equal(serialized.includes('task'), false);
  assert.equal(serialized.includes('evidence":'), false);
  assert.equal(serialized.includes('Synthetic evidence'), false);
});
