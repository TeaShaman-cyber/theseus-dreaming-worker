import { z } from 'zod';

import type { EvidencePacket } from './dry-run.ts';

const nonempty = z.string().trim().min(1);
const uncertainty = z.enum(['LOW', 'MEDIUM', 'HIGH']);

const sourceRef = z
  .object({
    source_ref: nonempty,
    evidence_hash: nonempty,
  })
  .strict();

const sourceRefs = z.array(sourceRef).min(1);

const factProposal = z
  .object({
    type: z.literal('FACT'),
    claim: nonempty,
    source_refs: sourceRefs,
  })
  .strict();

const inferenceProposal = z
  .object({
    type: z.literal('INFERENCE'),
    claim: nonempty,
    source_refs: sourceRefs,
    assumptions: z.array(nonempty).min(1),
    uncertainty,
  })
  .strict();

const hypothesisProposal = z
  .object({
    type: z.literal('HYPOTHESIS'),
    claim: nonempty,
    why_plausible: nonempty,
    source_refs: sourceRefs,
    falsifier: nonempty,
    required_evidence: z.array(nonempty).min(1),
    competing_explanations: z.array(nonempty).min(1),
    uncertainty,
  })
  .strict();

const unknownProposal = z
  .object({
    type: z.literal('UNKNOWN'),
    claim: nonempty,
    why_unknown: nonempty,
    source_refs: sourceRefs,
    required_evidence: z.array(nonempty).min(1),
  })
  .strict();

export const proposalSetSchema = z
  .object({
    schema: z.literal('theseus.dreaming-worker.proposals.v1'),
    proposals: z
      .array(
        z.discriminatedUnion('type', [
          factProposal,
          inferenceProposal,
          hypothesisProposal,
          unknownProposal,
        ]),
      )
      .min(1),
  })
  .strict();

export const proposalSetJsonSchema = z.toJSONSchema(proposalSetSchema);

export type ProposalSet = z.infer<typeof proposalSetSchema>;

export function parseProposalSet(rawText: string, packet: EvidencePacket): ProposalSet {
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawText);
  } catch {
    throw new Error('PILOT1_PROPOSAL_JSON_INVALID');
  }

  const parsed = proposalSetSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error(
      `PILOT1_PROPOSAL_SCHEMA_INVALID: ${z.prettifyError(parsed.error)}`,
    );
  }

  const accepted = new Map(
    packet.evidence.map(item => [item.sourceRef, item.evidenceHash]),
  );

  for (const proposal of parsed.data.proposals) {
    for (const ref of proposal.source_refs) {
      const acceptedHash = accepted.get(ref.source_ref);
      if (!acceptedHash || acceptedHash !== ref.evidence_hash) {
        throw new Error(
          `PILOT1_PROVENANCE_REJECTED: ${ref.source_ref} / ${ref.evidence_hash}`,
        );
      }
    }
  }

  return parsed.data;
}
