import { z } from 'zod';

import {
  factProposal,
  fingerprintProposal,
  sha256Fingerprint,
  hypothesisProposal,
  inferenceProposal,
  unknownProposal,
  type Proposal,
} from './proposal-schema.ts';

const nonempty = z.string().trim().min(1);
const proposalSchema = z.discriminatedUnion('type', [
  factProposal,
  inferenceProposal,
  hypothesisProposal,
  unknownProposal,
]);

const routeSchema = z.object({
  id: nonempty,
  provider: nonempty,
  model: nonempty,
  modelFamily: nonempty,
}).strict();

const originSchema = z.object({
  packetId: nonempty,
  evidenceFingerprint: nonempty,
  requestFingerprint: nonempty,
  perspectiveId: nonempty,
  route: routeSchema,
}).strict();

const proposalRecordPayloadSchema = z.object({
  schema: z.literal('theseus.dreaming-worker.proposal-ledger-record.v1'),
  eventType: z.literal('PROPOSAL'),
  authority: z.literal('DERIVED_ONLY'),
  proposalFingerprint: nonempty,
  origin: originSchema,
  proposal: proposalSchema,
}).strict();

export const proposalLedgerRecordSchema = proposalRecordPayloadSchema.extend({
  recordId: nonempty,
}).strict();

const supersessionPayloadSchema = z.object({
  schema: z.literal('theseus.dreaming-worker.proposal-ledger-supersession.v1'),
  eventType: z.literal('SUPERSEDE'),
  authority: z.literal('DERIVED_ONLY'),
  supersededRecordId: nonempty,
  replacementRecordId: nonempty,
  reason: nonempty,
}).strict();

export const proposalLedgerSupersessionSchema = supersessionPayloadSchema.extend({
  eventId: nonempty,
}).strict();

export const proposalLedgerEventSchema = z.discriminatedUnion('eventType', [
  proposalLedgerRecordSchema,
  proposalLedgerSupersessionSchema,
]);

export type ProposalLedgerRecord = z.infer<typeof proposalLedgerRecordSchema>;
export type ProposalLedgerSupersession = z.infer<typeof proposalLedgerSupersessionSchema>;
export type ProposalLedgerEvent = z.infer<typeof proposalLedgerEventSchema>;

type ProposalRecordInput = {
  proposal: Proposal;
  origin: z.input<typeof originSchema>;
};

type SupersessionInput = {
  supersededRecordId: string;
  replacementRecordId: string;
  reason: string;
};

function contentId(payload: unknown): string {
  return sha256Fingerprint(JSON.stringify(payload));
}

function eventId(event: ProposalLedgerEvent): string {
  return event.eventType === 'PROPOSAL' ? event.recordId : event.eventId;
}

function expectedEventId(event: ProposalLedgerEvent): string {
  if (event.eventType === 'PROPOSAL') {
    const { recordId: _recordId, ...payload } = event;
    return contentId(proposalRecordPayloadSchema.parse(payload));
  }
  const { eventId: _eventId, ...payload } = event;
  return contentId(supersessionPayloadSchema.parse(payload));
}

function assertEventIdentity(event: ProposalLedgerEvent): void {
  if (event.eventType === 'PROPOSAL' && event.proposalFingerprint !== fingerprintProposal(event.proposal)) {
    throw new Error(`LEDGER_PROPOSAL_FINGERPRINT_MISMATCH: ${event.recordId}`);
  }
  if (eventId(event) !== expectedEventId(event)) {
    throw new Error(`LEDGER_EVENT_ID_MISMATCH: ${eventId(event)}`);
  }
}

export function createProposalRecord(input: ProposalRecordInput): ProposalLedgerRecord {
  const proposal = proposalSchema.parse(structuredClone(input.proposal));
  const origin = originSchema.parse(structuredClone(input.origin));
  const payload = proposalRecordPayloadSchema.parse({
    schema: 'theseus.dreaming-worker.proposal-ledger-record.v1',
    eventType: 'PROPOSAL',
    authority: 'DERIVED_ONLY',
    proposalFingerprint: fingerprintProposal(proposal),
    origin,
    proposal,
  });

  return proposalLedgerRecordSchema.parse({
    ...payload,
    recordId: contentId(payload),
  });
}

