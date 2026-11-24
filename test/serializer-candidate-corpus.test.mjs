import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseProposalSet } from '../src/dreaming/proposal-schema.ts';

const corpus = JSON.parse(
  readFileSync(new URL('../fixtures/serializer/candidate-v1.json', import.meta.url), 'utf8'),
);

test('candidate corpus has four exact-oracle runs, one unreviewed run, and two no-call controls', () => {
  assert.equal(corpus.schema, 'theseus.dreaming-worker.serializer-candidate-corpus.v1');
  assert.equal(corpus.cases.length, 7);
  assert.equal(corpus.cases.filter(item => item.goldenOutput !== null).length, 4);
  assert.equal(
    corpus.cases.filter(item => item.serializerEligible && item.goldenOutput === null).length,
    1,
  );
  assert.equal(corpus.cases.filter(item => !item.serializerEligible).length, 2);
});

test('every exact oracle is a valid Proposal v1 artifact whose semantic fields are literal in raw output', () => {
  for (const item of corpus.cases.filter(item => item.goldenOutput !== null)) {
    const parsed = parseProposalSet(item.goldenOutput, corpus.packet);
    for (const proposal of parsed.proposals) {
      const values = [
        proposal.type,
        proposal.claim,
        ...proposal.source_refs.flatMap(ref => [ref.source_ref, ref.evidence_hash]),
        ...('assumptions' in proposal ? proposal.assumptions : []),
        ...('why_plausible' in proposal ? [proposal.why_plausible] : []),
        ...('falsifier' in proposal ? [proposal.falsifier] : []),
        ...('required_evidence' in proposal ? proposal.required_evidence : []),
        ...('competing_explanations' in proposal ? proposal.competing_explanations : []),
        ...('uncertainty' in proposal ? [proposal.uncertainty] : []),
      ];
      for (const value of values) {
        assert.ok(item.reasonerRaw.includes(value), item.id + ': raw output missing ' + value);
      }
    }
  }
});

test('missing-provenance candidate deliberately withholds every accepted source ref and hash', () => {
  const item = corpus.cases.find(item => item.id === 'missing-provenance');
  assert.equal(item.goldenOutput, null);
  for (const evidence of corpus.packet.evidence) {
    assert.equal(item.reasonerRaw.includes(evidence.sourceRef), false);
    assert.equal(item.reasonerRaw.includes(evidence.evidenceHash), false);
  }
});

test('no-call controls correspond only to fail-closed recovery classifications', () => {
  const blocked = corpus.cases.filter(item => !item.serializerEligible);
  assert.deepEqual(
    blocked.map(item => item.classification).sort(),
    ['SEMANTIC_INVALID', 'TRUNCATED_OUTPUT'],
  );
});
