import { z } from 'zod';
import { decodeSourceHandoff } from './source-handoff.ts';
import { parseVerifiedSessionPage, verifySelectedSessionIndex } from './verified-session-work.ts';
import { prepareSourceBatchPlan, type BatchInput } from './source-batch-receipt.ts';

type AcquisitionInput = Omit<BatchInput, 'entries'> & {
  indexes: Pick<BatchInput['entries'][number], 'sessionId' | 'index'>[];
};
type BrowseRequest = {
  session_id: string; shard_id: string; generation_id: string;
  limit: number; max_chars: number; cursor?: string;
};
export type BrowseTransport = (request: BrowseRequest, signal: AbortSignal) => Promise<Response>;
const budgetSchema = z.object({
  maxRequests: z.number().int().min(1).max(10000),
  maxPageBytes: z.number().int().min(1).max(2000000),
  maxTotalBytes: z.number().int().min(1).max(32000000),
  timeoutMs: z.number().int().min(1).max(30000),
  pageMessages: z.number().int().min(1).max(100),
  pageChars: z.number().int().min(1).max(100000),
}).strict();
type Budget = z.input<typeof budgetSchema>;

function failure(code: string): never { throw Error('SOURCE_ACQUIRE_' + code); }

/** The deadline includes streaming and decoding, not merely response headers.
 * The injected transport must honor the abort signal for upstream cancellation.
 */
async function boundedPage(transport: BrowseTransport, request: BrowseRequest, limit: number, timeoutMs: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Response | undefined;
  let done = false;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(Error('SOURCE_ACQUIRE_TIMEOUT'));
      controller.abort();
    }, timeoutMs);
  });
  const read = async () => {
    response = await transport(request, controller.signal);
    if (controller.signal.aborted) {
      void response.body?.cancel().catch(() => {});
      return failure('TIMEOUT');
    }
    if (!response.ok || response.redirected || !response.body
      || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) return failure('TRANSPORT');
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const parts: string[] = [];
    let bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      if (controller.signal.aborted) return failure('TIMEOUT');
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) return failure('BYTE_BUDGET');
      parts.push(decoder.decode(chunk.value, { stream: true }));
    }
    parts.push(decoder.decode());
    done = true;
    return { raw: JSON.parse(parts.join('')) as unknown, bytes };
  };
  try { return await Promise.race([read(), deadline]); }
  finally {
    clearTimeout(timer);
    if (!done) {
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
      else if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
    }
    if (done) reader?.releaseLock();
  }
}

function nextCursor(page: ReturnType<typeof parseVerifiedSessionPage>, seen: Set<string>): string {
  const cursor = page.next_cursor, pos = page.next_position, last = page.messages.at(-1);
  if (!cursor || !pos || !last || seen.has(cursor) || !/^[\w-]+$/.test(cursor)
    || Buffer.from(cursor, 'base64url').toString('base64url') !== cursor) return failure('CURSOR');
  const parsed = z.object({
    v: z.literal(1), s: z.string(), shard: z.string(), g: z.string(),
    o: z.number().int(), mid: z.string(), offset: z.number().int(),
  }).strict().parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  if (parsed.s !== page.session_id || parsed.shard !== page.shard_id || parsed.g !== page.generation_id
    || parsed.o !== pos.ordinal || parsed.mid !== pos.message_id || parsed.offset !== pos.offset
    || pos.ordinal !== last.ordinal || pos.message_id !== last.message_id
    || pos.offset !== (last.complete_message ? 0 : last.text_offset + Array.from(last.text).length)) return failure('CURSOR');
  seen.add(cursor);
  return cursor;
}

/** Synthetic-only acquisition from independently supplied trusted indexes.
 * No default fetch, credential, retry, inference or storage side effect.
 */
export async function acquireSourceBatch(raw: AcquisitionInput, limits: Budget, transport: BrowseTransport): Promise<BatchInput> {
  const budget = budgetSchema.parse(limits);
  const { indexes, ...base } = structuredClone(raw);
  const candidate = decodeSourceHandoff(base.candidate, base.expected);
  const maxSessions = z.number().int().min(1).max(100).parse(base.maxSessions);
  z.string().regex(/^sha256:[0-9a-f]{64}$/).parse(base.previousCheckpoint);
  if (!candidate.scope.startsWith('synthetic:') || !candidate.selected.length
    || candidate.removed.length || candidate.selected.length > maxSessions
    || !Array.isArray(indexes) || indexes.length !== candidate.selected.length
    || typeof transport !== 'function') return failure('SELECTION');
  const byId = new Map(indexes.map(entry => [entry.sessionId, entry.index]));
  if (byId.size !== indexes.length) return failure('SELECTION');
  // Check the full selected set before any transport call.
  const selected = candidate.selected.map(item => {
    if (!byId.has(item.session_id)) return failure('SELECTION');
    const checked = verifySelectedSessionIndex({ ...base, candidate, sessionId: item.session_id, index: byId.get(item.session_id) });
    return checked;
  });
  let requests = 0, bytes = 0;
  const entries: BatchInput['entries'] = [];
  for (const checked of selected) {
    const { item, index, sessionId, bounds, selected: session } = checked;
    const pages: unknown[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    let chars = 0;
    for (;;) {
      if (requests >= budget.maxRequests || pages.length >= bounds.maxPages
        || bytes >= budget.maxTotalBytes || chars >= bounds.maxChars) return failure('BUDGET');
      const request: BrowseRequest = {
        session_id: sessionId, shard_id: item.shard_id, generation_id: item.generation_id,
        limit: Math.min(budget.pageMessages, bounds.maxMessages),
        max_chars: Math.min(budget.pageChars, bounds.maxChars - chars),
        ...(cursor ? { cursor } : {}),
      };
      requests++;
      const observed = await boundedPage(transport, request,
        Math.min(budget.maxPageBytes, budget.maxTotalBytes - bytes), budget.timeoutMs);
      bytes += observed.bytes;
      const page = parseVerifiedSessionPage(observed.raw);
      const pageChars = page.messages.reduce((sum, message) => sum + Array.from(message.text).length, 0);
      if (page.session_id !== sessionId || page.provider !== candidate.provider
        || page.shard_id !== item.shard_id || page.generation_id !== item.generation_id
        || page.session_title !== session.title || page.session_coverage !== session.coverage_state
        || page.queried_shards[0] !== item.shard_id || page.messages.length > request.limit
        || pageChars > request.max_chars) return failure('PAGE_BINDING');
      chars += pageChars;
      pages.push(page);
      if (!page.has_more) break;
      cursor = nextCursor(page, seen);
    }
    entries.push({ sessionId, index, pages });
  }
  const result: BatchInput = { ...base, candidate, entries };
  // Final ordered continuity, exact text hashes and complete work admission.
  prepareSourceBatchPlan(result);
  return result;
}