export function createSupersessionEvent(input: SupersessionInput): ProposalLedgerSupersession {
  const parsed = z.object({
    supersededRecordId: nonempty,
    replacementRecordId: nonempty,
    reason: nonempty,
  }).strict().parse(input);

  if (parsed.supersededRecordId === parsed.replacementRecordId) {
    throw new Error('LEDGER_SELF_SUPERSESSION');
  }

  const payload = supersessionPayloadSchema.parse({
    schema: 'theseus.dreaming-worker.proposal-ledger-supersession.v1',
    eventType: 'SUPERSEDE',
    authority: 'DERIVED_ONLY',
    ...parsed,
  });

  return proposalLedgerSupersessionSchema.parse({
    ...payload,
    eventId: contentId(payload),
  });
}

function pathExists(
  edges: Map<string, Set<string>>,
  start: string,
  target: string,
): boolean {
  const pending = [start];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (current === target) return true;
    visited.add(current);
    const next = edges.get(current);
    if (next) pending.push(...next);
  }
  return false;
}

export function appendLedgerEvent(
  ledgerInput: readonly ProposalLedgerEvent[],
  eventInput: ProposalLedgerEvent,
): ProposalLedgerEvent[] {
  const ledger = ledgerInput.map(event => proposalLedgerEventSchema.parse(structuredClone(event)));
  const event = proposalLedgerEventSchema.parse(structuredClone(eventInput));

  for (const existing of ledger) assertEventIdentity(existing);
  assertEventIdentity(event);

  if (ledger.some(existing => eventId(existing) === eventId(event))) {
    throw new Error(`LEDGER_DUPLICATE_EVENT: ${eventId(event)}`);
  }

  if (event.eventType === 'SUPERSEDE') {
    if (event.supersededRecordId === event.replacementRecordId) {
      throw new Error('LEDGER_SELF_SUPERSESSION');
    }

    const records = new Set(
      ledger
        .filter((item): item is ProposalLedgerRecord => item.eventType === 'PROPOSAL')
        .map(item => item.recordId),
    );
    if (!records.has(event.supersededRecordId) || !records.has(event.replacementRecordId)) {
      throw new Error('LEDGER_SUPERSESSION_REF_MISSING');
    }

    const edges = new Map<string, Set<string>>();
    for (const item of ledger) {
      if (item.eventType !== 'SUPERSEDE') continue;
      const existing = edges.get(item.supersededRecordId);
      if (existing) {
        existing.add(item.replacementRecordId);
      } else {
        edges.set(item.supersededRecordId, new Set([item.replacementRecordId]));
      }
    }
    if (pathExists(edges, event.replacementRecordId, event.supersededRecordId)) {
      throw new Error('LEDGER_SUPERSESSION_CYCLE');
    }
  }

  return [...ledger, event];
}

export function materializeLedger(ledgerInput: readonly ProposalLedgerEvent[]) {
  let validated: ProposalLedgerEvent[] = [];
  for (const event of ledgerInput) validated = appendLedgerEvent(validated, event);

  const supersededBy = new Map<string, string[]>();
  for (const event of validated) {
    if (event.eventType !== 'SUPERSEDE') continue;
    const next = supersededBy.get(event.supersededRecordId) ?? [];
    next.push(event.replacementRecordId);
    supersededBy.set(event.supersededRecordId, next);
  }

  const records = validated
    .filter((event): event is ProposalLedgerRecord => event.eventType === 'PROPOSAL')
    .map(record => {
      const replacements = supersededBy.get(record.recordId) ?? [];
      return {
        record: structuredClone(record),
        state: replacements.length > 0 ? 'SUPERSEDED' as const : 'ACTIVE' as const,
        supersededBy: [...replacements],
      };
    });

  return {
    schema: 'theseus.dreaming-worker.proposal-ledger-view.v1' as const,
    records,
    events: validated.map(event => structuredClone(event)),
  };
}
