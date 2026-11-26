import { z } from 'zod';
import { prepareCheckpointedPilot2 } from './checkpoint-pilot2.ts';
import type { DurablePilot2Input } from './durable-pilot2.ts';
import { runPilot0 } from './dry-run.ts';
import { pilot1RequestFingerprint } from './pilot1-runner.ts';
import { fingerprintProposal, parseProposalSet, proposalSetSchema, sha256Fingerprint } from './proposal-schema.ts';

const fingerprint = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const name = z.string().min(1).max(256).refine(s => s === s.trim());
const routeSchema = z.object({
  id: name, provider: name, model: name, modelFamily: name,
}).strict();
const admissionSchema = z.object({
  kind: z.literal('ADMIT'), workFingerprint: fingerprint,
  requestFingerprint: fingerprint, evidenceFingerprint: fingerprint,
  packetId: z.string().min(1), maxAttempts: z.number().int().min(2).max(200),
}).strict();
const startSchema = z.object({
  kind: z.literal('START'), attemptId: z.uuid(), slot: z.union([z.literal(0), z.literal(1)]),
  route: routeSchema,
}).strict();
const successSchema = z.object({
  kind: z.literal('VALIDATED'), attemptId: z.uuid(),
  receipt: z.object({
    packetId: z.string().min(1), requestFingerprint: fingerprint, evidenceFingerprint: fingerprint,
    provider: name, model: name, finishReason: z.literal('stop'),
    externalModelCalls: z.literal(1), toolsUsed: z.literal(0),
    memoryUsed: z.literal(false), canonicalWrites: z.literal(0),
  }).strict(),
  proposalSet: proposalSetSchema,
}).strict();
const failureSchema = z.object({
  kind: z.literal('KNOWN_FAILURE'), attemptId: z.uuid(),
  providerState: z.literal('RESPONDED'),
  code: z.enum(['RATE_LIMITED','HTTP_ERROR','MALFORMED_RESPONSE','STREAM_ERROR','OUTPUT_BUDGET_EXHAUSTED',
    'EMPTY_FINAL_CONTENT','INVALID_JSON','INVALID_SCHEMA','PROVENANCE_REJECTED','POLICY_VIOLATION','MODEL_IDENTITY_MISMATCH']),
  observed: z.object({ provider: name, model: name, finishReason: z.string().nullable() }).strict().optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  retryAfterMs: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  cooldown: z.object({
    scope: z.enum(['route','provider']), key: name, notBeforeMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }).strict().nullable(),
}).strict();
const unknownSchema = z.object({
  kind: z.literal('UNKNOWN'), attemptId: z.uuid(),
  code: z.enum(['TIMEOUT','TRANSPORT_UNKNOWN','EXECUTION_UNKNOWN']),
}).strict();
const eventSchema = z.discriminatedUnion('kind', [admissionSchema,startSchema,successSchema,failureSchema,unknownSchema]);
const payloadSchema = z.object({
  schema: z.literal('theseus.dreaming-worker.pool-journal-entry.v1'),
  ordinal: z.number().int().min(0).max(400),
  previousFingerprint: fingerprint.nullable(),
  event: eventSchema,
}).strict();
const entrySchema = payloadSchema.extend({ entryFingerprint: fingerprint }).strict();

export type PoolJournalEvent = z.infer<typeof eventSchema>;
export type PoolJournalEntry = z.infer<typeof entrySchema>;
type Start = z.infer<typeof startSchema>;
type Validated = z.infer<typeof successSchema>;
type KnownFailure = z.infer<typeof failureSchema>;

export function preparePoolJournal(raw: DurablePilot2Input) {
  const { workFingerprint, input, skipDecision } = prepareCheckpointedPilot2({
    ...raw, checkpoint: { status: 'AVAILABLE', committed: null },
  });
  if (skipDecision) throw Error('POOL_JOURNAL_NO_ADMISSIBLE_WORK');
  const request = input.request;
  const gate = runPilot0(request.packet);
  const evidenceFingerprint = gate.receipt.inputFingerprint;
  return { workFingerprint, request, evidenceFingerprint,
    requestFingerprint: pilot1RequestFingerprint(request.scope, request.task, evidenceFingerprint) };
}

