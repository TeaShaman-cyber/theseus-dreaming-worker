import { Client } from 'pg';
import { z } from 'zod';
import { decodeSourceHandoff } from './source-handoff.ts';
import { prepareSourceBatchExecution, prepareSourceBatchPlan, prepareSourceBatchReceipt, sourceReceiptFingerprint, type BatchInput } from './source-batch-receipt.ts';
import { readVerifiedCompletion, runDurablePilot2 } from './durable-pilot2.ts';
import type { Pilot2Route } from './pilot2-runner.ts';
import { runPooledDurablePilot2 } from './pooled-durable-pilot2.ts';
import { createPostgresPoolJournalStore, createPostgresPooledCompletionStore, createPostgresWorkStore, type LedgerPgClient, type LedgerPgClientFactory } from './proposal-ledger-postgres.ts';

type Intent = Pick<BatchInput, 'candidate' | 'expected' | 'task' | 'analysisVersion'>;
const fingerprint = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const text = z.string().refine(s => s.trim().length > 0);

function context(raw: Intent) {
  const handoff = decodeSourceHandoff(raw.candidate, raw.expected);
  if (!handoff.scope.startsWith('synthetic:')) throw Error('SOURCE_STORE_SCOPE');
  const task = text.parse(raw.task), analysisVersion = text.parse(raw.analysisVersion);
  const chain = sourceReceiptFingerprint(['source-chain-v1', handoff.provider, handoff.scope, task, analysisVersion]);
  const root = {
    schema: 'theseus.dreaming-worker.source-root.v1' as const,
    provider: handoff.provider, scope: handoff.scope, task, analysisVersion,
    membership: handoff.previous_membership, previousCheckpoint: null,
  };
  return { handoff, chain, root: { ...root, receiptFingerprint: sourceReceiptFingerprint(root) } };
}

type Root = ReturnType<typeof context>['root'];
type Receipt = NonNullable<Awaited<ReturnType<typeof prepareSourceBatchReceipt>>['receipt']>;
type OriginPointer = {
  workFingerprint: string;
  previousCheckpoint: string;
  planFingerprint: string;
};
type BoundReceipt = Omit<Receipt, 'schema'> & {
  schema: 'theseus.dreaming-worker.source-batch-receipt.v2';
  currentPlanFingerprint: string;
  origins: OriginPointer[];
};
type NoWorkReceipt = {
  schema: 'theseus.dreaming-worker.source-no-work-receipt.v1';
  previousCheckpoint: string;
  task: string;
  analysisVersion: string;
  handoff: ReturnType<typeof decodeSourceHandoff>;
  reason: 'VERIFIED_EMPTY_SESSION_DELTA';
  attemptedPasses: 0;
  receiptFingerprint: string;
};
type Stored = Root | Receipt | BoundReceipt | NoWorkReceipt;

function requireEmptyDelta(handoff: ReturnType<typeof decodeSourceHandoff>) {
  if (!handoff.scope.startsWith('synthetic:') || handoff.selected.length || handoff.removed.length
    || handoff.previous_membership.snapshot_sha256 === handoff.current_membership.snapshot_sha256) {
    throw Error('SOURCE_NO_WORK_DELTA');
  }
}
type Plan = ReturnType<typeof prepareSourceBatchPlan>;
type PlanRow = { plan_fingerprint: string; plan: unknown };
type PlanResult =
  | { status: 'STAGED' | 'ALREADY_STAGED'; plan: Plan }
  | { status: 'CONFLICT' | 'STORAGE_UNKNOWN'; plan: null };

