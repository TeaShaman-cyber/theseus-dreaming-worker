import { validateWorkCompletion, type DurablePilot2Input, type WorkCompletion } from './durable-pilot2.ts';
import { preparePoolJournal, replayPoolJournal, type PoolJournalEntry } from './pool-attempt-journal.ts';
import { createProposalRecord } from './proposal-ledger.ts';
import { sha256Fingerprint } from './proposal-schema.ts';

export function buildPoolCompletion(input: DurablePilot2Input, entries: PoolJournalEntry[]): WorkCompletion {
  const ctx = preparePoolJournal(input);
  const state = replayPoolJournal(ctx, entries);
  if (state.unresolved || state.validated.length !== 2) throw Error('POOL_COMPLETION_INCOMPLETE');
  const observed = state.validated.map(({start,result}) => ({
    perspectiveId: ctx.workFingerprint + ':pass-' + (start.slot+1),
    provider: result.receipt.provider, model: result.receipt.model, finishReason: result.receipt.finishReason,
  }));
  const records = state.validated.flatMap(({start,result},i) => result.proposalSet.proposals.map(proposal =>
    createProposalRecord({proposal,origin:{packetId:result.receipt.packetId,
      evidenceFingerprint:ctx.evidenceFingerprint,requestFingerprint:ctx.requestFingerprint,
      perspectiveId:observed[i].perspectiveId,route:start.route}})));
  const payload = {schema:'theseus.dreaming-worker.work-completion.v1' as const,
    checkpoint:{schema:'theseus.dreaming-worker.checkpoint.v1' as const,workFingerprint:ctx.workFingerprint,
      requestFingerprint:ctx.requestFingerprint,resultFingerprint:state.tip},observed,records};
  return validateWorkCompletion({...payload,projectionFingerprint:sha256Fingerprint(JSON.stringify(payload))});
}
