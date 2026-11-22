import { createHash } from 'node:crypto';
import { z } from 'zod';

import type { Pilot2PassFailed, Pilot2PassSuccess, Pilot2Result } from './pilot2-runner.ts';
import type { ProposalSet } from './proposal-schema.ts';

const nonempty = z.string().trim().min(1);

const proposalRefSchema = z.object({
  perspective_id: nonempty,
  proposal_fingerprint: nonempty,
}).strict();

const evidenceRefSchema = z.object({
  source_ref: nonempty,
  evidence_hash: nonempty,
}).strict();

const critiqueRelationSchema = z.object({
  relation: z.enum(['AGREEMENT', 'DISAGREEMENT', 'UNRESOLVED']),
  summary: nonempty,
  proposal_refs: z.array(proposalRefSchema).min(1),
  evidence_refs: z.array(evidenceRefSchema).min(1),
  requested_evidence: z.array(nonempty),
}).strict().superRefine((value, ctx) => {
  const perspectives = new Set(value.proposal_refs.map(ref => ref.perspective_id));
  if (value.relation !== 'UNRESOLVED' && perspectives.size < 2) {
    ctx.addIssue({
      code: 'custom',
      message: `${value.relation} requires proposals from at least two perspectives`,
      path: ['proposal_refs'],
    });
  }
  if (value.relation !== 'AGREEMENT' && value.requested_evidence.length === 0) {
    ctx.addIssue({
      code: 'custom',
      message: `${value.relation} requires requested_evidence`,
      path: ['requested_evidence'],
    });
  }
});

export const critiqueArtifactSchema = z.object({
  schema: z.literal('theseus.dreaming-worker.critique.v1'),
  authority: z.literal('DERIVED_ONLY'),
  relations: z.array(critiqueRelationSchema).min(1),
}).strict();

export const critiqueArtifactJsonSchema = z.toJSONSchema(critiqueArtifactSchema);

export type CritiqueArtifact = z.infer<typeof critiqueArtifactSchema>;

type Proposal = ProposalSet['proposals'][number];

export type CritiqueInputProposal = {
  proposalFingerprint: string;
  proposal: Proposal;
};

export type CritiquePerspective = {
  perspectiveId: string;
  route: Pilot2PassSuccess['route'];
  proposals: CritiqueInputProposal[];
};

export type CritiqueInput = {
  schema: 'theseus.dreaming-worker.critique-input.v1';
  pilot2Outcome: 'COMPLETE' | 'PARTIAL';
  packetId: string;
  evidenceFingerprint: string;
  requestFingerprint: string;
  perspectives: CritiquePerspective[];
  failedPerspectives: Array<{
    perspectiveId: string;
    route: Pilot2PassFailed['route'];
    failure: Pilot2PassFailed['failure'];
  }>;
};

function fingerprintProposal(proposal: Proposal): string {
  return 'sha256:' + createHash('sha256').update(JSON.stringify(proposal)).digest('hex');
}

export function buildCritiqueInput(result: Pilot2Result): CritiqueInput {
  if (result.outcome !== 'COMPLETE' && result.outcome !== 'PARTIAL') {
    throw new Error(`CRITIQUE_INPUT_UNAVAILABLE: Pilot 2 outcome ${result.outcome}`);
  }

  const successful = result.passes.filter((pass): pass is Pilot2PassSuccess => pass.status === 'SUCCESS');
  if (successful.length === 0) {
    throw new Error('CRITIQUE_INPUT_UNAVAILABLE: no valid Pilot 2 perspectives');
  }

  const failed = result.passes.filter((pass): pass is Pilot2PassFailed => pass.status === 'FAILED');

  return {
    schema: 'theseus.dreaming-worker.critique-input.v1',
    pilot2Outcome: result.outcome,
    packetId: result.receipt.packetId,
    evidenceFingerprint: result.receipt.evidenceFingerprint,
    requestFingerprint: result.receipt.requestFingerprint,
    perspectives: successful.map(pass => ({
      perspectiveId: pass.route.id,
      route: { ...pass.route },
      proposals: pass.proposalSet.proposals.map(proposal => ({
        proposalFingerprint: fingerprintProposal(proposal),
        proposal: structuredClone(proposal),
      })),
    })),
    failedPerspectives: failed.map(pass => ({
      perspectiveId: pass.route.id,
      route: { ...pass.route },
      failure: { ...pass.failure },
    })),
  };
}

export function parseCritiqueArtifact(rawText: string, input: CritiqueInput): CritiqueArtifact {
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawText);
  } catch {
    throw new Error('CRITIQUE_JSON_INVALID');
  }

  const parsed = critiqueArtifactSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error(`CRITIQUE_SCHEMA_INVALID: ${z.prettifyError(parsed.error)}`);
  }

  const proposals = new Map<string, CritiqueInputProposal>();
  for (const perspective of input.perspectives) {
    for (const proposal of perspective.proposals) {
      proposals.set(`${perspective.perspectiveId}\u0000${proposal.proposalFingerprint}`, proposal);
    }
  }

  for (const relation of parsed.data.relations) {
    const referencedProposals: CritiqueInputProposal[] = [];
    for (const ref of relation.proposal_refs) {
      const proposal = proposals.get(`${ref.perspective_id}\u0000${ref.proposal_fingerprint}`);
      if (!proposal) {
        throw new Error(
          `CRITIQUE_PROPOSAL_REF_REJECTED: ${ref.perspective_id} / ${ref.proposal_fingerprint}`,
        );
      }
      referencedProposals.push(proposal);
    }

    const allowedEvidence = new Set(
      referencedProposals.flatMap(item =>
        item.proposal.source_refs.map(ref => `${ref.source_ref}\u0000${ref.evidence_hash}`),
      ),
    );

    for (const ref of relation.evidence_refs) {
      if (!allowedEvidence.has(`${ref.source_ref}\u0000${ref.evidence_hash}`)) {
        throw new Error(`CRITIQUE_EVIDENCE_REF_REJECTED: ${ref.source_ref} / ${ref.evidence_hash}`);
      }
    }
  }

  return parsed.data;
}
