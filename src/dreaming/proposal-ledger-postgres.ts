import { Client } from 'pg';
import { buildPoolCompletion } from './pool-completion.ts';
import { validateWorkCompletion, type DurablePilot2Input, type WorkCompletion, type WorkStore } from './durable-pilot2.ts';
import { makePoolJournalEntry, poolJournalAdmission, preparePoolJournal, replayPoolJournal, type PoolJournalEvent } from './pool-attempt-journal.ts';

import {
  appendLedgerEvent,
  proposalLedgerEventSchema,
  type ProposalLedgerEvent,
} from './proposal-ledger.ts';

type QueryResultLike<Row = Record<string, unknown>> = { rows: Row[] };

export type LedgerPgClient = {
  connect(): Promise<unknown>;
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResultLike<Row>>;
  end(): Promise<void>;
};

export type LedgerPgClientFactory = (connectionString: string) => LedgerPgClient;

type PostgresProposalLedgerOptions = {
  connectionString: string;
  clientFactory?: LedgerPgClientFactory;
};

type LedgerRow = {
  event_seq: number | string;
  event_type: 'PROPOSAL' | 'SUPERSEDE';
  schema_name: string;
  authority: 'DERIVED_ONLY';
  record_id: string | null;
  proposal_fingerprint: string | null;
  packet_id: string | null;
  evidence_fingerprint: string | null;
  request_fingerprint: string | null;
  perspective_id: string | null;
  route_id: string | null;
  route_provider: string | null;
  route_model: string | null;
  route_model_family: string | null;
  proposal: unknown | null;
  event_id: string | null;
  superseded_record_id: string | null;
  replacement_record_id: string | null;
  reason: string | null;
};

const READ_EVENTS_SQL = `
SELECT * FROM (
  SELECT
    event_seq,
    'PROPOSAL'::text AS event_type,
    schema_name, authority,
    record_id, proposal_fingerprint,
    packet_id, evidence_fingerprint, request_fingerprint, perspective_id,
    route_id, route_provider, route_model, route_model_family, proposal,
    NULL::text AS event_id,
    NULL::text AS superseded_record_id,
    NULL::text AS replacement_record_id,
    NULL::text AS reason
  FROM dw_ledger.proposal_records
  UNION ALL
  SELECT
    event_seq,
    'SUPERSEDE'::text AS event_type,
    schema_name, authority,
    NULL::text AS record_id,
    NULL::text AS proposal_fingerprint,
    NULL::text AS packet_id,
    NULL::text AS evidence_fingerprint,
    NULL::text AS request_fingerprint,
    NULL::text AS perspective_id,
    NULL::text AS route_id,
    NULL::text AS route_provider,
    NULL::text AS route_model,
    NULL::text AS route_model_family,
    NULL::jsonb AS proposal,
    event_id, superseded_record_id, replacement_record_id, reason
  FROM dw_ledger.supersession_events
) AS ledger_events
ORDER BY event_seq ASC
`;

function defaultClientFactory(connectionString: string): LedgerPgClient {
  return new Client({ connectionString });
}

function requireText(value: string | null, field: string): string {
  if (value === null) throw new Error(`LEDGER_STORAGE_ROW_INVALID: ${field}`);
  return value;
}

