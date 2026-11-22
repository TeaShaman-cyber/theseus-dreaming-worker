import { z } from 'zod';

import {
  critiqueArtifactJsonSchema,
  parseCritiqueArtifact,
  type CritiqueArtifact,
  type CritiqueInput,
} from './pilot2-critique.ts';

import {
  executeOpenAIChatTransport,
  ProviderAdapterError,
} from './openai-provider-adapter.ts';

const critiqueRouteSchema = z.object({
  id: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
  modelFamily: z.string().trim().min(1),
  baseURL: z.string().trim().url(),
  timeoutMs: z.number().finite().positive().optional(),
  maxOutputTokens: z.number().int().positive(),
  apiKey: z.string().min(1).optional(),
}).strict();

export type CritiqueProviderRouteConfig = z.infer<typeof critiqueRouteSchema>;

export type CritiqueFailureCode =
  | 'RATE_LIMITED'
  | 'TIMEOUT_UNKNOWN_PROVIDER_STATE'
  | 'EMPTY_FINAL_CONTENT'
  | 'OUTPUT_BUDGET_EXHAUSTED'
  | 'HTTP_ERROR'
  | 'MALFORMED_RESPONSE'
  | 'CRITIQUE_JSON_INVALID'
  | 'CRITIQUE_SCHEMA_INVALID'
  | 'CRITIQUE_PROPOSAL_REF_REJECTED'
  | 'CRITIQUE_EVIDENCE_REF_REJECTED';

type CritiqueReceipt = {
  schema: 'theseus.dreaming-worker.critique-live-receipt.v1';
  packetId: string;
  evidenceFingerprint: string;
  requestFingerprint: string;
  configuredRoute: {
    id: string;
    provider: string;
    model: string;
    modelFamily: string;
  };
  observedProvider?: string;
  observedModel?: string;
  providerState: 'UNKNOWN' | 'RESPONDED';
  finishReason?: string;
  bounds: {
    timeoutMs: number;
    maxOutputTokens: number;
  };
  externalModelCalls: 1;
  toolsUsed: 0;
  memoryUsed: false;
  canonicalWrites: 0;
};

export type LiveCritiqueResult =
  | {
      outcome: 'CRITIQUED';
      artifact: CritiqueArtifact;
      rawModelOutput: string;
      receipt: CritiqueReceipt;
    }
  | {
      outcome: 'FAILED';
      artifact: null;
      rawModelOutput: string | null;
      failure: { code: CritiqueFailureCode; message: string };
      receipt: CritiqueReceipt;
    };

function parseRoute(route: CritiqueProviderRouteConfig): CritiqueProviderRouteConfig {
  const parsed = critiqueRouteSchema.safeParse(route);
  if (!parsed.success) throw new Error('CRITIQUE_ROUTE_INVALID');
  return parsed.data;
}

function systemPrompt(): string {
  return [
    'Return exactly one JSON object and no surrounding prose or markdown.',
    'Compare the frozen perspectives; do not decide truth or choose a winner.',
    'Use only proposal and evidence references present in the supplied critique input.',
    'Keep authority exactly DERIVED_ONLY.',
    'Return an INSTANCE that validates against the following JSON Schema. Do not return the JSON Schema itself.',
    'The top-level output keys must be exactly schema, authority, and relations.',
    JSON.stringify(critiqueArtifactJsonSchema),
  ].join(' ');
}

function validationCode(error: unknown): CritiqueFailureCode | null {
  const message = error instanceof Error ? error.message : String(error);
  for (const code of [
    'CRITIQUE_JSON_INVALID',
    'CRITIQUE_SCHEMA_INVALID',
    'CRITIQUE_PROPOSAL_REF_REJECTED',
    'CRITIQUE_EVIDENCE_REF_REJECTED',
  ] as const) {
    if (message.startsWith(code)) return code;
  }
  return null;
}

export async function runLiveCritique(
  input: CritiqueInput,
  routeInput: CritiqueProviderRouteConfig,
): Promise<LiveCritiqueResult> {
  const route = parseRoute(routeInput);
  const timeoutMs = route.timeoutMs ?? 15_000;
  const configuredRoute = {
    id: route.id,
    provider: route.provider,
    model: route.model,
    modelFamily: route.modelFamily,
  };

  let providerState: CritiqueReceipt['providerState'] = 'UNKNOWN';
  let observedProvider: string | undefined;
  let observedModel: string | undefined;
  let finishReason: string | undefined;
  let rawModelOutput: string | null = null;

  const receipt = (): CritiqueReceipt => ({
    schema: 'theseus.dreaming-worker.critique-live-receipt.v1',
    packetId: input.packetId,
    evidenceFingerprint: input.evidenceFingerprint,
    requestFingerprint: input.requestFingerprint,
    configuredRoute,
    observedProvider,
    observedModel,
    providerState,
    finishReason,
    bounds: { timeoutMs, maxOutputTokens: route.maxOutputTokens },
    externalModelCalls: 1,
    toolsUsed: 0,
    memoryUsed: false,
    canonicalWrites: 0,
  });

  try {
    const transport = await executeOpenAIChatTransport({
      baseURL: route.baseURL,
      configuredProvider: route.provider,
      configuredModel: route.model,
      timeoutMs,
      maxOutputTokens: route.maxOutputTokens,
      apiKey: route.apiKey,
      responseFormat: 'json_object',
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: JSON.stringify(input) },
      ],
    });

    providerState = 'RESPONDED';
    observedProvider = transport.observedProvider;
    observedModel = transport.observedModel;
    finishReason = transport.finishReason;
    rawModelOutput = transport.text;

    try {
      const artifact = parseCritiqueArtifact(transport.text, input);
      return {
        outcome: 'CRITIQUED',
        artifact,
        rawModelOutput: transport.text,
        receipt: receipt(),
      };
    } catch (error) {
      const code = validationCode(error);
      if (!code) throw error;
      return {
        outcome: 'FAILED',
        artifact: null,
        rawModelOutput: transport.text,
        failure: { code, message: error instanceof Error ? error.message : String(error) },
        receipt: receipt(),
      };
    }
  } catch (error) {
    const transportFailure = error instanceof ProviderAdapterError ? error : null;
    if (transportFailure) providerState = transportFailure.providerState;

    const code: CritiqueFailureCode = transportFailure
      ? transportFailure.code === 'TIMEOUT'
        ? 'TIMEOUT_UNKNOWN_PROVIDER_STATE'
        : transportFailure.code === 'STREAM_ERROR'
          ? 'MALFORMED_RESPONSE'
          : transportFailure.code
      : 'HTTP_ERROR';

    return {
      outcome: 'FAILED',
      artifact: null,
      rawModelOutput,
      failure: {
        code,
        message: transportFailure?.message ?? code,
      },
      receipt: receipt(),
    };
  }
}
