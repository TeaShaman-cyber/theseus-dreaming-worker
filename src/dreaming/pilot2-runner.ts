import { createHash } from 'node:crypto';

import { runPilot0 } from './dry-run.ts';
import {
  pilot1RequestFingerprint,
  runPilot1,
  type Pilot1Inference,
  type Pilot1Request,
  type Pilot1Result,
} from './pilot1-runner.ts';
import type { ProposalSet } from './proposal-schema.ts';

export type Pilot2Route = {
  id: string;
  provider: string;
  model: string;
  modelFamily: string;
  infer: Pilot1Inference;
};

export type Pilot2PassFailureCode =
  | 'TIMEOUT_UNKNOWN_PROVIDER_STATE'
  | 'OUTPUT_BUDGET_EXHAUSTED'
  | 'TRUNCATED_OUTPUT'
  | 'EMPTY_FINAL_CONTENT'
  | 'JSON_VALIDATE_FAILED'
  | 'INVALID_JSON'
  | 'INVALID_SCHEMA'
  | 'PROVENANCE_REJECTED'
  | 'POLICY_VIOLATION'
  | 'INFERENCE_FAILED';

export type Pilot2PassFailure = {
  code: Pilot2PassFailureCode;
  message: string;
};

export type Pilot2RecoveryClassification =
  | 'UNSTRUCTURED_COMPLETE'
  | 'SCHEMA_MISMATCH_COMPLETE'
  | 'SEMANTIC_INVALID'
  | 'TRUNCATED_OUTPUT';

export type Pilot2Recovery = {
  classification: Pilot2RecoveryClassification;
  serializerEligible: boolean;
  rawOutputFingerprint: string;
  rawModelOutput: string | null;
};

type Pilot1ProposedResult = Extract<Pilot1Result, { outcome: 'PROPOSED' }>;

export type Pilot2PassSuccess = {
  status: 'SUCCESS';
  route: Omit<Pilot2Route, 'infer'>;
  proposalSet: ProposalSet;
  rawModelOutput: string;
  receipt: Pilot1ProposedResult['receipt'];
};

export type Pilot2ObservedInference = {
  provider: string;
  model: string;
  finishReason?: string;
};

export type Pilot2PassFailed = {
  status: 'FAILED';
  route: Omit<Pilot2Route, 'infer'>;
  observed: Pilot2ObservedInference | null;
  failure: Pilot2PassFailure;
  recovery: Pilot2Recovery | null;
};

export type Pilot2Pass = Pilot2PassSuccess | Pilot2PassFailed;

export type Pilot2Comparison = {
  mode: 'EXACT_STRUCTURED_MATCH_V1';
  sharedProposalFingerprints: string[];
  passAOnlyProposalFingerprints: string[];
  passBOnlyProposalFingerprints: string[];
  semanticRelation: 'UNRESOLVED_WITHOUT_CRITIQUE';
};

export type Pilot2TerminalFailure =
  | {
      code: 'INDEPENDENCE_NOT_ESTABLISHED';
      message: string;
    }
  | {
      code: 'ROUTE_PLAN_INVALID';
      message: string;
    }
  | {
      code: 'NO_VALID_PERSPECTIVES';
      message: string;
    };

export type Pilot2Receipt = {
  schema: 'theseus.dreaming-worker.pilot2-receipt.v1';
  scope: Pilot1Request['scope'];
  packetId: string;
  evidenceFingerprint: string;
  requestFingerprint: string;
  evidenceCount: number;
  plannedPasses: 2;
  attemptedPasses: number;
  validPasses: number;
  failedPasses: number;
  confirmedExternalModelCalls: number;
  unresolvedExternalCallAttempts: number;
  canonicalWrites: 0;
  memoryUsed: false;
  independence: 'NOT_EVALUATED' | 'CONFIGURED_DISTINCT' | 'REJECTED_SAME_FAMILY';
};

export type Pilot2Result = {
  outcome: 'NO_DATA' | 'COMPLETE' | 'PARTIAL' | 'FAIL_CLOSED';
  passes: Pilot2Pass[];
  comparison: Pilot2Comparison | null;
  terminalFailure: Pilot2TerminalFailure | null;
  receipt: Pilot2Receipt;
};

function validateRequest(request: Pilot1Request): void {
  if (!['SYNTHETIC_FIXTURE', 'PUBLICATION_SAFE'].includes(request.scope)) {
    throw new Error(`PILOT2_SCOPE_REJECTED: ${String(request.scope)}`);
  }

  if (!request.task?.trim()) {
    throw new Error('PILOT2_TASK_REQUIRED');
  }
}

function publicRoute(route: Pilot2Route): Omit<Pilot2Route, 'infer'> {
  return {
    id: route.id,
    provider: route.provider,
    model: route.model,
    modelFamily: route.modelFamily,
  };
}

function normalizeFamily(value: string): string {
  // Stryker disable next-line MethodExpression: lower/upper normalization is equivalent because both family IDs are normalized before equality comparison.
  return value.trim().toLowerCase();
}

