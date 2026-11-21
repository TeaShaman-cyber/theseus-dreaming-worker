import { createHash } from 'node:crypto';

import { runPilot0, type EvidencePacket } from './dry-run.ts';
import { parseProposalSet, type ProposalSet } from './proposal-schema.ts';

export type Pilot1Scope = 'SYNTHETIC_FIXTURE' | 'PUBLICATION_SAFE';

export type Pilot1Request = {
  scope: Pilot1Scope;
  task: string;
  packet: EvidencePacket;
};

export type Pilot1InferenceResult = {
  text: string;
  provider: string;
  model: string;
  finishReason?: string;
  toolCalls?: unknown[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
  };
  runId?: string;
  traceId?: string;
  runtimeWitness?: {
    source: 'MASTRA_TRACE';
    modelInferences: number;
    toolCalls: number;
    memoryOperations: number;
    workspaceActions: number;
  };
};

export type Pilot1Inference = (request: Pilot1Request) => Promise<Pilot1InferenceResult>;

type Pilot1Receipt = {
  schema: 'theseus.dreaming-worker.pilot1-receipt.v1';
  scope: Pilot1Scope;
  packetId: string;
  evidenceFingerprint: string;
  requestFingerprint: string;
  evidenceCount: number;
  externalModelCalls: 0 | 1;
  toolsUsed: number;
  memoryUsed: false;
  canonicalWrites: 0;
  provider?: string;
  model?: string;
  finishReason?: string;
  usage?: Pilot1InferenceResult['usage'];
  runId?: string;
  traceId?: string;
  runtimeWitness: 'NOT_RUN' | 'CALLER_OBSERVED' | 'TRACE_VERIFIED';
  workspaceActionsObserved: number | null;
};

export type Pilot1Result =
  | {
      outcome: 'NO_DATA';
      proposalSet: null;
      rawModelOutput: null;
      receipt: Pilot1Receipt;
    }
  | {
      outcome: 'PROPOSED';
      proposalSet: ProposalSet;
      rawModelOutput: string;
      receipt: Pilot1Receipt;
    };

function validateRequest(request: Pilot1Request): void {
  if (!['SYNTHETIC_FIXTURE', 'PUBLICATION_SAFE'].includes(request.scope)) {
    throw new Error(`PILOT1_SCOPE_REJECTED: ${String(request.scope)}`);
  }

  if (!request.task?.trim()) {
    throw new Error('PILOT1_TASK_REQUIRED');
  }
}

function requestFingerprint(
  scope: Pilot1Scope,
  task: string,
  evidenceFingerprint: string,
): string {
  const canonical = JSON.stringify({
    scope,
    task,
    evidenceFingerprint,
  });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

export async function runPilot1(
  request: Pilot1Request,
  infer: Pilot1Inference,
): Promise<Pilot1Result> {
  validateRequest(request);

  const gate = runPilot0(request.packet);
  const fullRequestFingerprint = requestFingerprint(
    request.scope,
    request.task,
    gate.receipt.inputFingerprint,
  );

  const baseReceipt = {
    schema: 'theseus.dreaming-worker.pilot1-receipt.v1' as const,
    scope: request.scope,
    packetId: gate.receipt.packetId,
    evidenceFingerprint: gate.receipt.inputFingerprint,
    requestFingerprint: fullRequestFingerprint,
    evidenceCount: gate.receipt.evidenceCount,
    toolsUsed: 0,
    memoryUsed: false as const,
    canonicalWrites: 0 as const,
  };

  if (gate.outcome === 'NO_DATA') {
    return {
      outcome: 'NO_DATA',
      proposalSet: null,
      rawModelOutput: null,
      receipt: {
        ...baseReceipt,
        externalModelCalls: 0,
        runtimeWitness: 'NOT_RUN',
        workspaceActionsObserved: null,
      },
    };
  }

  const inference = await infer(request);
  const callerToolCalls = inference.toolCalls?.length ?? 0;
  const witness = inference.runtimeWitness;
  const witnessedToolCalls = witness?.toolCalls ?? 0;
  const toolsUsed = Math.max(callerToolCalls, witnessedToolCalls);

  if (witness && witness.modelInferences !== 1) {
    throw new Error(
      `PILOT1_POLICY_VIOLATION: observed ${witness.modelInferences} model inference(s); Pilot 1 requires exactly one`,
    );
  }

  if (toolsUsed > 0) {
    throw new Error(
      `PILOT1_POLICY_VIOLATION: observed ${toolsUsed} tool call(s); Pilot 1 requires zero tools`,
    );
  }

  const memoryOperations = witness?.memoryOperations ?? 0;
  if (memoryOperations > 0) {
    throw new Error(
      `PILOT1_POLICY_VIOLATION: observed ${memoryOperations} memory operation(s); Pilot 1 requires zero memory operations`,
    );
  }

  const externalModelCalls: 1 = 1;
  const proposalSet = parseProposalSet(inference.text, request.packet);

  return {
    outcome: 'PROPOSED',
    proposalSet,
    rawModelOutput: inference.text,
    receipt: {
      ...baseReceipt,
      externalModelCalls,
      toolsUsed,
      memoryUsed: false,
      runtimeWitness: witness ? 'TRACE_VERIFIED' : 'CALLER_OBSERVED',
      workspaceActionsObserved: witness?.workspaceActions ?? null,
      provider: inference.provider,
      model: inference.model,
      finishReason: inference.finishReason,
      usage: inference.usage,
      runId: inference.runId,
      traceId: inference.traceId,
    },
  };
}
