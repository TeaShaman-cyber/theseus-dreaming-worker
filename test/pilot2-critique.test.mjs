import assert from 'node:assert/strict';
import test from 'node:test';

import { runPilot2 } from '../src/dreaming/pilot2-runner.ts';
import {
  buildCritiqueInput,
  parseCritiqueArtifact,
  critiqueArtifactJsonSchema,
} from '../src/dreaming/pilot2-critique.ts';

const packet = {
  schema: 'theseus-evidence-packet-v1',
  packetId: 'fixture-critique-001',
  acceptedNewEvidence: true,
  coverage: { state: 'COMPLETE', currentness: 'CURRENT' },
  evidence: [
    {
      sourceRef: 'fixture:critique#1',
      evidenceHash: 'sha256:critique-1',
      text: 'Synthetic evidence: the first request timed out.',
    },
    {
      sourceRef: 'fixture:critique#2',
      evidenceHash: 'sha256:critique-2',
      text: 'Synthetic evidence: a later retry succeeded.',
    },
  ],
};

function proposal(type, claim, ref = packet.evidence[0]) {
  if (type === 'FACT') {
    return {
      type, claim,
      source_refs: [{ source_ref: ref.sourceRef, evidence_hash: ref.evidenceHash }],
    };
  }
  return {
    type: 'INFERENCE',
    claim,
    source_refs: [{ source_ref: ref.sourceRef, evidence_hash: ref.evidenceHash }],
    assumptions: ['The requests are materially comparable.'],
    uncertainty: 'MEDIUM',
  };
}

function inference(model, proposals) {
  return async () => ({
    text: JSON.stringify({ schema: 'theseus.dreaming-worker.proposals.v1', proposals }),
    provider: 'fixture-provider',
    model,
    finishReason: 'stop',
    toolCalls: [],
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
  });
}

async function completePilot2() {
  return runPilot2(
    { scope: 'SYNTHETIC_FIXTURE', task: 'Interpret the evidence.', packet },
    [
      {
        id: 'route-a', provider: 'p-a', model: 'model-a', modelFamily: 'family-a',
        infer: inference('model-a', [proposal('FACT', 'The first request timed out.')]),
      },
      {
        id: 'route-b', provider: 'p-b', model: 'model-b', modelFamily: 'family-b',
        infer: inference('model-b', [proposal('INFERENCE', 'The timeout may have been transient.')]),
      },
    ],
  );
}

test('builds critique input from frozen valid Pilot 2 perspectives with stable proposal refs', async () => {
  const result = await completePilot2();
  assert.equal(result.outcome, 'COMPLETE');

  const input = buildCritiqueInput(result);
  assert.equal(input.schema, 'theseus.dreaming-worker.critique-input.v1');
  assert.equal(input.perspectives.length, 2);
  assert.equal(input.perspectives[0].proposals.length, 1);
  assert.match(input.perspectives[0].proposals[0].proposalFingerprint, /^sha256:/);
  assert.deepEqual(
    input.perspectives.flatMap(p => p.proposals.map(x => x.proposalFingerprint)).sort(),
    [
      ...result.comparison.passAOnlyProposalFingerprints,
      ...result.comparison.passBOnlyProposalFingerprints,
      ...result.comparison.sharedProposalFingerprints,
    ].sort(),
  );
  assert.deepEqual(
    input.perspectives[0].proposals[0].proposal.source_refs,
    [{ source_ref: 'fixture:critique#1', evidence_hash: 'sha256:critique-1' }],
  );
});

test('critique artifact may reference frozen proposals and evidence but cannot invent either', async () => {
  const input = buildCritiqueInput(await completePilot2());
  const a = input.perspectives[0].proposals[0];
  const b = input.perspectives[1].proposals[0];

  const artifact = parseCritiqueArtifact(JSON.stringify({
    schema: 'theseus.dreaming-worker.critique.v1',
    authority: 'DERIVED_ONLY',
    relations: [{
      relation: 'DISAGREEMENT',
      summary: 'The passes differ on whether the timeout itself establishes a transient cause.',
      proposal_refs: [
        { perspective_id: input.perspectives[0].perspectiveId, proposal_fingerprint: a.proposalFingerprint },
        { perspective_id: input.perspectives[1].perspectiveId, proposal_fingerprint: b.proposalFingerprint },
      ],
      evidence_refs: [{ source_ref: 'fixture:critique#1', evidence_hash: 'sha256:critique-1' }],
      requested_evidence: ['Comparable provider-side latency traces.'],
    }],
  }), input);

  assert.equal(artifact.authority, 'DERIVED_ONLY');
  assert.equal(artifact.relations[0].relation, 'DISAGREEMENT');

  assert.throws(
    () => parseCritiqueArtifact(JSON.stringify({
      schema: 'theseus.dreaming-worker.critique.v1',
      authority: 'DERIVED_ONLY',
      relations: [{
        relation: 'UNRESOLVED',
        summary: 'Unknown relation.',
        proposal_refs: [{ perspective_id: input.perspectives[0].perspectiveId, proposal_fingerprint: 'sha256:invented' }],
        evidence_refs: [{ source_ref: 'fixture:critique#1', evidence_hash: 'sha256:critique-1' }],
        requested_evidence: ['More evidence.'],
      }],
    }), input),
    /CRITIQUE_PROPOSAL_REF_REJECTED/,
  );

  assert.throws(
    () => parseCritiqueArtifact(JSON.stringify({
      schema: 'theseus.dreaming-worker.critique.v1',
      authority: 'DERIVED_ONLY',
      relations: [{
        relation: 'UNRESOLVED',
        summary: 'Unknown relation.',
        proposal_refs: [{ perspective_id: input.perspectives[0].perspectiveId, proposal_fingerprint: a.proposalFingerprint }],
        evidence_refs: [{ source_ref: 'fixture:invented', evidence_hash: 'sha256:invented' }],
        requested_evidence: ['More evidence.'],
      }],
    }), input),
    /CRITIQUE_EVIDENCE_REF_REJECTED/,
  );
});