function routePlanFailure(routes: Pilot2Route[]): Pilot2TerminalFailure | null {
  if (routes.length !== 2) {
    return {
      code: 'ROUTE_PLAN_INVALID',
      message: `Pilot 2 requires exactly two routes; observed ${routes.length}`,
    };
  }

  for (const route of routes) {
    if (
      !route.id?.trim() ||
      !route.provider?.trim() ||
      !route.model?.trim() ||
      !route.modelFamily?.trim()
    ) {
      return {
        code: 'ROUTE_PLAN_INVALID',
        message: 'Pilot 2 routes require non-empty id/provider/model/modelFamily',
      };
    }
  }

  const [first, second] = routes;
  if (normalizeFamily(first.modelFamily) === normalizeFamily(second.modelFamily)) {
    return {
      code: 'INDEPENDENCE_NOT_ESTABLISHED',
      message: `Pilot 2 requires distinct configured model families; both routes declare ${first.modelFamily}`,
    };
  }

  return null;
}

function classifyFailure(error: unknown): Pilot2PassFailure {
  const message = error instanceof Error ? error.message : String(error);

  if (message.startsWith('PILOT2_OUTPUT_BUDGET_EXHAUSTED')) {
    return { code: 'OUTPUT_BUDGET_EXHAUSTED', message };
  }
  if (message.startsWith('PILOT2_EMPTY_FINAL_CONTENT')) {
    return { code: 'EMPTY_FINAL_CONTENT', message };
  }
  if (message.includes('PILOT1_OUTPUT_TRUNCATED')) {
    return { code: 'TRUNCATED_OUTPUT', message };
  }
  if (/json_validate_failed/i.test(message)) {
    return { code: 'JSON_VALIDATE_FAILED', message };
  }
  if (message.includes('PILOT1_PROPOSAL_JSON_INVALID')) {
    return { code: 'INVALID_JSON', message };
  }
  if (message.includes('PILOT1_PROPOSAL_SCHEMA_INVALID')) {
    return { code: 'INVALID_SCHEMA', message };
  }
  if (message.includes('PILOT1_PROVENANCE_REJECTED')) {
    return { code: 'PROVENANCE_REJECTED', message };
  }
  if (message.includes('PILOT1_POLICY_VIOLATION')) {
    return { code: 'POLICY_VIOLATION', message };
  }
  if (/timeout|timed out/i.test(message)) {
    return { code: 'TIMEOUT_UNKNOWN_PROVIDER_STATE', message };
  }

  return { code: 'INFERENCE_FAILED', message };
}

function classifyRecovery(
  failure: Pilot2PassFailure,
  rawModelOutput: string | null,
): Pilot2Recovery | null {
  if (!rawModelOutput?.trim()) return null;

  const rawOutputFingerprint =
    'sha256:' + createHash('sha256').update(rawModelOutput).digest('hex');

  if (failure.code === 'INVALID_JSON') {
    return {
      classification: 'UNSTRUCTURED_COMPLETE',
      serializerEligible: true,
      rawOutputFingerprint,
      rawModelOutput,
    };
  }

  if (failure.code === 'INVALID_SCHEMA') {
    return {
      classification: 'SCHEMA_MISMATCH_COMPLETE',
      serializerEligible: true,
      rawOutputFingerprint,
      rawModelOutput,
    };
  }

  if (failure.code === 'PROVENANCE_REJECTED') {
    return {
      classification: 'SEMANTIC_INVALID',
      serializerEligible: false,
      rawOutputFingerprint,
      rawModelOutput: null,
    };
  }

  if (failure.code === 'TRUNCATED_OUTPUT') {
    return {
      classification: 'TRUNCATED_OUTPUT',
      serializerEligible: false,
      rawOutputFingerprint,
      rawModelOutput: null,
    };
  }

  return null;
}

function proposalFingerprint(proposal: ProposalSet['proposals'][number]): string {
  return 'sha256:' + createHash('sha256').update(JSON.stringify(proposal)).digest('hex');
}

function comparePasses(
  first: Pilot2PassSuccess,
  second: Pilot2PassSuccess,
): Pilot2Comparison {
  const firstFingerprints = first.proposalSet.proposals.map(proposalFingerprint);
  const secondFingerprints = second.proposalSet.proposals.map(proposalFingerprint);
  const secondRemaining = [...secondFingerprints];
  const shared: string[] = [];
  const firstOnly: string[] = [];

  for (const fingerprint of firstFingerprints) {
    const index = secondRemaining.indexOf(fingerprint);
    if (index >= 0) {
      shared.push(fingerprint);
      secondRemaining.splice(index, 1);
    } else {
      firstOnly.push(fingerprint);
    }
  }

  return {
    mode: 'EXACT_STRUCTURED_MATCH_V1',
    sharedProposalFingerprints: shared,
    passAOnlyProposalFingerprints: firstOnly,
    passBOnlyProposalFingerprints: secondRemaining,
    semanticRelation: 'UNRESOLVED_WITHOUT_CRITIQUE',
  };
}

