import {
  evaluateSerializerFixture,
  isSerializerFixtureEligible,
  type SerializerBenchmarkResult,
  type SerializerFixture,
} from './serializer-benchmark.ts';
import {
  proposalSetJsonSchema,
  sha256Fingerprint,
} from './proposal-schema.ts';
import type { Pilot1InferenceResult } from './pilot1-runner.ts';

export type SerializerCandidateKind = 'LOCAL_MODEL' | 'EXTERNAL_PROVIDER';
export type SerializerCandidateHost =
  | 'EXE_DEV'
  | 'GITHUB_RUNNER'
  | 'LOCAL_RUNTIME'
  | 'CLOUDFLARE'
  | 'OTHER';

export type SerializerCandidateConfig = {
  id: string;
  kind: SerializerCandidateKind;
  host: SerializerCandidateHost;
  model: string;
  provider?: string;
};

export type SerializerCandidateMeasurementInput = {
  coldStartMs?: number;
  peakRssBytes?: number;
  cost?: {
    amount: number;
    currency: string;
    source: string;
  };
  usage?: Pilot1InferenceResult['usage'];
};

export type SerializerCandidateExecution = {
  text: string;
  finishReason?: string;
  measurement?: SerializerCandidateMeasurementInput;
};

export type SerializerCandidateInput = {
  rawOutput: string;
  targetSchema: typeof proposalSetJsonSchema;
};

export type SerializerCandidateExecutor = (
  input: SerializerCandidateInput,
) => Promise<SerializerCandidateExecution>;

export type SerializerCandidateCost =
  | { state: 'UNKNOWN' }
  | {
      state: 'OBSERVED';
      amount: number;
      currency: string;
      source: string;
    };

export type SerializerCandidateMeasurement = {
  coldStartMs: number | null;
  peakRssBytes: number | null;
  cost: SerializerCandidateCost;
  usage: Pilot1InferenceResult['usage'] | null;
};

export type SerializerCandidateRunOutcome =
  | 'NOT_ELIGIBLE'
  | 'EXECUTION_FAILED'
  | 'MEASUREMENT_INVALID'
  | 'CANDIDATE_TRUNCATED'
  | 'CANDIDATE_COMPLETION_UNKNOWN'
  | 'EVALUATED';

export type SerializerCandidateRunFailure =
  | { code: 'CANDIDATE_EXECUTION_FAILED' }
  | { code: 'CANDIDATE_MEASUREMENT_INVALID' };

export type SerializerCandidateRunResult = {
  schema: 'theseus.dreaming-worker.serializer-candidate-run.v1';
  fixtureId: string;
  candidate: SerializerCandidateConfig;
  outcome: SerializerCandidateRunOutcome;
  executorInvocations: 0 | 1;
  candidateModelCalls: 0 | 1;
  externalProviderCalls: 0 | 1;
  retryCount: 0;
  wallTimeMs: number | null;
  candidateOutputFingerprint: string | null;
  benchmark: SerializerBenchmarkResult | null;
  measurement: SerializerCandidateMeasurement;
  failure: SerializerCandidateRunFailure | null;
  canonicalWrites: 0;
};

type RunnerOptions = {
  nowMs?: () => number;
};

const unknownMeasurement = (): SerializerCandidateMeasurement => ({
  coldStartMs: null,
  peakRssBytes: null,
  cost: { state: 'UNKNOWN' },
  usage: null,
});

function nonEmpty(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateCandidate(candidate: SerializerCandidateConfig): void {
  const hosts: SerializerCandidateHost[] = [
    'EXE_DEV',
    'GITHUB_RUNNER',
    'LOCAL_RUNTIME',
    'CLOUDFLARE',
    'OTHER',
  ];
  if (
    !nonEmpty(candidate.id) ||
    !nonEmpty(candidate.model) ||
    !hosts.includes(candidate.host) ||
    !['LOCAL_MODEL', 'EXTERNAL_PROVIDER'].includes(candidate.kind) ||
    (candidate.kind === 'EXTERNAL_PROVIDER' && !nonEmpty(candidate.provider)) ||
    (candidate.kind === 'LOCAL_MODEL' && candidate.provider !== undefined)
  ) {
    throw new Error('SERIALIZER_CANDIDATE_INVALID');
  }
}

function validMetric(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value >= 0);
}

function validUsage(usage: Pilot1InferenceResult['usage'] | undefined): boolean {
  if (usage === undefined) return true;
  return Object.values(usage).every(value => validMetric(value));
}