function rowToEvent(row: LedgerRow): ProposalLedgerEvent {
  if (row.event_type === 'PROPOSAL') {
    return proposalLedgerEventSchema.parse({
      schema: row.schema_name,
      eventType: 'PROPOSAL',
      authority: row.authority,
      recordId: requireText(row.record_id, 'record_id'),
      proposalFingerprint: requireText(row.proposal_fingerprint, 'proposal_fingerprint'),
      origin: {
        packetId: requireText(row.packet_id, 'packet_id'),
        evidenceFingerprint: requireText(row.evidence_fingerprint, 'evidence_fingerprint'),
        requestFingerprint: requireText(row.request_fingerprint, 'request_fingerprint'),
        perspectiveId: requireText(row.perspective_id, 'perspective_id'),
        route: {
          id: requireText(row.route_id, 'route_id'),
          provider: requireText(row.route_provider, 'route_provider'),
          model: requireText(row.route_model, 'route_model'),
          modelFamily: requireText(row.route_model_family, 'route_model_family'),
        },
      },
      proposal: row.proposal,
    });
  }

  return proposalLedgerEventSchema.parse({
    schema: row.schema_name,
    eventType: 'SUPERSEDE',
    authority: row.authority,
    eventId: requireText(row.event_id, 'event_id'),
    supersededRecordId: requireText(row.superseded_record_id, 'superseded_record_id'),
    replacementRecordId: requireText(row.replacement_record_id, 'replacement_record_id'),
    reason: requireText(row.reason, 'reason'),
  });
}

async function readEventsWithClient(client: LedgerPgClient): Promise<ProposalLedgerEvent[]> {
  const result = await client.query<LedgerRow>(READ_EVENTS_SQL);
  let validated: ProposalLedgerEvent[] = [];
  for (const row of result.rows) {
    validated = appendLedgerEvent(validated, rowToEvent(row));
  }
  return validated;
}

