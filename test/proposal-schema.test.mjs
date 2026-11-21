import test from 'node:test';
import assert from 'node:assert/strict';

import { parseProposalSet } from '../src/dreaming/proposal-schema.ts';

const packet = {
  schema: 'theseus-evidence-packet-v1',
  packetId: 'fixture-proposals-001',
  acceptedNewEvidence: true,
  coverage: { state: 'PARTIAL', currentness: 'UNKNOWN' },
  evidence: [
    {
      sourceRef: 'fixture:message:1',
      evidenceHash: 'sha256:fixture-message-1',
      text: 'Synthetic evidence: a worker timed out after a provider request.',
    },
    {
      sourceRef: 'fixture:message:2',
      evidenceHash: 'sha256:fixture-message-2',
      text: 'Synthetic evidence: a retry completed successfully.',
    },
  ],
};

const refs = [
  {
    source_ref: 'fixture:message:1',
    evidence_hash: 'sha256:fixture-message-1',
  },
];

test('parses all four typed proposal kinds with exact evidence references', () => {
  const raw = JSON.stringify({
    schema: 'theseus.dreaming-worker.proposals.v1',
    proposals: [
      {
        type: 'FACT',
        claim: 'The first synthetic provider request timed out.',
        source_refs: refs,
      },
      {
        type: 'INFERENCE',
        claim: 'The failure may be transient rather than deterministic.',
        source_refs: refs,
        assumptions: ['The retry used a materially comparable provider path.'],
        uncertainty: 'MEDIUM',
      },
      {
        type: 'HYPOTHESIS',
        claim: 'A transient provider-side delay caused the first timeout.',
        why_plausible: 'A later retry completed successfully.',
        source_refs: refs,
        falsifier: 'Equivalent retries repeatedly time out under stable local conditions.',
        required_evidence: ['Provider latency/error telemetry for both attempts.'],
        competing_explanations: ['Local transport delay.', 'Caller-side timeout configuration.'],
        uncertainty: 'HIGH',
      },
      {
        type: 'UNKNOWN',
        claim: 'The exact cause of the timeout is unknown.',
        why_unknown: 'The fixture contains no provider latency or server error telemetry.',
        source_refs: refs,
        required_evidence: ['Provider-side request trace.'],
      },
    ],
  });

  const parsed = parseProposalSet(raw, packet);

  assert.equal(parsed.schema, 'theseus.dreaming-worker.proposals.v1');
  assert.deepEqual(
    parsed.proposals.map(item => item.type),
    ['FACT', 'INFERENCE', 'HYPOTHESIS', 'UNKNOWN'],
  );
});

test('rejects free prose that is not a typed proposal document', () => {
  assert.throws(
    () => parseProposalSet('The timeout was probably transient.', packet),
    /PILOT1_PROPOSAL_JSON_INVALID/,
  );
});

test('rejects a hypothesis without a falsifier', () => {
  const raw = JSON.stringify({
    schema: 'theseus.dreaming-worker.proposals.v1',
    proposals: [
      {
        type: 'HYPOTHESIS',
        claim: 'A transient delay caused the timeout.',
        why_plausible: 'The retry succeeded.',
        source_refs: refs,
        required_evidence: ['Provider telemetry.'],
        competing_explanations: ['Local transport delay.'],
        uncertainty: 'HIGH',
      },
    ],
  });

  assert.throws(
    () => parseProposalSet(raw, packet),
    /PILOT1_PROPOSAL_SCHEMA_INVALID/,
  );
});

test('rejects an invented source reference', () => {
  const raw = JSON.stringify({
    schema: 'theseus.dreaming-worker.proposals.v1',
    proposals: [
      {
        type: 'FACT',
        claim: 'Invented evidence says the provider failed.',
        source_refs: [
          {
            source_ref: 'fixture:message:999',
            evidence_hash: 'sha256:not-in-packet',
          },
        ],
      },
    ],
  });

  assert.throws(
    () => parseProposalSet(raw, packet),
    /PILOT1_PROVENANCE_REJECTED.*fixture:message:999/,
  );
});

