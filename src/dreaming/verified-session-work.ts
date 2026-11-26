import { z } from 'zod';
import { decodeSourceHandoff, type ExpectedSourceHandoff } from './source-handoff.ts';
import { sha256Fingerprint } from './proposal-schema.ts';
import type { DurablePilot2Input } from './durable-pilot2.ts';

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const unicode = z.string().refine(s => !/[\uD800-\uDFFF]/u.test(s));
const id = unicode.refine(s => s.trim().length > 0);
const ordinal = z.number().int().min(0).max(2147483647);
const coverage = z.enum(['COMPLETE_EXPOSED_CONVERSATION', 'PARTIAL_SESSION_SLICE']);
const currentness = z.literal('UNKNOWN_WITHOUT_SOURCE_WATERMARK');
const messageMetadata = {
  ordinal, message_id: id, role: id, search_class: z.enum(['dialogue', 'evidence', 'trace']),
  create_time: z.number().finite().nullable(),
};
const source = z.object({
  artifact_sha256: hash, member_name: id, page_position: ordinal,
  source_message_id: id.nullable(), source_object_sha256: hash,
}).strict();
const session = z.object({
  session_id: id, title: unicode, coverage_state: coverage, content_sha256: hash,
  messages: z.array(z.object({
    ...messageMetadata, text_sha256: hash, canonical_message_sha256: hash,
    sources: z.array(source).min(1),
  }).strict()),
}).strict();
const indexSchema = z.object({
  schema: z.literal('theseus.session-search-source-evidence-index.v1'),
  provider: id, shard_id: id, generation_id: hash, source_manifest_sha256: hash,
  membership_snapshot_sha256: hash, currentness, sessions: z.array(session).min(1),
}).strict();
const position = z.object({ ordinal, message_id: id, offset: ordinal }).strict();
const pageSchema = z.object({
  status: z.literal('OK'), provider: id, shard_id: id, generation_id: hash,
  session_id: id, session_title: unicode, session_coverage: coverage,
  generation_binding: z.literal('router_pinned_v1'),
  messages: z.array(z.object({
    ...messageMetadata, text: unicode, text_offset: ordinal,
    text_total_chars: ordinal, complete_message: z.boolean(),
  }).strict()).max(100),
  has_more: z.boolean(), next_position: position.nullable(),
  next_cursor: z.string().min(1).max(4096).nullable(),
  coverage_complete: z.boolean(), queried_shards: z.array(id).length(1),
  unavailable_shards: z.array(z.unknown()).length(0),
}).strict();
const options = z.object({
  sessionId: id, task: id, analysisVersion: id,
  bounds: z.object({
    maxPages: z.number().int().min(1).max(1000),
    maxChars: z.number().int().min(1).max(1000000),
    maxMessages: z.number().int().min(1).max(10000),
  }).strict(),
}).strict();
type Options = z.input<typeof options>;

const fail = (reason: string): never => { throw Error('VERIFIED_SESSION_' + reason); };
const identity = (value: unknown) => sha256Fingerprint(JSON.stringify(value));

type IndexInput = Options & {
  candidate: unknown; expected: ExpectedSourceHandoff; index: unknown;
};

export function parseVerifiedSessionPage(raw: unknown) {
  return pageSchema.parse(raw);
}

/** Pure index preflight for both acquisition and final page admission. */
export function verifySelectedSessionIndex(raw: IndexInput) {
  const { sessionId, task, analysisVersion, bounds } = options.parse({
    sessionId: raw.sessionId, task: raw.task, analysisVersion: raw.analysisVersion, bounds: raw.bounds,
  });
  const candidate = decodeSourceHandoff(raw.candidate, raw.expected);
  if (!candidate.scope.startsWith('synthetic:')) fail('SCOPE_UNSUPPORTED');
  const item = candidate.selected.find(row => row.session_id === sessionId);
  if (!item || candidate.previous_membership.accepted_set_sha256 === candidate.current_membership.accepted_set_sha256) {
    return fail('SELECTION');
  }
  const index = indexSchema.parse(raw.index);
  if (index.provider !== candidate.provider || index.shard_id !== item.shard_id
    || index.generation_id !== item.generation_id || index.source_manifest_sha256 !== item.source_manifest_sha256
    || index.membership_snapshot_sha256 !== candidate.current_membership.snapshot_sha256) fail('INDEX_BINDING');
  const ids = index.sessions.map(s => s.session_id);
  if (new Set(ids).size !== ids.length || ids.some(sid => !candidate.selected.some(row =>
    row.session_id === sid && row.shard_id === index.shard_id))) fail('INDEX_SELECTION');
  const selected = index.sessions.find(s => s.session_id === sessionId);
  if (!selected || selected.messages.length > bounds.maxMessages) return fail('MESSAGE_BUDGET_OR_SELECTION');
  const members = new Set(candidate.current_membership.members.map(m => m.artifact_sha256));
  const mids = new Set<string>();
  for (const [i, m] of selected.messages.entries()) {
    if (mids.has(m.message_id) || (i > 0 && selected.messages[i - 1].ordinal >= m.ordinal)) fail('MESSAGE_ORDER');
    mids.add(m.message_id);
    const refs = m.sources.map(s => JSON.stringify([s.artifact_sha256, s.member_name, s.page_position]));
    if (new Set(refs).size !== refs.length || m.sources.some(s => !members.has(s.artifact_sha256))) fail('SOURCE_MEMBERSHIP');
  }
  return { candidate, item, index, selected, sessionId, task, analysisVersion, bounds };
}