async function insertEvent(client: LedgerPgClient, event: ProposalLedgerEvent): Promise<void> {
  if (event.eventType === 'PROPOSAL') {
    await client.query(
      `INSERT INTO dw_ledger.proposal_records (
        record_id, schema_name, authority, proposal_fingerprint,
        packet_id, evidence_fingerprint, request_fingerprint, perspective_id,
        route_id, route_provider, route_model, route_model_family,
        proposal_type, proposal
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14::jsonb
      )`,
      [
        event.recordId, event.schema, event.authority, event.proposalFingerprint,
        event.origin.packetId, event.origin.evidenceFingerprint,
        event.origin.requestFingerprint, event.origin.perspectiveId,
        event.origin.route.id, event.origin.route.provider,
        event.origin.route.model, event.origin.route.modelFamily,
        event.proposal.type, JSON.stringify(event.proposal),
      ],
    );
  } else {
    await client.query(
      `INSERT INTO dw_ledger.supersession_events (
        event_id, schema_name, authority,
        superseded_record_id, replacement_record_id, reason
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event.eventId, event.schema, event.authority,
        event.supersededRecordId, event.replacementRecordId, event.reason,
      ],
    );
  }
}

export function createPostgresProposalLedger(options: PostgresProposalLedgerOptions) {
  const clientFactory = options.clientFactory ?? defaultClientFactory;

  return {
    async readEvents(): Promise<ProposalLedgerEvent[]> {
      const client = clientFactory(options.connectionString);
      try {
        await client.connect();
        return await readEventsWithClient(client);
      } finally {
        await client.end();
      }
    },

    async appendEvent(eventInput: ProposalLedgerEvent): Promise<void> {
      const event = proposalLedgerEventSchema.parse(structuredClone(eventInput));
      const client = clientFactory(options.connectionString);
      let transactionStarted = false;
      try {
        await client.connect();
        await client.query('BEGIN');
        transactionStarted = true;
        await client.query("SELECT pg_advisory_xact_lock(hashtext('dw_ledger:v1'))");
        const existing = await readEventsWithClient(client);
        appendLedgerEvent(existing, event);

        await insertEvent(client, event);

        await client.query('COMMIT');
      } catch (error) {
        if (transactionStarted) {
          try {
            await client.query('ROLLBACK');
          } catch {
            // Preserve the original storage/validation failure.
          }
        }
        throw error;
      } finally {
        await client.end();
      }
    },
  };
}

// Work completion shares the existing ledger validation and insert path.
// The work key admits a single caller; its token is correlation, not an ACL.
export function createPostgresWorkStore(options: PostgresProposalLedgerOptions): WorkStore {
  return createWorkStore(options, null);
}

/** Exact original input is required; no generic completion can adopt a pool journal. */
export function createPostgresPooledCompletionStore(options: PostgresProposalLedgerOptions, raw: DurablePilot2Input): Pick<WorkStore, 'complete' | 'readCompletion'> {
  return createWorkStore(options, structuredClone(raw));
}

function createWorkStore(options: PostgresProposalLedgerOptions, poolInput: DurablePilot2Input | null): WorkStore {
  const clientFactory = options.clientFactory ?? defaultClientFactory;
  async function withClient<T>(action: (client: LedgerPgClient) => Promise<T>): Promise<T> {
    const client = clientFactory(options.connectionString);
    try {
      await client.connect();
      return await action(client);
    } finally {
      await client.end();
    }
  }

  return {
    async reserve(workFingerprint, ownerToken) {
      return withClient(async client => {
        const { rows } = await client.query<{ owner_token: string }>(
          'INSERT INTO dw_ledger.work_reservations (work_fingerprint, owner_token) VALUES ($1,$2) ON CONFLICT (work_fingerprint) DO NOTHING RETURNING owner_token',
          [workFingerprint, ownerToken],
        );
        if (rows.length === 0) return false;
        if (rows.length !== 1 || rows[0].owner_token !== ownerToken) throw Error('WORK_RESERVATION_RESPONSE_INVALID');
        return true;
      });
    },

    async complete(ownerToken, raw) {
      const completion = validateWorkCompletion(raw);
      const { checkpoint, observed, records, projectionFingerprint } = completion;
      await withClient(async client => {
        await client.query('BEGIN');
        try {
          await client.query("SELECT pg_advisory_xact_lock(hashtext('dw_ledger:v1'))");
          if (poolInput === null) {
            const { rows } = await client.query('SELECT 1 FROM dw_ledger.work_pool_journal WHERE work_fingerprint=$1 LIMIT 1', [checkpoint.workFingerprint]);
            if (rows.length) throw Error('WORK_POOL_CUSTODY_REQUIRED');
          } else {
            const context = preparePoolJournal(poolInput);
            if (context.workFingerprint !== checkpoint.workFingerprint) throw Error('POOL_COMPLETION_WORK_MISMATCH');
            const current = await readPoolWithClient(client, context);
            if (current.status !== 'JOURNAL' || current.ownerToken !== ownerToken || current.completionExists) {
              throw Error('POOL_COMPLETION_CUSTODY');
            }
            const exact = buildPoolCompletion(poolInput, current.state.entries);
            if (exact.projectionFingerprint !== projectionFingerprint) throw Error('POOL_COMPLETION_PROJECTION_MISMATCH');
          }
          let existing = await readEventsWithClient(client);
          for (const record of records) {
            existing = appendLedgerEvent(existing, record);
            await insertEvent(client, record);
          }
          await client.query(
            `INSERT INTO dw_ledger.work_completions (work_fingerprint, owner_token, request_fingerprint, result_fingerprint, projection_fingerprint, observed)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
            [checkpoint.workFingerprint, ownerToken, checkpoint.requestFingerprint, checkpoint.resultFingerprint, projectionFingerprint, JSON.stringify(observed)],
          );
          for (const [ordinal, record] of records.entries()) {
            await client.query('INSERT INTO dw_ledger.work_membership (work_fingerprint, ordinal, record_id) VALUES ($1,$2,$3)',
              [checkpoint.workFingerprint, ordinal, record.recordId]);
          }
          await client.query('COMMIT');
        } catch (error) {
          try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
          throw error;
        }
      });
    },

    async readCompletion(workFingerprint) {
      return withClient(async client => {
        // A single statement provides a consistent snapshot of header and membership.
        const { rows } = await client.query<{
          work_fingerprint: string; request_fingerprint: string; result_fingerprint: string;
          projection_fingerprint: string; observed: unknown; ordinal: number | null; record: LedgerRow | null;
        }>(
          `SELECT c.work_fingerprint, c.request_fingerprint, c.result_fingerprint,
            c.projection_fingerprint, c.observed, m.ordinal,
            CASE WHEN p.record_id IS NULL THEN NULL ELSE to_jsonb(p) END AS record
           FROM dw_ledger.work_completions c
           LEFT JOIN dw_ledger.work_membership m USING (work_fingerprint)
           LEFT JOIN dw_ledger.proposal_records p ON p.record_id=m.record_id
           WHERE c.work_fingerprint=$1 ORDER BY m.ordinal`,
          [workFingerprint],
        );
        if (rows.length === 0) return null;
        const first = rows[0];
        if (first.work_fingerprint !== workFingerprint) throw Error('WORK_READBACK_IDENTITY_MISMATCH');
        const records = rows.map((row, index) => {
          if (row.ordinal !== index || !row.record) throw Error('WORK_MEMBERSHIP_INVALID');
          return rowToEvent({ ...row.record, event_type: 'PROPOSAL' });
        });
        return validateWorkCompletion({
          schema: 'theseus.dreaming-worker.work-completion.v1',
          checkpoint: {
            schema: 'theseus.dreaming-worker.checkpoint.v1',
            workFingerprint: first.work_fingerprint,
            requestFingerprint: first.request_fingerprint,
            resultFingerprint: first.result_fingerprint,
          },
          observed: first.observed, records, projectionFingerprint: first.projection_fingerprint,
        });
      });
    },
  };
}