test('rejects a real source ref paired with the wrong evidence hash', () => {
  const raw = JSON.stringify({
    schema: 'theseus.dreaming-worker.proposals.v1',
    proposals: [
      {
        type: 'FACT',
        claim: 'The first request timed out.',
        source_refs: [
          {
            source_ref: 'fixture:message:1',
            evidence_hash: 'sha256:wrong-hash',
          },
        ],
      },
    ],
  });

  assert.throws(
    () => parseProposalSet(raw, packet),
    /PILOT1_PROVENANCE_REJECTED.*fixture:message:1/,
  );
});

test('rejects unknown proposal types instead of coercing them', () => {
  const raw = JSON.stringify({
    schema: 'theseus.dreaming-worker.proposals.v1',
    proposals: [
      {
        type: 'OPINION',
        claim: 'This sounds plausible.',
        source_refs: refs,
      },
    ],
  });

  assert.throws(
    () => parseProposalSet(raw, packet),
    /PILOT1_PROPOSAL_SCHEMA_INVALID/,
  );
});

test('rejects whitespace-only semantic fields', () => {
  const raw = JSON.stringify({
    schema: 'theseus.dreaming-worker.proposals.v1',
    proposals: [
      {
        type: 'FACT',
        claim: '   ',
        source_refs: refs,
      },
    ],
  });

  assert.throws(
    () => parseProposalSet(raw, packet),
    /PILOT1_PROPOSAL_SCHEMA_INVALID/,
  );
});

test('accepts LOW uncertainty as an explicit enum value', () => {
  const raw = JSON.stringify({
    schema: 'theseus.dreaming-worker.proposals.v1',
    proposals: [
      {
        type: 'INFERENCE',
        claim: 'A bounded inference.',
        source_refs: refs,
        assumptions: ['The compared attempts are materially similar.'],
        uncertainty: 'LOW',
      },
    ],
  });

  assert.equal(parseProposalSet(raw, packet).proposals[0].uncertainty, 'LOW');
});

test('accepts a proposal supported by multiple exact evidence references', () => {
  const raw = JSON.stringify({
    schema: 'theseus.dreaming-worker.proposals.v1',
    proposals: [
      {
        type: 'FACT',
        claim: 'The fixture contains both a timeout and a successful retry.',
        source_refs: [
          {
            source_ref: 'fixture:message:1',
            evidence_hash: 'sha256:fixture-message-1',
          },
          {
            source_ref: 'fixture:message:2',
            evidence_hash: 'sha256:fixture-message-2',
          },
        ],
      },
    ],
  });

  assert.equal(parseProposalSet(raw, packet).proposals[0].source_refs.length, 2);
});

test('rejects an inference with no explicit assumptions', () => {
  const raw = JSON.stringify({
    schema: 'theseus.dreaming-worker.proposals.v1',
    proposals: [
      {
        type: 'INFERENCE',
        claim: 'The retry suggests a transient condition.',
        source_refs: refs,
        assumptions: [],
        uncertainty: 'MEDIUM',
      },
    ],
  });

  assert.throws(
    () => parseProposalSet(raw, packet),
    /PILOT1_PROPOSAL_SCHEMA_INVALID/,
  );
});

test('rejects a hypothesis with no required evidence', () => {
  const raw = JSON.stringify({
    schema: 'theseus.dreaming-worker.proposals.v1',
    proposals: [
      {
        type: 'HYPOTHESIS',
        claim: 'A transient delay caused the timeout.',
        why_plausible: 'The retry succeeded.',
        source_refs: refs,
        falsifier: 'Equivalent retries repeatedly complete within the bound.',
        required_evidence: [],
        competing_explanations: ['Caller-side timeout configuration.'],
        uncertainty: 'HIGH',
      },
    ],
  });

  assert.throws(
    () => parseProposalSet(raw, packet),
    /PILOT1_PROPOSAL_SCHEMA_INVALID/,
  );
});

test('rejects UNKNOWN with no path to resolving the uncertainty', () => {
  const raw = JSON.stringify({
    schema: 'theseus.dreaming-worker.proposals.v1',
    proposals: [
      {
        type: 'UNKNOWN',
        claim: 'The exact timeout cause is unknown.',
        why_unknown: 'The fixture lacks provider telemetry.',
        source_refs: refs,
        required_evidence: [],
      },
    ],
  });

  assert.throws(
    () => parseProposalSet(raw, packet),
    /PILOT1_PROPOSAL_SCHEMA_INVALID/,
  );
});
