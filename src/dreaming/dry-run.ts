import { createHash } from 'node:crypto';

export type CoverageState = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
export type CurrentnessState = 'CURRENT' | 'STALE' | 'UNKNOWN';

export type EvidenceItem = {
  sourceRef: string;
  evidenceHash: string;
  text: string;
};

export type EvidencePacket = {
  schema: 'theseus-evidence-packet-v1';
  packetId: string;
  acceptedNewEvidence: boolean;
  coverage: {
    state: CoverageState;
    currentness: CurrentnessState;
  };
  evidence: EvidenceItem[];
};

export type Pilot0Proposal =
  | {
      type: 'FACT';
      code: 'EVIDENCE_PACKET_ACCEPTED';
      claim: string;
      sourceRefs: string[];
    }
  | {
      type: 'UNKNOWN';
      code: 'ABSENCE_NOT_JUSTIFIED_BY_PARTIAL_COVERAGE';
      claim: string;
      sourceRefs: string[];
    };

export type Pilot0Result = {
  outcome: 'PROCESSED' | 'NO_DATA';
  proposals: Pilot0Proposal[];
  receipt: {
    contractVersion: 'theseus-dreaming-worker-goal-v1';
    packetId: string;
    inputFingerprint: string;
    evidenceCount: number;
    coverageState: CoverageState;
    currentness: CurrentnessState;
    externalModelCalls: 0;
  };
};

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return (
      '{' +
      Object.keys(record)
        .sort()
        .map(key => JSON.stringify(key) + ':' + canonicalize(record[key]))
        .join(',') +
      '}'
    );
  }

  return JSON.stringify(value);
}

function fingerprint(packet: EvidencePacket): string {
  const digest = createHash('sha256').update(canonicalize(packet)).digest('hex');
  return `sha256:${digest}`;
}

function validatePacket(packet: EvidencePacket): void {
  if (packet.schema !== 'theseus-evidence-packet-v1') {
    throw new Error('unsupported evidence packet schema');
  }

  if (!packet.packetId) {
    throw new Error('packetId is required');
  }

  for (const [index, item] of packet.evidence.entries()) {
    if (!item || !item.sourceRef || !item.evidenceHash) {
      throw new Error(
        `evidence[${index}] requires both sourceRef and evidenceHash so provenance cannot be lost`,
      );
    }
    if (!item.text) {
      throw new Error(`evidence[${index}].text is required`);
    }
  }
}

export function runPilot0(packet: EvidencePacket): Pilot0Result {
  validatePacket(packet);

  const receipt: Pilot0Result['receipt'] = {
    contractVersion: 'theseus-dreaming-worker-goal-v1',
    packetId: packet.packetId,
    inputFingerprint: fingerprint(packet),
    evidenceCount: packet.evidence.length,
    coverageState: packet.coverage.state,
    currentness: packet.coverage.currentness,
    externalModelCalls: 0,
  };

  if (!packet.acceptedNewEvidence || packet.evidence.length === 0) {
    return {
      outcome: 'NO_DATA',
      proposals: [],
      receipt,
    };
  }

  const sourceRefs = packet.evidence.map(item => item.sourceRef);
  const proposals: Pilot0Proposal[] = [
    {
      type: 'FACT',
      code: 'EVIDENCE_PACKET_ACCEPTED',
      claim: `Accepted packet contains ${packet.evidence.length} provenance-bearing evidence item(s).`,
      sourceRefs,
    },
  ];

  if (packet.coverage.state !== 'COMPLETE' || packet.coverage.currentness !== 'CURRENT') {
    proposals.push({
      type: 'UNKNOWN',
      code: 'ABSENCE_NOT_JUSTIFIED_BY_PARTIAL_COVERAGE',
      claim:
        'Coverage/currentness is not fully established, so this packet cannot justify claims that something is absent from the wider source history.',
      sourceRefs,
    });
  }

  return {
    outcome: 'PROCESSED',
    proposals,
    receipt,
  };
}