type PoolJournalContext = ReturnType<typeof preparePoolJournal>;
type PoolJournalRead =
  | { status: 'ABSENT' | 'LEGACY_UNRESOLVED' | 'COMPLETION_EXISTS' }
  | { status: 'JOURNAL'; ownerToken: string; completionExists: boolean; state: ReturnType<typeof replayPoolJournal> };

async function readPoolWithClient(client: LedgerPgClient, context: PoolJournalContext): Promise<PoolJournalRead> {
  const { rows } = await client.query<{
    owner_token: string; ordinal: number | null; entry: unknown | null; completion_exists: boolean;
  }>(`SELECT r.owner_token, j.ordinal, j.entry,
      EXISTS(SELECT 1 FROM dw_ledger.work_completions c WHERE c.work_fingerprint=r.work_fingerprint) AS completion_exists
      FROM dw_ledger.work_reservations r
      LEFT JOIN dw_ledger.work_pool_journal j
        ON j.work_fingerprint=r.work_fingerprint AND j.owner_token=r.owner_token
      WHERE r.work_fingerprint=$1 ORDER BY j.ordinal`, [context.workFingerprint]);
  if (!rows.length) return { status: 'ABSENT' };
  const first = rows[0];
  if (first.ordinal === null) {
    if (rows.length !== 1 || first.entry !== null) throw Error('POOL_JOURNAL_ROW_INVALID');
    return { status: first.completion_exists ? 'COMPLETION_EXISTS' : 'LEGACY_UNRESOLVED' };
  }
  if (rows.some((r,i) => r.ordinal !== i || r.entry === null || r.owner_token !== first.owner_token
    || r.completion_exists !== first.completion_exists)) throw Error('POOL_JOURNAL_ROW_INVALID');
  return { status: 'JOURNAL', ownerToken: first.owner_token, completionExists: first.completion_exists,
    state: replayPoolJournal(context, rows.map(r => r.entry)) };
}

/** Trusted application composition seam. Source-specific validation and
 * origin insertion use the journal's own transaction, not another client.
 * The callbacks do not confer external permission or define an ACL.
 */
export type PoolJournalSourceBinding = {
  verify(client: LedgerPgClient, context: PoolJournalContext, current: PoolJournalRead,
    operation: 'read' | 'admit' | 'append'): Promise<void>;
  bind(client: LedgerPgClient, context: PoolJournalContext): Promise<void>;
};