test('PARTIAL Pilot 2 input preserves the valid perspective and the failed one', async () => {
  const result = await runPilot2(
    { scope: 'SYNTHETIC_FIXTURE', task: 'Interpret the evidence.', packet },
    [
      {
        id: 'route-a', provider: 'p-a', model: 'model-a', modelFamily: 'family-a',
        infer: inference('model-a', [proposal('FACT', 'The first request timed out.')]),
      },
      {
        id: 'route-b', provider: 'p-b', model: 'model-b', modelFamily: 'family-b',
        infer: async () => { throw new Error('synthetic provider failure'); },
      },
    ],
  );

  assert.equal(result.outcome, 'PARTIAL');
  const input = buildCritiqueInput(result);
  assert.equal(input.perspectives.length, 1);
  assert.equal(input.failedPerspectives.length, 1);
  assert.equal(input.failedPerspectives[0].perspectiveId, 'route-b');
  assert.equal(input.failedPerspectives[0].failure.code, 'INFERENCE_FAILED');
});

test('critique input is unavailable when Pilot 2 has no valid perspective', async () => {
  const result = await runPilot2(
    { scope: 'SYNTHETIC_FIXTURE', task: 'Interpret the evidence.', packet },
    [
      { id: 'route-a', provider: 'p-a', model: 'model-a', modelFamily: 'family-a', infer: async () => { throw new Error('fail-a'); } },
      { id: 'route-b', provider: 'p-b', model: 'model-b', modelFamily: 'family-b', infer: async () => { throw new Error('fail-b'); } },
    ],
  );

  assert.equal(result.outcome, 'FAIL_CLOSED');
  assert.throws(() => buildCritiqueInput(result), /CRITIQUE_INPUT_UNAVAILABLE/);
});


test('agreement/disagreement requires two perspectives and unresolved asks for more evidence', async () => {
  const input = buildCritiqueInput(await completePilot2());
  const a = input.perspectives[0].proposals[0];

  assert.throws(
    () => parseCritiqueArtifact(JSON.stringify({
      schema: 'theseus.dreaming-worker.critique.v1',
      authority: 'DERIVED_ONLY',
      relations: [{
        relation: 'DISAGREEMENT',
        summary: 'One-sided disagreement is invalid.',
        proposal_refs: [{ perspective_id: input.perspectives[0].perspectiveId, proposal_fingerprint: a.proposalFingerprint }],
        evidence_refs: [{ source_ref: 'fixture:critique#1', evidence_hash: 'sha256:critique-1' }],
        requested_evidence: ['A second perspective.'],
      }],
    }), input),
    /CRITIQUE_SCHEMA_INVALID/,
  );

  assert.throws(
    () => parseCritiqueArtifact(JSON.stringify({
      schema: 'theseus.dreaming-worker.critique.v1',
      authority: 'DERIVED_ONLY',
      relations: [{
        relation: 'UNRESOLVED',
        summary: 'More evidence is needed.',
        proposal_refs: [{ perspective_id: input.perspectives[0].perspectiveId, proposal_fingerprint: a.proposalFingerprint }],
        evidence_refs: [{ source_ref: 'fixture:critique#1', evidence_hash: 'sha256:critique-1' }],
        requested_evidence: [],
      }],
    }), input),
    /CRITIQUE_SCHEMA_INVALID/,
  );
});

test('critique JSON Schema is generated from the same validator used for parsing', () => {
  const text = JSON.stringify(critiqueArtifactJsonSchema);
  assert.match(text, /theseus\.dreaming-worker\.critique\.v1/);
  assert.match(text, /DERIVED_ONLY/);
  assert.match(text, /AGREEMENT/);
  assert.match(text, /DISAGREEMENT/);
  assert.match(text, /UNRESOLVED/);
});