function checkPlan(row: PlanRow, chain: string, parent: Stored): Plan {
  const envelope = z.object({
    schema: z.literal('theseus.dreaming-worker.source-batch-plan.v1'),
    task: text, analysisVersion: text, planFingerprint: fingerprint,
    previousCheckpoint: fingerprint, checkpointAdvanced: z.literal(false),
    handoff: z.object({ provider: text, scope: text, previous_membership: z.unknown() }).passthrough(),
    work: z.array(z.object({
      workFingerprint: fingerprint, packetId: text, requestFingerprint: fingerprint,
      evidenceFingerprint: fingerprint, witness: z.object({}).passthrough(),
    }).strict()).min(1).max(100),
  }).strict().parse(row.plan);
  const { planFingerprint, ...payload } = envelope;
  if (planFingerprint !== row.plan_fingerprint || sourceReceiptFingerprint(payload) !== planFingerprint
    || payload.previousCheckpoint !== parent.receiptFingerprint
    || sourceReceiptFingerprint(['source-chain-v1', payload.handoff.provider, payload.handoff.scope,
      payload.task, payload.analysisVersion]) !== chain
    || sourceReceiptFingerprint(payload.handoff.previous_membership) !== sourceReceiptFingerprint(parentMembership(parent))) {
    throw Error('SOURCE_PLAN_READBACK');
  }
  // Like checkpoint readback, trusts the validated writer; hashes are not signatures.
  return row.plan as Plan;
}

function parentMembership(parent: Stored) {
  return parent.schema === 'theseus.dreaming-worker.source-root.v1'
    ? parent.membership : parent.handoff.current_membership;
}
type Result =
  | { status: 'ACKNOWLEDGED' | 'ALREADY_ACKNOWLEDGED'; receipt: Stored }
  | { status: 'CONFLICT' | 'PENDING' | 'STORAGE_UNKNOWN'; receipt: null };
type Row = { checkpoint_fingerprint: string; previous_checkpoint: string | null; receipt: unknown };

function checkRow(row: Row, chain: string): Stored {
  const envelope = z.object({
    schema: z.enum(['theseus.dreaming-worker.source-root.v1', 'theseus.dreaming-worker.source-batch-receipt.v1', 'theseus.dreaming-worker.source-batch-receipt.v2', 'theseus.dreaming-worker.source-no-work-receipt.v1']),
    task: text, analysisVersion: text, receiptFingerprint: fingerprint,
    previousCheckpoint: fingerprint.nullable(),
  }).passthrough().parse(row.receipt);
  const { receiptFingerprint, ...payload } = envelope;
  if (receiptFingerprint !== row.checkpoint_fingerprint || payload.previousCheckpoint !== row.previous_checkpoint
    || sourceReceiptFingerprint(payload) !== receiptFingerprint) throw Error('SOURCE_STORE_READBACK');
  const identity = payload.schema === 'theseus.dreaming-worker.source-root.v1' ? payload : payload.handoff;
  const { provider, scope } = z.object({ provider: text, scope: text }).parse(identity);
  if (sourceReceiptFingerprint(['source-chain-v1', provider, scope, payload.task, payload.analysisVersion]) !== chain
    || (payload.schema === 'theseus.dreaming-worker.source-root.v1') !== (payload.previousCheckpoint === null)) {
    throw Error('SOURCE_STORE_CHAIN');
  }
  if (payload.schema === 'theseus.dreaming-worker.source-no-work-receipt.v1') {
    const noWork = z.object({
      schema: z.literal('theseus.dreaming-worker.source-no-work-receipt.v1'),
      previousCheckpoint: fingerprint, task: text, analysisVersion: text,
      handoff: z.object({
        provider: text, scope: text,
        previous_membership: z.object({ snapshot_sha256: z.string() }).passthrough(),
        catalog: z.array(z.object({ provider: text, shard_id: text, generation_id: z.string() }).strict()),
      }).passthrough(),
      reason: z.literal('VERIFIED_EMPTY_SESSION_DELTA'), attemptedPasses: z.literal(0),
      receiptFingerprint: fingerprint,
    }).strict().parse(row.receipt);
    const handoff = decodeSourceHandoff(noWork.handoff, {
      provider: noWork.handoff.provider, scope: noWork.handoff.scope,
      previousSnapshotSha256: noWork.handoff.previous_membership.snapshot_sha256,
      catalog: noWork.handoff.catalog.map(r => ({ ...r, state: 'READY' as const })),
    });
    requireEmptyDelta(handoff);
  }
  // The full digest detects inconsistent storage; the producer is trusted,
  // not authenticated by this hash. New writes always derive from the builder.
  return row.receipt as Stored;
}

