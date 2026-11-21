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

type InternalPassResult = {
  pass: Pilot2Pass;
  attempted: boolean;
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function proposalFingerprint(proposal: ProposalSet['proposals'][number]): string {
  return `sha256:${createHash('sha256').update(canonicalJson(proposal)).digest('hex')}`;
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
): Promise<InternalPassResult> {
  let attempted = false;
  let observed: Pilot2ObservedInference | null = null;

  try {
    const result = await runPilot1(request, async (innerRequest, correlation) => {
      attempted = true;
      const inference = await route.infer(innerRequest, correlation);
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

    if (result.outcome !== 'PROPOSED') {
      throw new Error(
        `PILOT2_INTERNAL_NO_PROPOSAL: ${route.id} unexpectedly returned NO_DATA after accepted evidence`,
      );
    }

    return {
      attempted,
      pass: {
        status: 'SUCCESS',
        route: publicRoute(route),
        proposalSet: result.proposalSet,
        rawModelOutput: result.rawModelOutput,
        receipt: result.receipt,
      },
    };
  } catch (error) {
    return {
      attempted,
      pass: {
        status: 'FAILED',
        route: publicRoute(route),
        observed,
        failure: classifyFailure(error),
      },
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

  const [first, second] = await Promise.all([
    runPass(request, routes[0]),
    runPass(request, routes[1]),
  ]);

  const internalPasses = [first, second];
  const passes = internalPasses.map(item => item.pass);
  const successes = passes.filter(
    (pass): pass is Pilot2PassSuccess => pass.status === 'SUCCESS',
  );
  const failedPasses = passes.length - successes.length;
  const attemptedPasses = internalPasses.filter(item => item.attempted).length;
  const confirmedExternalModelCalls = successes.reduce(
    (count, pass) => count + pass.receipt.externalModelCalls,
    0,
  );
  const unresolvedExternalCallAttempts = internalPasses.filter(
    item => item.attempted && item.pass.status === 'FAILED',
  ).length;

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
