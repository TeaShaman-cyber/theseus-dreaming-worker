import { parseProposalSet, sha256Fingerprint, type ProposalSet } from './proposal-schema.ts';
import type { EvidencePacket } from './dry-run.ts';
import type { Pilot2Recovery } from './pilot2-runner.ts';

export type SerializerFixture = {
  id: string;
  packet: EvidencePacket;
  reasoner: {
    rawOutput: string;
    finishReason?: string;
    recovery: Pick<Pilot2Recovery, 'classification' | 'serializerEligible' | 'rawModelOutput'>;
  };
  // A frozen synthetic oracle, never an assertion about external truth.
  goldenOutput: string | null;
};

export type SerializerBenchmarkOutcome =
  | 'NOT_ELIGIBLE'
  | 'INVALID_JSON'
  | 'INVALID_SCHEMA'
  | 'PROVENANCE_REJECTED'
  | 'SCHEMA_VALID_UNREVIEWED'
  | 'GOLDEN_MISMATCH'
  | 'EXACT_GOLDEN_MATCH';

export type SerializerBenchmarkResult = {
  schema: 'theseus.dreaming-worker.serializer-benchmark.v1';
  fixtureId: string;
  outcome: SerializerBenchmarkOutcome;
  goldenComparison: 'NOT_AVAILABLE' | 'DIFFERENT' | 'EXACT_STRUCTURED_MATCH';
  rawOutputFingerprint: string;
  candidateOutputFingerprint: string | null;
  externalModelCalls: 0;
  canonicalWrites: 0;
};

function isEligible(fixture: SerializerFixture): boolean {
  const { reasoner } = fixture;
  return (
    reasoner.finishReason === 'stop' &&
    reasoner.recovery.serializerEligible === true &&
    (reasoner.recovery.classification === 'UNSTRUCTURED_COMPLETE' ||
      reasoner.recovery.classification === 'SCHEMA_MISMATCH_COMPLETE') &&
    reasoner.recovery.rawModelOutput === reasoner.rawOutput
  );
}

export function evaluateSerializerFixture(
  fixture: SerializerFixture,
  candidateOutput: string,
): SerializerBenchmarkResult {
  const base = {
    schema: 'theseus.dreaming-worker.serializer-benchmark.v1' as const,
    fixtureId: fixture.id,
    rawOutputFingerprint: sha256Fingerprint(fixture.reasoner.rawOutput),
    externalModelCalls: 0 as const,
    canonicalWrites: 0 as const,
  };

  if (!isEligible(fixture)) {
    return {
      ...base,
      outcome: 'NOT_ELIGIBLE',
      goldenComparison: 'NOT_AVAILABLE',
      candidateOutputFingerprint: null,
    };
  }

  const candidateOutputFingerprint = sha256Fingerprint(candidateOutput);
  const result = (outcome: SerializerBenchmarkOutcome, goldenComparison: SerializerBenchmarkResult['goldenComparison'] = 'NOT_AVAILABLE'): SerializerBenchmarkResult => ({
    ...base,
    outcome,
    goldenComparison,
    candidateOutputFingerprint,
  });

  let candidate: ProposalSet;
  try {
    candidate = parseProposalSet(candidateOutput, fixture.packet);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('PILOT1_PROVENANCE_REJECTED')) return result('PROVENANCE_REJECTED');
    if (message.startsWith('PILOT1_PROPOSAL_SCHEMA_INVALID')) return result('INVALID_SCHEMA');
    return result('INVALID_JSON');
  }

  if (fixture.goldenOutput === null) return result('SCHEMA_VALID_UNREVIEWED');

  // Invalid fixture configuration is a setup error, not a scored model failure.
  const golden = parseProposalSet(fixture.goldenOutput, fixture.packet);
  if (JSON.stringify(candidate) !== JSON.stringify(golden)) {
    return result('GOLDEN_MISMATCH', 'DIFFERENT');
  }
  return result('EXACT_GOLDEN_MATCH', 'EXACT_STRUCTURED_MATCH');
}