function normalizeMeasurement(
  measurement: SerializerCandidateMeasurementInput | undefined,
): SerializerCandidateMeasurement | null {
  if (!measurement) return unknownMeasurement();
  if (
    !validMetric(measurement.coldStartMs) ||
    !validMetric(measurement.peakRssBytes) ||
    !validUsage(measurement.usage)
  ) {
    return null;
  }

  let cost: SerializerCandidateCost = { state: 'UNKNOWN' };
  if (measurement.cost !== undefined) {
    if (
      !Number.isFinite(measurement.cost.amount) ||
      measurement.cost.amount < 0 ||
      !nonEmpty(measurement.cost.currency) ||
      !nonEmpty(measurement.cost.source)
    ) {
      return null;
    }
    cost = {
      state: 'OBSERVED',
      amount: measurement.cost.amount,
      currency: measurement.cost.currency,
      source: measurement.cost.source,
    };
  }

  return {
    coldStartMs: measurement.coldStartMs ?? null,
    peakRssBytes: measurement.peakRssBytes ?? null,
    cost,
    usage: measurement.usage ?? null,
  };
}

function measuredDuration(start: number, end: number): number | null {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

export async function runSerializerCandidateBenchmark(
  fixture: SerializerFixture,
  candidate: SerializerCandidateConfig,
  execute: SerializerCandidateExecutor,
  options: RunnerOptions = {},
): Promise<SerializerCandidateRunResult> {
  validateCandidate(candidate);
  const nowMs = options.nowMs ?? (() => performance.now());

  const base = {
    schema: 'theseus.dreaming-worker.serializer-candidate-run.v1' as const,
    fixtureId: fixture.id,
    candidate,
    retryCount: 0 as const,
    canonicalWrites: 0 as const,
  };

  if (!isSerializerFixtureEligible(fixture)) {
    return {
      ...base,
      outcome: 'NOT_ELIGIBLE',
      executorInvocations: 0,
      candidateModelCalls: 0,
      externalProviderCalls: 0,
      wallTimeMs: null,
      candidateOutputFingerprint: null,
      benchmark: null,
      measurement: unknownMeasurement(),
      failure: null,
    };
  }

  const startedAt = nowMs();
  let execution: SerializerCandidateExecution;
  try {
    execution = await execute({
      rawOutput: fixture.reasoner.rawOutput,
      targetSchema: proposalSetJsonSchema,
    });
  } catch {
    const wallTimeMs = measuredDuration(startedAt, nowMs());
    return {
      ...base,
      outcome: 'EXECUTION_FAILED',
      executorInvocations: 1,
      candidateModelCalls: 1,
      externalProviderCalls: candidate.kind === 'EXTERNAL_PROVIDER' ? 1 : 0,
      wallTimeMs,
      candidateOutputFingerprint: null,
      benchmark: null,
      measurement: unknownMeasurement(),
      failure: { code: 'CANDIDATE_EXECUTION_FAILED' },
    };
  }

  const wallTimeMs = measuredDuration(startedAt, nowMs());
  const candidateOutputFingerprint = sha256Fingerprint(execution.text);
  const measurement = normalizeMeasurement(execution.measurement);

  if (measurement === null || wallTimeMs === null) {
    return {
      ...base,
      outcome: 'MEASUREMENT_INVALID',
      executorInvocations: 1,
      candidateModelCalls: 1,
      externalProviderCalls: candidate.kind === 'EXTERNAL_PROVIDER' ? 1 : 0,
      wallTimeMs,
      candidateOutputFingerprint,
      benchmark: null,
      measurement: unknownMeasurement(),
      failure: { code: 'CANDIDATE_MEASUREMENT_INVALID' },
    };
  }

  const common = {
    ...base,
    executorInvocations: 1 as const,
    candidateModelCalls: 1 as const,
    externalProviderCalls: (candidate.kind === 'EXTERNAL_PROVIDER' ? 1 : 0) as 0 | 1,
    wallTimeMs,
    candidateOutputFingerprint,
    measurement,
    failure: null,
  };

  if (execution.finishReason === 'length') {
    return {
      ...common,
      outcome: 'CANDIDATE_TRUNCATED',
      benchmark: null,
    };
  }

  if (execution.finishReason !== 'stop') {
    return {
      ...common,
      outcome: 'CANDIDATE_COMPLETION_UNKNOWN',
      benchmark: null,
    };
  }

  return {
    ...common,
    outcome: 'EVALUATED',
    benchmark: evaluateSerializerFixture(fixture, execution.text),
  };
}