/** Verify already acquired pages under trusted synthetic custody. No read,
 * inference, permission or checkpoint write. Transport must bound acquisition
 * independently; these limits bound admission, not the HTTP response body.
 */
export function prepareVerifiedSessionWork(raw: IndexInput & { pages: unknown[] }) {
  const { candidate, item, index, selected, sessionId, task, analysisVersion, bounds } = verifySelectedSessionIndex(raw);
  if (!Array.isArray(raw.pages) || raw.pages.length < 1 || raw.pages.length > bounds.maxPages) fail('PAGE_BUDGET');
  const evidence: DurablePilot2Input['request']['packet']['evidence'] = [];
  const cursors = new Set<string>();
  let messageIndex = 0, offset = 0, totalChars = 0, textLength: number | null = null;
  let parts: string[] = [];
  for (const [p, rawPage] of raw.pages.entries()) {
    const page = parseVerifiedSessionPage(rawPage);
    const final = p === raw.pages.length - 1;
    if (page.provider !== index.provider || page.shard_id !== index.shard_id
      || page.generation_id !== index.generation_id || page.session_id !== sessionId
      || page.session_title !== selected.title || page.session_coverage !== selected.coverage_state
      || page.queried_shards[0] !== index.shard_id || page.has_more === final
      || page.coverage_complete !== (final && selected.coverage_state === 'COMPLETE_EXPOSED_CONVERSATION')) fail('PAGE_BINDING');
    if (page.messages.length === 0 && !(final && selected.messages.length === 0 && p === 0)) fail('EMPTY_PAGE');
    let last: z.infer<typeof position> | null = null;
    for (const m of page.messages) {
      const expected = selected.messages[messageIndex];
      if (!expected || m.ordinal !== expected.ordinal || m.message_id !== expected.message_id
        || m.role !== expected.role || m.search_class !== expected.search_class
        || m.create_time !== expected.create_time || m.text_offset !== offset
        || (textLength !== null && m.text_total_chars !== textLength)) fail('MESSAGE_BINDING');
      textLength = m.text_total_chars;
      const chars = Array.from(m.text).length;
      totalChars += chars;
      if (totalChars > bounds.maxChars || offset + chars > textLength
        || (chars === 0 && textLength !== 0) || m.complete_message !== (offset + chars === textLength)) fail('TEXT_BUDGET_OR_SEGMENT');
      parts.push(m.text);
      offset += chars;
      last = { ordinal: m.ordinal, message_id: m.message_id, offset: m.complete_message ? 0 : offset };
      if (m.complete_message) {
        const text = parts.join('');
        if (sha256Fingerprint(text).slice(7) !== expected.text_sha256) fail('TEXT_DIGEST');
        if (text.trim()) evidence.push({
          sourceRef: 'ss-message-v1:' + JSON.stringify([candidate.scope, candidate.provider, sessionId,
            m.message_id, m.role, m.search_class]),
          evidenceHash: 'sha256:' + expected.text_sha256, text,
        });
        messageIndex++;
        offset = 0; textLength = null; parts = [];
      } else if (m !== page.messages.at(-1)) fail('PARTIAL_NOT_LAST');
    }
    if (final) {
      if (page.next_cursor !== null || page.next_position !== null || textLength !== null
        || messageIndex !== selected.messages.length) fail('INCOMPLETE');
    } else {
      if (page.next_cursor === null || cursors.has(page.next_cursor) || !last
        || !page.next_position || last.ordinal !== page.next_position.ordinal
        || last.message_id !== page.next_position.message_id || last.offset !== page.next_position.offset
        || messageIndex === selected.messages.length) return fail('CURSOR');
      cursors.add(page.next_cursor);
    }
  }
  const provenance = {
    candidate_sha256: candidate.candidate_sha256, scope: candidate.scope, provider: index.provider,
    shard_id: index.shard_id, generation_id: index.generation_id,
    source_manifest_sha256: index.source_manifest_sha256, bundle_sha256: item.bundle_sha256,
    membership_snapshot_sha256: index.membership_snapshot_sha256, session: selected,
  };
  if (!evidence.length) return { status: 'NO_USABLE_EVIDENCE' as const, input: null, provenance };
  const acceptedSourceFingerprint = identity([
    'theseus.session-search-scoped-content-work.v1', candidate.scope, candidate.provider,
    sessionId, selected.title, selected.coverage_state,
    selected.messages.map(m => [m.ordinal, m.message_id, m.role, m.search_class,
      m.create_time, m.text_sha256, m.canonical_message_sha256]),
  ]);
  const input: DurablePilot2Input = {
    acceptedSourceFingerprint, analysisVersion,
    request: { scope: 'SYNTHETIC_FIXTURE', task, packet: {
      schema: 'theseus-evidence-packet-v1', packetId: identity([candidate.candidate_sha256, sessionId]),
      acceptedNewEvidence: true,
      coverage: { state: selected.coverage_state === 'COMPLETE_EXPOSED_CONVERSATION' ? 'COMPLETE' : 'PARTIAL',
        currentness: 'UNKNOWN' },
      evidence,
    } },
  };
  return { status: 'PREPARED' as const, input, provenance };
}