async function runPass(
  request: Pilot1Request,
  route: Pilot2Route,
): Promise<Pilot2Pass> {
  let observed: Pilot2ObservedInference | null = null;
  let rawModelOutput: string | null = null;

  try {
    const result = await runPilot1(request, async (innerRequest, correlation) => {
      const inference = await route.infer(innerRequest, correlation);
      rawModelOutput = inference.text ?? null;
      observed = {
        provider: inference.provider,
        model: inference.model,
        finishReason: inference.finishReason,
      };
      if (!inference.text?.trim()) {
        if (inference.finishReason === 'length') {
          throw new Error(
            `PILOT2_OUTPUT_BUDGET_EXHAUSTED: ${route.id} exhausted its output budget before producing usable final content`,
          );
        }
        throw new Error(
          `PILOT2_EMPTY_FINAL_CONTENT: ${route.id} returned no usable final content`,
        );
      }
      return inference;
    });

    // Pilot 2 runs this pass only after the same Pilot 0 gate accepted evidence,
    // so Pilot 1 cannot legitimately return NO_DATA for this unchanged request.
    const proposed = result as Extract<Pilot1Result, { outcome: 'PROPOSED' }>;

    return {
      status: 'SUCCESS',
      route: publicRoute(route),
      proposalSet: proposed.proposalSet,
      rawModelOutput: proposed.rawModelOutput,
      receipt: proposed.receipt,
    };
  } catch (error) {
    const failure = classifyFailure(error);
    return {
      status: 'FAILED',
      route: publicRoute(route),
      observed,
      failure,
      recovery: classifyRecovery(failure, rawModelOutput),
    };
  }
}

export async function runPilot2(
  request: Pilot1Request,
  routes: Pilot2Route[],
): Promise<Pilot2Result> {
  validateRequest(request);

  const gate = runPilot0(request.packet);
  const fullRequestFingerprint = pilot1RequestFingerprint(
    request.scope,
    request.task,
    gate.receipt.inputFingerprint,
  );

  const baseReceipt = {
    schema: 'theseus.dreaming-worker.pilot2-receipt.v1' as const,
    scope: request.scope,
    packetId: gate.receipt.packetId,
    evidenceFingerprint: gate.receipt.inputFingerprint,
    requestFingerprint: fullRequestFingerprint,
    evidenceCount: gate.receipt.evidenceCount,
    plannedPasses: 2 as const,
    canonicalWrites: 0 as const,
    memoryUsed: false as const,
  };

  if (gate.outcome === 'NO_DATA') {
    return {
      outcome: 'NO_DATA',
      passes: [],
      comparison: null,
      terminalFailure: null,
      receipt: {
        ...baseReceipt,
        attemptedPasses: 0,
        validPasses: 0,
        failedPasses: 0,
        confirmedExternalModelCalls: 0,
        unresolvedExternalCallAttempts: 0,
        independence: 'NOT_EVALUATED',
      },
    };
  }

  const planFailure = routePlanFailure(routes);
  if (planFailure) {
    return {
      outcome: 'FAIL_CLOSED',
      passes: [],
      comparison: null,
      terminalFailure: planFailure,
      receipt: {
        ...baseReceipt,
        attemptedPasses: 0,
        validPasses: 0,
        failedPasses: 0,
        confirmedExternalModelCalls: 0,
        unresolvedExternalCallAttempts: 0,
        independence:
          planFailure.code === 'INDEPENDENCE_NOT_ESTABLISHED'
            ? 'REJECTED_SAME_FAMILY'
            : 'NOT_EVALUATED',
      },
    };
  }

  const passes = await Promise.all([
    runPass(request, routes[0]),
    runPass(request, routes[1]),
  ]);
  const successes = passes.filter(
    (pass): pass is Pilot2PassSuccess => pass.status === 'SUCCESS',
  );
  const failedPasses = passes.length - successes.length;
  const attemptedPasses = 2;
  const confirmedExternalModelCalls = successes.reduce(
    (count, pass) => count + pass.receipt.externalModelCalls,
    0,
  );
  const unresolvedExternalCallAttempts = failedPasses;

  let outcome: Pilot2Result['outcome'];
  let terminalFailure: Pilot2TerminalFailure | null = null;

  if (successes.length === 2) {
    outcome = 'COMPLETE';
  } else if (successes.length === 1) {
    outcome = 'PARTIAL';
  } else {
    outcome = 'FAIL_CLOSED';
    terminalFailure = {
      code: 'NO_VALID_PERSPECTIVES',
      message: 'Accepted evidence produced zero valid independent perspectives',
    };
  }

  return {
    outcome,
    passes,
    comparison:
      successes.length === 2 ? comparePasses(successes[0], successes[1]) : null,
    terminalFailure,
    receipt: {
      ...baseReceipt,
      attemptedPasses,
      validPasses: successes.length,
      failedPasses,
      confirmedExternalModelCalls,
      unresolvedExternalCallAttempts,
      independence: 'CONFIGURED_DISTINCT',
    },
  };
}