type Context = ReturnType<typeof preparePoolJournal>;

export function poolJournalAdmission(context: Context, maxAttempts: number): PoolJournalEvent {
  return admissionSchema.parse({
    kind: 'ADMIT', workFingerprint: context.workFingerprint, requestFingerprint: context.requestFingerprint,
    evidenceFingerprint: context.evidenceFingerprint, packetId: context.request.packet.packetId, maxAttempts,
  });
}

export function makePoolJournalEntry(previous: PoolJournalEntry | null, event: PoolJournalEvent): PoolJournalEntry {
  const payload = payloadSchema.parse({
    schema: 'theseus.dreaming-worker.pool-journal-entry.v1',
    ordinal: previous ? previous.ordinal + 1 : 0, previousFingerprint: previous?.entryFingerprint ?? null, event,
  });
  return entrySchema.parse({ ...payload, entryFingerprint: sha256Fingerprint(JSON.stringify(payload)) });
}

const family = (r: Start['route']) => r.modelFamily.toLowerCase();
export function replayPoolJournal(context: Context, raw: unknown[]) {
  if (!raw.length || raw.length > 401) throw Error('POOL_JOURNAL_LENGTH');
  const entries = raw.map(entry => entrySchema.parse(entry));
  const first = entries[0].event;
  if (first.kind !== 'ADMIT'
    || JSON.stringify(first) !== JSON.stringify(poolJournalAdmission(context, first.maxAttempts))) {
    throw Error('POOL_JOURNAL_ADMISSION_MISMATCH');
  }
  const attempts: Start[] = [];
  const validated: { start: Start; result: Validated }[] = [];
  const failures: { start: Start; result: KnownFailure }[] = [];
  let pending: Start | null = null;
  let unknown = false;
  for (const [i, entry] of entries.entries()) {
    const expected = makePoolJournalEntry(entries[i - 1] ?? null, entry.event);
    if (JSON.stringify(entry) !== JSON.stringify(expected)) throw Error('POOL_JOURNAL_CHAIN');
    if (!i) continue;
    const event = entry.event;
    if (unknown || event.kind === 'ADMIT') throw Error('POOL_JOURNAL_TERMINAL_OR_DUPLICATE_ADMISSION');
    if (event.kind === 'START') {
      if (pending || validated.length === 2 || attempts.length >= first.maxAttempts || event.slot !== validated.length
        || attempts.some(a => a.attemptId === event.attemptId || a.route.id === event.route.id
          || (a.route.provider === event.route.provider && a.route.model === event.route.model))
        || validated.some(v => family(v.start.route) === family(event.route))) throw Error('POOL_JOURNAL_START_REJECTED');
      pending = event;
      attempts.push(event);
      continue;
    }
    if (!pending || pending.attemptId !== event.attemptId) throw Error('POOL_JOURNAL_OUTCOME_MISMATCH');
    if (event.kind === 'VALIDATED') {
      const r = event.receipt;
      if (r.requestFingerprint !== context.requestFingerprint || r.evidenceFingerprint !== context.evidenceFingerprint
        || r.packetId !== context.request.packet.packetId || r.model !== pending.route.model
        || validated.some(v => v.result.receipt.provider === r.provider && v.result.receipt.model === r.model)) {
        throw Error('POOL_JOURNAL_VALIDATED_IDENTITY');
      }
      const proposals = parseProposalSet(JSON.stringify(event.proposalSet), context.request.packet).proposals;
      if (new Set(proposals.map(fingerprintProposal)).size !== proposals.length) throw Error('POOL_JOURNAL_DUPLICATE_PROPOSAL');
      validated.push({ start: pending, result: event });
    } else if (event.kind === 'KNOWN_FAILURE') {
      const c = event.cooldown;
      if (c && c.key !== (c.scope === 'route' ? pending.route.id : pending.route.provider)) {
        throw Error('POOL_JOURNAL_COOLDOWN_SCOPE');
      }
      failures.push({ start: pending, result: event });
    } else {
      unknown = true;
    }
    pending = null;
  }
  return {
    entries, tip: entries[entries.length - 1].entryFingerprint,
    attempts, validated, failures, unresolved: unknown || pending !== null,
    pending, remainingAttempts: first.maxAttempts - attempts.length,
  };
}