test('critique schema rejects whitespace-only semantic fields', async () => {
  const input = buildCritiqueInput(await completePilot2());
  const a = input.perspectives[0].proposals[0];
  assert.throws(
    () => parseCritiqueArtifact(JSON.stringify({
      schema: 'theseus.dreaming-worker.critique.v1',
      authority: 'DERIVED_ONLY',
      relations: [{
        relation: 'UNRESOLVED',
        summary: '   ',
        proposal_refs: [{ perspective_id: input.perspectives[0].perspectiveId, proposal_fingerprint: a.proposalFingerprint }],
        evidence_refs: [{ source_ref: 'fixture:critique#1', evidence_hash: 'sha256:critique-1' }],
        requested_evidence: ['More evidence.'],
      }],
    }), input),
    /CRITIQUE_SCHEMA_INVALID/,
  );
});

test('critique artifact supports multiple relations and multiple evidence references', async () => {
  const result = await runPilot2(
    { scope: 'SYNTHETIC_FIXTURE', task: 'Interpret the evidence.', packet },
    [
      {
        id: 'route-a', provider: 'p-a', model: 'model-a', modelFamily: 'family-a',
        infer: inference('model-a', [{
          type: 'FACT',
          claim: 'The fixture records both a timeout and a later success.',
          source_refs: packet.evidence.map(ref => ({ source_ref: ref.sourceRef, evidence_hash: ref.evidenceHash })),
        }]),
      },
      {
        id: 'route-b', provider: 'p-b', model: 'model-b', modelFamily: 'family-b',
        infer: inference('model-b', [proposal('INFERENCE', 'The timeout may have been transient.')]),
      },
    ],
  );
  const input = buildCritiqueInput(result);
  const a = input.perspectives[0].proposals[0];
  const b = input.perspectives[1].proposals[0];

  const artifact = parseCritiqueArtifact(JSON.stringify({
    schema: 'theseus.dreaming-worker.critique.v1',
    authority: 'DERIVED_ONLY',
    relations: [
      {
        relation: 'UNRESOLVED',
        summary: 'The factual sequence alone does not establish a cause.',
        proposal_refs: [{ perspective_id: input.perspectives[0].perspectiveId, proposal_fingerprint: a.proposalFingerprint }],
        evidence_refs: [
          { source_ref: 'fixture:critique#1', evidence_hash: 'sha256:critique-1' },
          { source_ref: 'fixture:critique#2', evidence_hash: 'sha256:critique-2' },
        ],
        requested_evidence: ['Provider-side timing evidence.'],
      },
      {
        relation: 'DISAGREEMENT',
        summary: 'One pass states only the sequence; the other proposes a transient explanation.',
        proposal_refs: [
          { perspective_id: input.perspectives[0].perspectiveId, proposal_fingerprint: a.proposalFingerprint },
          { perspective_id: input.perspectives[1].perspectiveId, proposal_fingerprint: b.proposalFingerprint },
        ],
        evidence_refs: [{ source_ref: 'fixture:critique#1', evidence_hash: 'sha256:critique-1' }],
        requested_evidence: ['Comparable timing evidence.'],
      },
    ],
  }), input);

  assert.equal(artifact.relations.length, 2);
  assert.equal(artifact.relations[0].evidence_refs.length, 2);
});

test('malformed PARTIAL result with no valid perspective fails closed at critique boundary', async () => {
  const valid = await completePilot2();
  const malformed = { ...valid, outcome: 'PARTIAL', passes: [] };
  assert.throws(
    () => buildCritiqueInput(malformed),
    /CRITIQUE_INPUT_UNAVAILABLE: no valid Pilot 2 perspectives/,
  );
});

test('critique parser rejects malformed JSON explicitly', async () => {
  const input = buildCritiqueInput(await completePilot2());
  assert.throws(() => parseCritiqueArtifact('{', input), /CRITIQUE_JSON_INVALID/);
});

test('agreement may be recorded without requesting additional evidence', async () => {
  const input = buildCritiqueInput(await completePilot2());
  const a = input.perspectives[0].proposals[0];
  const b = input.perspectives[1].proposals[0];

  const artifact = parseCritiqueArtifact(JSON.stringify({
    schema: 'theseus.dreaming-worker.critique.v1',
    authority: 'DERIVED_ONLY',
    relations: [{
      relation: 'AGREEMENT',
      summary: 'Both perspectives accept the observed timeout as part of the evidence.',
      proposal_refs: [
        { perspective_id: input.perspectives[0].perspectiveId, proposal_fingerprint: a.proposalFingerprint },
        { perspective_id: input.perspectives[1].perspectiveId, proposal_fingerprint: b.proposalFingerprint },
      ],
      evidence_refs: [{ source_ref: 'fixture:critique#1', evidence_hash: 'sha256:critique-1' }],
      requested_evidence: [],
    }],
  }), input);

  assert.equal(artifact.relations[0].relation, 'AGREEMENT');
  assert.deepEqual(artifact.relations[0].requested_evidence, []);
});
