import { z } from 'zod';

import {
  critiqueArtifactJsonSchema,
  parseCritiqueArtifact,
  type CritiqueArtifact,
  type CritiqueInput,
} from './pilot2-critique.ts';

const critiqueRouteSchema = z.object({
  id: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
  modelFamily: z.string().trim().min(1),
  baseURL: z.string().trim().url(),
  timeoutMs: z.number().finite().positive().optional(),
  maxOutputTokens: z.number().int().positive(),
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

class CritiqueTransportError extends Error {
  readonly code: CritiqueFailureCode;

  constructor(code: CritiqueFailureCode, message: string) {
    super(message);
    this.name = 'CritiqueTransportError';
    this.code = code;
  }
}

function parseRoute(route: CritiqueProviderRouteConfig): CritiqueProviderRouteConfig {
  const parsed = critiqueRouteSchema.safeParse(route);
  if (!parsed.success) throw new Error('CRITIQUE_ROUTE_INVALID');
  return parsed.data;
}

function endpointFor(baseURL: string): string {
  const base = baseURL.replace(/\/+$/, '') + '/';
  return new URL('chat/completions', base).toString();
}

function observedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
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
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
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
    let response: Response;
    try {
      response = await fetch(endpointFor(route.baseURL), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: route.model,
          messages: [
            { role: 'system', content: systemPrompt() },
            { role: 'user', content: JSON.stringify(input) },
          ],
          max_tokens: route.maxOutputTokens,
          response_format: { type: 'json_object' },
          stream: false,
        }),
        signal: timeoutSignal,
      });
    } catch (error) {
      if (timeoutSignal.aborted || (error instanceof Error && error.name === 'TimeoutError')) {
        throw new CritiqueTransportError('TIMEOUT_UNKNOWN_PROVIDER_STATE', 'Critique provider request timed out');
      }
      throw new CritiqueTransportError('HTTP_ERROR', 'Critique provider request failed before response');
    }

    providerState = 'RESPONDED';
    if (response.status === 429) {
      throw new CritiqueTransportError('RATE_LIMITED', 'Critique provider rate limited the request');
    }
    if (!response.ok) {
      throw new CritiqueTransportError('HTTP_ERROR', `Critique provider returned HTTP ${response.status}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (timeoutSignal.aborted) {
        throw new CritiqueTransportError('TIMEOUT_UNKNOWN_PROVIDER_STATE', 'Critique provider response body timed out');
      }
      throw new CritiqueTransportError('MALFORMED_RESPONSE', 'Critique provider response is not valid JSON');
    }

    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new CritiqueTransportError('MALFORMED_RESPONSE', 'Critique provider response is not an object');
    }
    const body = payload as Record<string, unknown>;
    if (!Array.isArray(body.choices) || body.choices.length === 0 || typeof body.choices[0] !== 'object' || body.choices[0] === null) {
      throw new CritiqueTransportError('MALFORMED_RESPONSE', 'Critique provider response has no choice');
    }

    observedProvider = observedString(body.provider);
    observedModel = observedString(body.model);

    const choice = body.choices[0] as Record<string, unknown>;
    finishReason = observedString(choice.finish_reason);
    const message = choice.message;
    const finalText =
      message && typeof message === 'object' && typeof (message as Record<string, unknown>).content === 'string'
        ? (message as Record<string, string>).content
        : '';
    rawModelOutput = finalText;

    if (finishReason === 'length') {
      throw new CritiqueTransportError('OUTPUT_BUDGET_EXHAUSTED', 'Critique output budget exhausted');
    }
    if (!finalText.trim()) {
      throw new CritiqueTransportError('EMPTY_FINAL_CONTENT', 'Critique provider returned no usable content');
    }

    try {
      const artifact = parseCritiqueArtifact(finalText, input);
      return { outcome: 'CRITIQUED', artifact, rawModelOutput: finalText, receipt: receipt() };
    } catch (error) {
      const code = validationCode(error);
      if (!code) throw error;
      return {
        outcome: 'FAILED',
        artifact: null,
        rawModelOutput: finalText,
        failure: { code, message: error instanceof Error ? error.message : String(error) },
        receipt: receipt(),
      };
    }
  } catch (error) {
    const failure =
      error instanceof CritiqueTransportError
        ? error
        : new CritiqueTransportError('HTTP_ERROR', 'Critique provider execution failed unexpectedly');
    return {
      outcome: 'FAILED',
      artifact: null,
      rawModelOutput,
      failure: { code: failure.code, message: failure.message },
      receipt: receipt(),
    };
  }
}
