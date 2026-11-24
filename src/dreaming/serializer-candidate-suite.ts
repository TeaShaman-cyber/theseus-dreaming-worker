import {
  runSerializerCandidateBenchmark,
  type SerializerCandidateConfig,
  type SerializerCandidateExecutor,
  type SerializerCandidateRunResult,
} from './serializer-benchmark-runner.ts';
import type { EvidencePacket } from './dry-run.ts';
import type { Pilot2RecoveryClassification } from './pilot2-runner.ts';

export type SerializerCandidateCorpusCase = {
  id: string;
  reasonerRaw: string;
  finishReason?: string;
  classification: Pilot2RecoveryClassification;
  serializerEligible: boolean;
  goldenOutput: string | null;
};

export type SerializerCandidateCorpus = {
  schema: 'theseus.dreaming-worker.serializer-candidate-corpus.v1';
  packet: EvidencePacket;
  cases: SerializerCandidateCorpusCase[];
};

export type SerializerSuiteRun = {
  caseId: string;
  iteration: number;
  result: SerializerCandidateRunResult;
};

type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type SerializerSuiteUsage =
  | { state: 'UNKNOWN'; modelCallRuns: number }
  | {
      state: 'PARTIAL';
      observed: UsageTotals;
      observedRuns: number;
      modelCallRuns: number;
    }
  | (UsageTotals & { state: 'COMPLETE' });

export type SerializerSuiteResult = {
  schema: 'theseus.dreaming-worker.serializer-candidate-suite.v1';
  corpusSchema: SerializerCandidateCorpus['schema'];
  candidate: SerializerCandidateConfig;
  repeat: number;
  runs: SerializerSuiteRun[];
  summary: {
    executorInvocations: number;
    candidateModelCalls: number;
    externalProviderCalls: number;
    exactGoldenMatches: number;
    schemaValidUnreviewed: number;
    provenanceRejected: number;
    goldenMismatches: number;
    notEligible: number;
    executionFailures: number;
    truncatedCandidates: number;
    completionUnknown: number;
    measurementInvalid: number;
    observedUsage: SerializerSuiteUsage;
  };
};

type SerializerSuiteOptions = {
  repeat: number;
  nowMs?: () => number;
};

function validateCorpus(
  corpus: SerializerCandidateCorpus,
  repeat: number,
): void {
  if (
    corpus.schema !== 'theseus.dreaming-worker.serializer-candidate-corpus.v1' ||
    !Number.isInteger(repeat) ||
    repeat <= 0 ||
    !Array.isArray(corpus.cases) ||
    corpus.cases.length === 0
  ) {
    throw new Error('SERIALIZER_SUITE_INVALID');
  }

  const ids = new Set<string>();
  for (const item of corpus.cases) {
    if (
      typeof item.id !== 'string' ||
      !item.id.trim() ||
      ids.has(item.id) ||
      typeof item.reasonerRaw !== 'string' ||
      !item.reasonerRaw.trim()
    ) {
      throw new Error('SERIALIZER_SUITE_INVALID');
    }
    ids.add(item.id);
  }
}

function fixtureFromCase(
  packet: EvidencePacket,
  item: SerializerCandidateCorpusCase,
) {
  return {
    id: item.id,
    packet,
    reasoner: {
      rawOutput: item.reasonerRaw,
      finishReason: item.finishReason,
      recovery: {
        classification: item.classification,
        serializerEligible: item.serializerEligible,
        rawModelOutput: item.serializerEligible ? item.reasonerRaw : null,
      },
    },
    goldenOutput: item.goldenOutput,
  };
}

function completeUsage(run: SerializerSuiteRun): UsageTotals | null {
  const usage = run.result.measurement.usage;
  if (
    usage == null ||
    typeof usage.inputTokens !== 'number' ||
    typeof usage.outputTokens !== 'number' ||
    typeof usage.totalTokens !== 'number'
  ) {
    return null;
  }
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}

function aggregateUsage(runs: SerializerSuiteRun[]): SerializerSuiteUsage {
  const modelCallRuns = runs.filter(run => run.result.candidateModelCalls === 1);
  const observed = modelCallRuns
    .map(completeUsage)
    .filter((usage): usage is UsageTotals => usage !== null);

  if (modelCallRuns.length === 0 || observed.length === 0) {
    return { state: 'UNKNOWN', modelCallRuns: modelCallRuns.length };
  }

  const totals = observed.reduce<UsageTotals>(
    (acc, usage) => {
      acc.inputTokens += usage.inputTokens;
      acc.outputTokens += usage.outputTokens;
      acc.totalTokens += usage.totalTokens;
      return acc;
    },
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );

  if (observed.length !== modelCallRuns.length) {
    return {
      state: 'PARTIAL',
      observed: totals,
      observedRuns: observed.length,
      modelCallRuns: modelCallRuns.length,
    };
  }

  return {
    state: 'COMPLETE',
    ...totals,
  };
}

export async function runSerializerCandidateSuite(
  corpus: SerializerCandidateCorpus,
  candidate: SerializerCandidateConfig,
  execute: SerializerCandidateExecutor,
  options: SerializerSuiteOptions,
): Promise<SerializerSuiteResult> {
  validateCorpus(corpus, options.repeat);

  const runs: SerializerSuiteRun[] = [];
  for (let iteration = 1; iteration <= options.repeat; iteration += 1) {
    for (const item of corpus.cases) {
      const result = await runSerializerCandidateBenchmark(
        fixtureFromCase(corpus.packet, item),
        candidate,
        execute,
        { nowMs: options.nowMs },
      );
      runs.push({ caseId: item.id, iteration, result });
    }
  }

  const countOutcome = (outcome: SerializerCandidateRunResult['outcome']) =>
    runs.filter(run => run.result.outcome === outcome).length;
  const countBenchmark = (outcome: string) =>
    runs.filter(run => run.result.benchmark?.outcome === outcome).length;

  return {
    schema: 'theseus.dreaming-worker.serializer-candidate-suite.v1',
    corpusSchema: corpus.schema,
    candidate,
    repeat: options.repeat,
    runs,
    summary: {
      executorInvocations: runs.reduce(
        (total, run) => total + run.result.executorInvocations,
        0,
      ),
      candidateModelCalls: runs.reduce(
        (total, run) => total + run.result.candidateModelCalls,
        0,
      ),
      externalProviderCalls: runs.reduce(
        (total, run) => total + run.result.externalProviderCalls,
        0,
      ),
      exactGoldenMatches: countBenchmark('EXACT_GOLDEN_MATCH'),
      schemaValidUnreviewed: countBenchmark('SCHEMA_VALID_UNREVIEWED'),
      provenanceRejected: countBenchmark('PROVENANCE_REJECTED'),
      goldenMismatches: countBenchmark('GOLDEN_MISMATCH'),
      notEligible: countOutcome('NOT_ELIGIBLE'),
      executionFailures: countOutcome('EXECUTION_FAILED'),
      truncatedCandidates: countOutcome('CANDIDATE_TRUNCATED'),
      completionUnknown: countOutcome('CANDIDATE_COMPLETION_UNKNOWN'),
      measurementInvalid: countOutcome('MEASUREMENT_INVALID'),
      observedUsage: aggregateUsage(runs),
    },
  };
}
