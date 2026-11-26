import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import type fixtureShape from '../../../test/fixtures/source-reader.json';
import { decodeSourceHandoff, type ExpectedSourceHandoff } from '../../dreaming/source-handoff.ts';
import {
  prepareSourceBatchExecution, prepareSourceBatchReceipt, type BatchInput,
} from '../../dreaming/source-batch-receipt.ts';
import {
  runDurablePilot2, validateWorkCompletion, type WorkCompletion, type WorkStore,
} from '../../dreaming/durable-pilot2.ts';
import { sha256Fingerprint } from '../../dreaming/proposal-schema.ts';
import type { Pilot2Route } from '../../dreaming/pilot2-runner.ts';

const fixedInput = (): BatchInput => {
  // The development service runs from the repository root; never accept a caller-supplied path.
  const fixture = JSON.parse(readFileSync('test/fixtures/source-reader.json', 'utf8')) as typeof fixtureShape;
  return {
    candidate: fixture.candidate,
    expected: fixture.expected as ExpectedSourceHandoff,
    entries: fixture.entries.map(e => ({ sessionId: e.session_id, index: e.index, pages: e.pages })),
    bounds: { maxPages: 20, maxChars: 1000, maxMessages: 50 },
    maxSessions: 2,
    task: 'Synthetic Studio source-batch preview.',
    analysisVersion: 'studio-preview-v1',
    previousCheckpoint: sha256Fingerprint('synthetic-studio-root'),
  };
};

const input = z.object({ fixture: z.literal('source-reader') }).strict();
const verified = z.object({ scope: z.literal('synthetic:chatgpt'), selected: z.number().int().min(1) }).strict();
const plan = z.object({ planFingerprint: z.string(), workFingerprints: z.array(z.string()) }).strict();
const analyzed = plan.extend({ completions: z.array(z.unknown()), syntheticCalls: z.number().int().nonnegative() }).strict();
const output = z.object({
  status: z.literal('RECEIPT_CANDIDATE'),
  storage: z.literal('IN_MEMORY_PREVIEW'),
  receiptFingerprint: z.string(),
  workCount: z.number().int(),
  syntheticCalls: z.number().int(),
  externalCalls: z.literal(0),
  checkpointAdvanced: z.literal(false),
}).strict();

const verifySource = createStep({
  id: 'verify-source',
  description: 'Decode the fixed synthetic source handoff; no source access.',
  inputSchema: input,
  outputSchema: verified,
  execute: async ({ inputData }) => {
    input.parse(inputData);
    const x = fixedInput();
    const handoff = decodeSourceHandoff(x.candidate, x.expected);
    return verified.parse({ scope: handoff.scope, selected: handoff.selected.length });
  },
});

const preparePlan = createStep({
  id: 'prepare-plan',
  description: 'Verify bounded evidence pages and derive metadata-only work identity.',
  inputSchema: verified,
  outputSchema: plan,
  execute: async () => {
    const result = prepareSourceBatchExecution(fixedInput()).plan;
    return { planFingerprint: result.planFingerprint, workFingerprints: result.work.map(w => w.workFingerprint) };
  },
});

const analyzeSelected = createStep({
  id: 'analyze-selected',
  description: 'Run the existing independent-pass kernel against synthetic adapters and an isolated in-memory store.',
  inputSchema: plan,
  outputSchema: analyzed,
  execute: async ({ inputData }) => {
    const { plan: expected, prepared } = prepareSourceBatchExecution(fixedInput());
    if (inputData.planFingerprint !== expected.planFingerprint
        || JSON.stringify(inputData.workFingerprints) !== JSON.stringify(expected.work.map(w => w.workFingerprint))) {
      throw Error('STUDIO_PREVIEW_PLAN_MISMATCH');
    }
    const reserved = new Map<string, string>();
    const completed = new Map<string, WorkCompletion>();
    const store: WorkStore = {
      async reserve(key, owner) {
        if (reserved.has(key)) return false;
        reserved.set(key, owner);
        return true;
      },
      async complete(owner, completion) {
        const key = completion.checkpoint.workFingerprint;
        if (reserved.get(key) !== owner || completed.has(key)) throw Error('STUDIO_PREVIEW_RESERVATION');
        completed.set(key, structuredClone(completion));
      },
      async readCompletion(key) { return structuredClone(completed.get(key) ?? null); },
    };
    let syntheticCalls = 0;
    const routes: Pilot2Route[] = ['preview-a', 'preview-b'].map(id => ({
      id, provider: 'synthetic', model: id, modelFamily: id,
      infer: async request => {
        syntheticCalls++;
        return {
          provider: 'synthetic', model: id, finishReason: 'stop',
          text: JSON.stringify({
            schema: 'theseus.dreaming-worker.proposals.v1',
            proposals: [{
              type: 'FACT', claim: 'Synthetic Studio preview observation.',
              source_refs: request.packet.evidence.map(e => ({ source_ref: e.sourceRef, evidence_hash: e.evidenceHash })),
            }],
          }),
        };
      },
    }));
    for (const work of prepared) {
      const result = await runDurablePilot2(work.input, routes, store);
      if (result.decision !== 'COMMITTED') throw Error('STUDIO_PREVIEW_' + result.decision);
    }
    return { ...inputData, completions: [...completed.values()], syntheticCalls };
  },
});

const verifyReceipt = createStep({
  id: 'verify-receipt',
  description: 'Validate the synthetic completion lineage; never acknowledge or advance a source checkpoint.',
  inputSchema: analyzed,
  outputSchema: output,
  execute: async ({ inputData }) => {
    const expected = prepareSourceBatchExecution(fixedInput()).plan;
    const completions = inputData.completions.map(validateWorkCompletion);
    const byKey = new Map(completions.map(c => [c.checkpoint.workFingerprint, c]));
    if (inputData.planFingerprint !== expected.planFingerprint
        || JSON.stringify(inputData.workFingerprints) !== JSON.stringify(expected.work.map(w => w.workFingerprint))
        || completions.length !== expected.work.length || byKey.size !== expected.work.length
        || inputData.syntheticCalls !== expected.work.length * 2) throw Error('STUDIO_PREVIEW_RECEIPT_MISMATCH');
    const result = await prepareSourceBatchReceipt(fixedInput(), {
      async readCompletion(key) { return byKey.get(key) ?? null; },
    });
    if (!result.receipt) throw Error('STUDIO_PREVIEW_' + result.status);
    return output.parse({
      status: result.status,
      storage: 'IN_MEMORY_PREVIEW',
      receiptFingerprint: result.receipt.receiptFingerprint,
      workCount: result.receipt.work.length,
      syntheticCalls: inputData.syntheticCalls,
      externalCalls: 0,
      checkpointAdvanced: result.receipt.checkpointAdvanced,
    });
  },
});

const sourceBatchPreview = createWorkflow({
  id: 'dreaming-source-preview',
  description: 'Development-only source batch preview. Fixed synthetic data; no external inference, durable database or checkpoint advancement.',
  inputSchema: input,
  outputSchema: output,
}).then(verifySource).then(preparePlan).then(analyzeSelected).then(verifyReceipt).commit();

export const developmentWorkflows = { 'dreaming-source-preview': sourceBatchPreview };