export function createPostgresSourceBatchStore(options: {
  connectionString: string; clientFactory?: LedgerPgClientFactory;
}) {
  const factory = options.clientFactory ?? (url => new Client({ connectionString: url }));
  async function withClient<T>(fn: (client: LedgerPgClient) => Promise<T>): Promise<T> {
    const client = factory(options.connectionString);
    try { await client.connect(); return await fn(client); }
    finally { await client.end(); }
  }
  const unknown = (): Result => ({ status: 'STORAGE_UNKNOWN', receipt: null });
  async function readChild(client: LedgerPgClient, chain: string, previous: string | null) {
    const { rows } = await client.query<Row>(
      'SELECT checkpoint_fingerprint,previous_checkpoint,receipt FROM dw_ledger.source_checkpoints WHERE chain_id=$1 AND previous_checkpoint IS NOT DISTINCT FROM $2',
      [chain, previous],
    );
    if (rows.length > 1) throw Error('SOURCE_STORE_FORK');
    return rows.length ? checkRow(rows[0], chain) : null;
  }
  async function readParent(client: LedgerPgClient, chain: string, previous: string) {
    const { rows } = await client.query<Row>(
      'SELECT checkpoint_fingerprint,previous_checkpoint,receipt FROM dw_ledger.source_checkpoints WHERE chain_id=$1 AND checkpoint_fingerprint=$2',
      [chain, previous],
    );
    if (rows.length > 1) throw Error('SOURCE_STORE_PARENT');
    return rows.length ? checkRow(rows[0], chain) : null;
  }

  // Same lock as normal work completion; use the same SQL connection for
  // verified completion reads. No new resource or connection pool.
  async function append(chain: string, previous: string | null,
    derive: (client: LedgerPgClient) => Promise<Stored | 'PENDING' | 'CONFLICT' | 'STORAGE_UNKNOWN'>): Promise<Result> {
    const attempt: { candidate: Stored | null } = { candidate: null };
    let already = false;
    try {
      const outcome = await withClient(async client => {
        await client.query('BEGIN');
        try {
          await client.query("SELECT pg_advisory_xact_lock(hashtext('dw_ledger:v1'))");
          const next = await derive(client);
          if (typeof next === 'string') { await client.query('ROLLBACK'); return next; }
          attempt.candidate = next;
          const existing = await readChild(client, chain, previous);
          if (existing) {
            if (existing.receiptFingerprint !== next.receiptFingerprint) {
              await client.query('ROLLBACK'); return 'CONFLICT' as const;
            }
            already = true;
          } else {
            await client.query(
              'INSERT INTO dw_ledger.source_checkpoints(chain_id,checkpoint_fingerprint,previous_checkpoint,receipt) VALUES ($1,$2,$3,$4::jsonb)',
              [chain,next.receiptFingerprint,previous,JSON.stringify(next)],
            );
          }
          await client.query('COMMIT');
          return null;
        } catch (error) {
          try { await client.query('ROLLBACK'); } catch { /* ambiguous outcome */ }
          throw error;
        }
      });
      if (outcome !== null) return { status: outcome, receipt: null };
    } catch {
      // Only a candidate derived within the transaction can be read back.
    }
    const expected = attempt.candidate;
    if (!expected) return unknown();
    try {
      const stored = await withClient(client => readChild(client, chain, previous));
      if (!stored || stored.receiptFingerprint !== expected.receiptFingerprint) return unknown();
      return { status: already ? 'ALREADY_ACKNOWLEDGED' : 'ACKNOWLEDGED', receipt: stored };
    } catch { return unknown(); }
  }

  async function readPlan(client: LedgerPgClient, chain: string, parent: Stored, key: string) {
    const { rows } = await client.query<PlanRow>(
      'SELECT plan_fingerprint,plan FROM dw_ledger.source_plans WHERE chain_id=$1 AND previous_checkpoint=$2 AND plan_fingerprint=$3',
      [chain,parent.receiptFingerprint,key],
    );
    if (rows.length > 1) throw Error('SOURCE_PLAN_DUPLICATE');
    return rows.length ? checkPlan(rows[0], chain, parent) : null;
  }

  async function readOrigin(client: LedgerPgClient, chain: string, workFingerprint: string) {
    const { rows } = await client.query<{
      chain_id: string; previous_checkpoint: string; plan_fingerprint: string;
    }>('SELECT chain_id,previous_checkpoint,plan_fingerprint FROM dw_ledger.source_work_origins WHERE work_fingerprint=$1', [workFingerprint]);
    if (rows.length !== 1 || rows[0].chain_id !== chain) throw Error('SOURCE_EXECUTION_ORIGIN_REQUIRED');
    const origin = rows[0];
    const originalParent = await readParent(client, chain, origin.previous_checkpoint);
    const original = originalParent && await readPlan(client, chain, originalParent, origin.plan_fingerprint);
    const matches = original?.work.filter(w => w.workFingerprint === workFingerprint);
    if (!matches || matches.length !== 1) throw Error('SOURCE_EXECUTION_ORIGIN_INVALID');
    return {
      pointer: { workFingerprint, previousCheckpoint: origin.previous_checkpoint, planFingerprint: origin.plan_fingerprint },
      work: matches[0],
    };
  }

  return {
    /** Explicit source-specific execution. Generic synthetic work is unchanged. */
    async runSelected(raw: BatchInput, sessionId: string, routes: Pilot2Route[]) {
      const input = structuredClone(raw);
      const { chain } = context(input);
      const { plan, prepared } = prepareSourceBatchExecution(input);
      const selected = prepared.find(entry => entry.provenance.session.session_id === sessionId);
      if (!selected) throw Error('SOURCE_EXECUTION_SELECTION');
      const ordinary = createPostgresWorkStore(options);
      return runDurablePilot2(selected.input, routes, {
        ...ordinary,
        async reserve(workFingerprint, ownerToken) {
          if (workFingerprint !== selected.workFingerprint) throw Error('SOURCE_EXECUTION_WORK');
          return withClient(async client => {
            await client.query('BEGIN');
            try {
              await client.query("SELECT pg_advisory_xact_lock(hashtext('dw_ledger:v1'))");
              const parent = await readParent(client, chain, plan.previousCheckpoint);
              if (!parent || await readChild(client, chain, plan.previousCheckpoint)
                || !await readPlan(client, chain, parent, plan.planFingerprint)) {
                throw Error('SOURCE_EXECUTION_PLAN_REQUIRED');
              }
              const scoped = createPostgresWorkStore({
                connectionString: options.connectionString,
                clientFactory: () => ({
                  connect: async () => undefined, end: async () => undefined,
                  query: (sql, values) => client.query(sql, values),
                }),
              });
              const acquired = await scoped.reserve(workFingerprint, ownerToken);
              if (acquired) {
                await client.query(
                  'INSERT INTO dw_ledger.source_work_origins(work_fingerprint,chain_id,previous_checkpoint,plan_fingerprint) VALUES ($1,$2,$3,$4)',
                  [workFingerprint,chain,plan.previousCheckpoint,plan.planFingerprint],
                );
              } else {
                await readOrigin(client, chain, workFingerprint);
              }
              await client.query('COMMIT');
              return acquired;
            } catch (error) {
              try { await client.query('ROLLBACK'); } catch { /* ambiguous outcome */ }
              throw error;
            }
          });
        },
      });
    },
    /** Same-plan synthetic pooled execution. New custody and its journal are
     * committed together. An alternative witness is not a partial takeover.
     */
    async runSelectedPooled(raw: BatchInput, sessionId: string, policy: Parameters<typeof runPooledDurablePilot2>[1]) {
      const input = structuredClone(raw);
      const { chain } = context(input);
      const { plan, prepared } = prepareSourceBatchExecution(input);
      const selected = prepared.find(entry => entry.provenance.session.session_id === sessionId);
      if (!selected) throw Error('SOURCE_EXECUTION_SELECTION');
      const expected = plan.work.find(work => work.workFingerprint === selected.workFingerprint);
      if (!expected) throw Error('SOURCE_EXECUTION_WORK');
      const clock = policy.clock;
      const journal = createPostgresPoolJournalStore(options, {
        cooldowns: {
          clock,
          async read(client, providers) {
            if (!providers.length) return [];
            // Derived only from the trusted journal writer, whose replay validates
            // event identity and provider scope. Not an account-wide rate limit.
            const { rows } = await client.query<{ provider: string; deadline: string }>(
              `SELECT j.entry #>> '{event,cooldown,key}' AS provider,
                MAX((j.entry #>> '{event,cooldown,notBeforeMs}')::bigint)::text AS deadline
              FROM dw_ledger.source_work_origins o
              JOIN dw_ledger.work_pool_journal j ON j.work_fingerprint=o.work_fingerprint
              WHERE o.chain_id=$1 AND o.previous_checkpoint=$2 AND o.plan_fingerprint=$3
                AND j.entry #>> '{event,kind}'='KNOWN_FAILURE'
                AND j.entry #>> '{event,code}'='RATE_LIMITED'
                AND j.entry #>> '{event,httpStatus}'='429'
                AND jsonb_typeof(j.entry #> '{event,retryAfterMs}')='number'
                AND j.entry #>> '{event,cooldown,scope}'='provider'
                AND j.entry #>> '{event,cooldown,key}'=ANY($4::text[])
                AND (j.entry #>> '{event,cooldown,notBeforeMs}')::bigint < 9007199254740991
              GROUP BY 1`, [chain,plan.previousCheckpoint,plan.planFingerprint,providers],
            );
            return rows.map(row => {
              const notBeforeMs=Number(row.deadline);
              if (!providers.includes(row.provider) || !Number.isSafeInteger(notBeforeMs) || notBeforeMs<0) {
                throw Error('SOURCE_POOL_COOLDOWN_READBACK');
              }
              return {scope:'provider' as const,key:row.provider,notBeforeMs};
            });
          },
        },
        async verify(client, ctx, current, operation) {
          if (ctx.workFingerprint !== expected.workFingerprint
            || ctx.requestFingerprint !== expected.requestFingerprint
            || ctx.evidenceFingerprint !== expected.evidenceFingerprint
            || ctx.request.packet.packetId !== expected.packetId) throw Error('SOURCE_EXECUTION_WORK');
          const parent = await readParent(client, chain, plan.previousCheckpoint);
          if (!parent || !await readPlan(client, chain, parent, plan.planFingerprint)
            || (operation !== 'read' && await readChild(client, chain, plan.previousCheckpoint))) {
            throw Error('SOURCE_EXECUTION_PLAN_REQUIRED');
          }
          if (current.status !== 'ABSENT') {
            const original = await readOrigin(client, chain, ctx.workFingerprint);
            if (original.pointer.previousCheckpoint !== plan.previousCheckpoint
              || original.pointer.planFingerprint !== plan.planFingerprint
              || sourceReceiptFingerprint(original.work) !== sourceReceiptFingerprint(expected)) {
              throw Error('SOURCE_POOL_ORIGIN_MISMATCH');
            }
          }
        },
        async bind(client, ctx) {
          await client.query(
            'INSERT INTO dw_ledger.source_work_origins(work_fingerprint,chain_id,previous_checkpoint,plan_fingerprint) VALUES ($1,$2,$3,$4)',
            [ctx.workFingerprint,chain,plan.previousCheckpoint,plan.planFingerprint],
          );
        },
      });
      return runPooledDurablePilot2(selected.input, policy, journal,
        createPostgresPooledCompletionStore(options, selected.input));
    },
    /** Stage metadata before execution. No inference or progress advancement. */
    async stage(raw: BatchInput): Promise<PlanResult> {
      const input = structuredClone(raw);
      const { chain, handoff } = context(input);
      const plan = prepareSourceBatchPlan(input);
      const previous = plan.previousCheckpoint;
      let already = false;
      let attempted = false;
      const unknown = (): PlanResult => ({ status: 'STORAGE_UNKNOWN', plan: null });
      try {
        const outcome = await withClient(async client => {
          await client.query('BEGIN');
          try {
            await client.query("SELECT pg_advisory_xact_lock(hashtext('dw_ledger:v1'))");
            const parent = await readParent(client, chain, previous);
            if (!parent || sourceReceiptFingerprint(parentMembership(parent)) !== sourceReceiptFingerprint(handoff.previous_membership)) {
              await client.query('ROLLBACK'); return 'CONFLICT' as const;
            }
            const existing = await readPlan(client, chain, parent, plan.planFingerprint);
            if (existing) already = true;
            else {
              if (await readChild(client, chain, previous)) {
                await client.query('ROLLBACK'); return 'CONFLICT' as const;
              }
              attempted = true;
              await client.query(
                'INSERT INTO dw_ledger.source_plans(chain_id,previous_checkpoint,plan_fingerprint,plan) VALUES ($1,$2,$3,$4::jsonb)',
                [chain,previous,plan.planFingerprint,JSON.stringify(plan)],
              );
            }
            await client.query('COMMIT');
            return null;
          } catch (error) {
            try { await client.query('ROLLBACK'); } catch { /* ambiguous outcome */ }
            throw error;
          }
        });
        if (outcome !== null) return { status: outcome, plan: null };
      } catch {
        if (!attempted && !already) return unknown();
      }
      try {
        const stored = await withClient(async client => {
          const parent = await readParent(client, chain, previous);
          return parent ? readPlan(client, chain, parent, plan.planFingerprint) : null;
        });
        return stored ? { status: already ? 'ALREADY_STAGED' : 'STAGED', plan: stored } : unknown();
      } catch { return unknown(); }
    },
    /** Lookup historical or pending witnesses, not a permission to resume them.
     * Errors and missing parent throw; an empty array means observed no plans.
     */
    async readPlans(raw: Intent, previousRaw: string, limitRaw: number): Promise<Plan[]> {
      const { chain } = context(raw);
      const previous = fingerprint.parse(previousRaw);
      const limit = z.number().int().min(1).max(100).parse(limitRaw);
      return withClient(async client => {
        const parent = await readParent(client, chain, previous);
        if (!parent) throw Error('SOURCE_PLAN_PARENT_MISSING');
        const { rows } = await client.query<PlanRow>(
          'SELECT plan_fingerprint,plan FROM dw_ledger.source_plans WHERE chain_id=$1 AND previous_checkpoint=$2 ORDER BY plan_fingerprint LIMIT $3',
          [chain,previous,limit+1],
        );
        if (rows.length > limit) throw Error('SOURCE_PLAN_LIMIT');
        return rows.map(row => checkPlan(row,chain,parent));
      });
    },
    /** Explicit trusted bootstrap, never inferred from an empty query. */
    async initialize(raw: Intent): Promise<Result> {
      const { chain, root } = context(structuredClone(raw));
      return append(chain, null, async () => root);
    },
    /** Explicit trusted synthetic no-work disposition, never inferred from
     * an empty retrieval. Existing handoff custody remains caller-owned. */
    async acknowledgeNoWork(raw: Intent & { previousCheckpoint: string }): Promise<Result> {
      const input = structuredClone(raw);
      const { chain, handoff } = context(input);
      requireEmptyDelta(handoff);
      const previous = fingerprint.parse(input.previousCheckpoint);
      return append(chain, previous, async client => {
        const parent = await readParent(client, chain, previous);
        if (!parent || sourceReceiptFingerprint(parentMembership(parent)) !== sourceReceiptFingerprint(handoff.previous_membership)) {
          return 'CONFLICT';
        }
        const pending = await client.query(
          'SELECT 1 FROM dw_ledger.source_plans WHERE chain_id=$1 AND previous_checkpoint=$2 LIMIT 1',
          [chain, previous],
        );
        if (pending.rows.length) return 'PENDING';
        const payload = {
          schema: 'theseus.dreaming-worker.source-no-work-receipt.v1' as const,
          previousCheckpoint: previous, task: input.task, analysisVersion: input.analysisVersion,
          handoff, reason: 'VERIFIED_EMPTY_SESSION_DELTA' as const, attemptedPasses: 0 as const,
        };
        return { ...payload, receiptFingerprint: sourceReceiptFingerprint(payload) };
      });
    },
    async acknowledge(raw: BatchInput): Promise<Result> {
      const input = structuredClone(raw);
      const { chain, handoff } = context(input);
      const previous = fingerprint.parse(input.previousCheckpoint);
      return append(chain, previous, async client => {
        const parent = await readParent(client, chain, previous);
        if (!parent) return 'CONFLICT';
        const membership = parentMembership(parent);
        if (sourceReceiptFingerprint(membership) !== sourceReceiptFingerprint(handoff.previous_membership)) return 'CONFLICT';
        const reader = createPostgresWorkStore({
          connectionString: options.connectionString,
          clientFactory: () => ({
            connect: async () => undefined, end: async () => undefined,
            query: (sql, values) => client.query(sql, values),
          }),
        });
        const result = await prepareSourceBatchReceipt(input, reader);
        if (!result.receipt) return result.status === 'PENDING' ? 'PENDING' : 'STORAGE_UNKNOWN';
        const current = prepareSourceBatchPlan(input);
        if (!await readPlan(client, chain, parent, current.planFingerprint)) return 'STORAGE_UNKNOWN';
        const origins: OriginPointer[] = [];
        for (const item of result.receipt.work) {
          const original = await readOrigin(client, chain, item.workFingerprint);
          const completion = await readVerifiedCompletion(reader, item.workFingerprint);
          if (!completion || completion.projectionFingerprint !== item.completionFingerprint
            || completion.checkpoint.requestFingerprint !== original.work.requestFingerprint
            || item.originalPacketId !== original.work.packetId
            || completion.records.some(record => record.origin.packetId !== original.work.packetId
              || record.origin.evidenceFingerprint !== original.work.evidenceFingerprint
              || record.origin.requestFingerprint !== original.work.requestFingerprint)) {
            return 'STORAGE_UNKNOWN';
          }
          origins.push(original.pointer);
        }
        const { receiptFingerprint: _candidateFingerprint, ...candidate } = result.receipt;
        const payload = {
          ...candidate,
          schema: 'theseus.dreaming-worker.source-batch-receipt.v2' as const,
          currentPlanFingerprint: current.planFingerprint, origins,
        };
        return { ...payload, receiptFingerprint: sourceReceiptFingerprint(payload) };
      });
    },
    /** Returns the observed chain tip; absence is not permission to bootstrap. */
    async readTip(raw: Intent): Promise<Stored | null> {
      const { chain } = context(raw);
      return withClient(async client => {
        const { rows } = await client.query<Row>(
          `SELECT p.checkpoint_fingerprint,p.previous_checkpoint,p.receipt
             FROM dw_ledger.source_checkpoints p WHERE p.chain_id=$1
             AND NOT EXISTS (SELECT 1 FROM dw_ledger.source_checkpoints c
               WHERE c.chain_id=p.chain_id AND c.previous_checkpoint=p.checkpoint_fingerprint)`,
          [chain],
        );
        if (rows.length > 1) throw Error('SOURCE_STORE_FORK');
        return rows.length ? checkRow(rows[0], chain) : null;
      });
    },
  };
}