/** Append-only partial custody. No model invocation, takeover or completion. */
export function createPostgresPoolJournalStore(options: PostgresProposalLedgerOptions, source?: PoolJournalSourceBinding) {
  const clientFactory = options.clientFactory ?? defaultClientFactory;
  async function withClient<T>(action: (client: LedgerPgClient) => Promise<T>): Promise<T> {
    const client = clientFactory(options.connectionString);
    try {
      await client.connect();
      return await action(client);
    } finally {
      await client.end();
    }
  }
  async function transaction<T>(action: (client: LedgerPgClient) => Promise<T>): Promise<T> {
    return withClient(async client => {
      await client.query('BEGIN');
      try {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('dw_ledger:v1'))");
        const result = await action(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* preserve ambiguity */ }
        throw error;
      }
    });
  }
  async function readBound(client: LedgerPgClient, context: PoolJournalContext, operation: 'read' | 'admit' | 'append') {
    const current = await readPoolWithClient(client, context);
    await source?.verify(client, context, current, operation);
    return current;
  }
  const readContext = (context: PoolJournalContext) => withClient(client => readBound(client, context, 'read'));
  return {
    async read(raw: DurablePilot2Input) { return readContext(preparePoolJournal(raw)); },
    async admit(raw: DurablePilot2Input, maxAttempts: number, ownerToken: string) {
      const context = preparePoolJournal(raw);
      const first = makePoolJournalEntry(null, poolJournalAdmission(context, maxAttempts));
      await transaction(async client => {
        const existing = await readBound(client, context, 'admit');
        if (existing.status === 'JOURNAL') {
          if (existing.state.entries[0].entryFingerprint !== first.entryFingerprint) throw Error('POOL_JOURNAL_ADMISSION_CONFLICT');
          return;
        }
        if (existing.status !== 'ABSENT') return;
        const { rows } = await client.query<{owner_token: string}>(
          'INSERT INTO dw_ledger.work_reservations (work_fingerprint, owner_token) VALUES ($1,$2) ON CONFLICT (work_fingerprint) DO NOTHING RETURNING owner_token',
          [context.workFingerprint, ownerToken],
        );
        if (rows.length !== 1 || rows[0].owner_token !== ownerToken) throw Error('POOL_JOURNAL_RESERVATION_CONFLICT');
        await client.query('INSERT INTO dw_ledger.work_pool_journal(work_fingerprint,owner_token,ordinal,entry) VALUES ($1,$2,0,$3::jsonb)',
          [context.workFingerprint,ownerToken,JSON.stringify(first)]);
        await source?.bind(client, context);
      });
      const result = await readContext(context);
      if (result.status === 'ABSENT' || (result.status === 'JOURNAL'
        && result.state.entries[0].entryFingerprint !== first.entryFingerprint)) throw Error('POOL_JOURNAL_ADMISSION_READBACK');
      return result;
    },
    async append(raw: DurablePilot2Input, expectedTip: string, event: PoolJournalEvent) {
      const context = preparePoolJournal(raw);
      const entry = await transaction(async client => {
        const current = await readBound(client, context, 'append');
        if (current.status !== 'JOURNAL' || current.completionExists || current.state.tip !== expectedTip) {
          throw Error('POOL_JOURNAL_TIP_CONFLICT');
        }
        const next = makePoolJournalEntry(current.state.entries[current.state.entries.length - 1],event);
        replayPoolJournal(context,[...current.state.entries,next]);
        await client.query('INSERT INTO dw_ledger.work_pool_journal(work_fingerprint,owner_token,ordinal,entry) VALUES ($1,$2,$3,$4::jsonb)',
          [context.workFingerprint,current.ownerToken,next.ordinal,JSON.stringify(next)]);
        return next;
      });
      // A lost COMMIT acknowledgement never grants dispatch, even if a later
      // read shows START. Only a confirmed transaction plus exact readback does.
      const stored = await readContext(context);
      if (stored.status !== 'JOURNAL' || stored.completionExists || stored.state.tip !== entry.entryFingerprint) {
        throw Error('POOL_JOURNAL_APPEND_READBACK');
      }
      return stored.state;
    },
  };
}
