import { Client } from 'pg';
import { z } from 'zod';
import { decodeSourceHandoff } from './source-handoff.ts';
import { prepareSourceBatchReceipt, sourceReceiptFingerprint, type BatchInput } from './source-batch-receipt.ts';
import { createPostgresWorkStore, type LedgerPgClient, type LedgerPgClientFactory } from './proposal-ledger-postgres.ts';

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
type Stored = Root | Receipt;
type Result =
  | { status: 'ACKNOWLEDGED' | 'ALREADY_ACKNOWLEDGED'; receipt: Stored }
  | { status: 'CONFLICT' | 'PENDING' | 'STORAGE_UNKNOWN'; receipt: null };
type Row = { checkpoint_fingerprint: string; previous_checkpoint: string | null; receipt: unknown };

function checkRow(row: Row, chain: string): Stored {
  const envelope = z.object({
    schema: z.enum(['theseus.dreaming-worker.source-root.v1', 'theseus.dreaming-worker.source-batch-receipt.v1']),
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

  return {
    /** Explicit trusted bootstrap, never inferred from an empty query. */
    async initialize(raw: Intent): Promise<Result> {
      const { chain, root } = context(structuredClone(raw));
      return append(chain, null, async () => root);
    },
    async acknowledge(raw: BatchInput): Promise<Result> {
      const input = structuredClone(raw);
      const { chain, handoff } = context(input);
      const previous = fingerprint.parse(input.previousCheckpoint);
      return append(chain, previous, async client => {
        const parent = await readParent(client, chain, previous);
        if (!parent) return 'CONFLICT';
        const membership = parent.schema === 'theseus.dreaming-worker.source-root.v1'
          ? parent.membership : parent.handoff.current_membership;
        if (sourceReceiptFingerprint(membership) !== sourceReceiptFingerprint(handoff.previous_membership)) return 'CONFLICT';
        const reader = createPostgresWorkStore({
          connectionString: options.connectionString,
          clientFactory: () => ({
            connect: async () => undefined, end: async () => undefined,
            query: (sql, values) => client.query(sql, values),
          }),
        });
        const result = await prepareSourceBatchReceipt(input, reader);
        return result.receipt ?? (result.status === 'PENDING' ? 'PENDING' : 'STORAGE_UNKNOWN');
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
