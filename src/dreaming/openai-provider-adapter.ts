import type {
  Pilot1Correlation,
  Pilot1Inference,
  Pilot1InferenceResult,
  Pilot1Request,
} from './pilot1-runner.ts';

export type ProviderExecutionState = 'UNKNOWN' | 'RESPONDED';

export type ProviderAdapterErrorCode =
  | 'MALFORMED_RESPONSE'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'EMPTY_FINAL_CONTENT'
  | 'OUTPUT_BUDGET_EXHAUSTED'
  | 'HTTP_ERROR'
  | 'STREAM_ERROR';

export class ProviderAdapterError extends Error {
  readonly code: ProviderAdapterErrorCode;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly providerState: ProviderExecutionState;
  readonly usage?: Pilot1InferenceResult['usage'];

  constructor(
    code: ProviderAdapterErrorCode,
    message: string,
    options: {
      status?: number;
      retryAfterMs?: number;
      providerState: ProviderExecutionState;
      usage?: Pilot1InferenceResult['usage'];
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'ProviderAdapterError';
    this.code = code;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.providerState = options.providerState;
    this.usage = options.usage;
  }
}

export type ProviderCallEvidence = {
  configuredProvider: string;
  configuredModel: string;
  configuredModelFamily?: string;
  observedProvider?: string;
  observedModel?: string;
  requestId?: string;
  requestFingerprint: string;
  evidenceFingerprint: string;
  latencyMs: number;
  status?: number;
  retryAfterMs?: number;
  providerState: ProviderExecutionState;
  usageState: 'PRESENT' | 'ABSENT';
  usage?: Pilot1InferenceResult['usage'];
  outcome: 'SUCCESS' | 'FAILURE';
  usableArtifact: boolean;
  failureCode?: ProviderAdapterErrorCode;
};

export type OpenAIChatInferenceOptions = {
  baseURL: string;
  configuredProvider: string;
  configuredModel: string;
  configuredModelFamily?: string;
  timeoutMs?: number;
  stream?: boolean;
  onEvidence?: (evidence: ProviderCallEvidence) => void;
};

type OpenAIUsage = {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  completion_tokens_details?: { reasoning_tokens?: unknown };
  prompt_tokens_details?: { cached_tokens?: unknown };
};

type OpenAIChoice = {
  finish_reason?: unknown;
  message?: { content?: unknown };
  delta?: { content?: unknown };
};

type OpenAIResponse = {
  id?: unknown;
  model?: unknown;
  provider?: unknown;
  choices?: unknown;
  usage?: unknown;
};

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeUsage(value: unknown): Pilot1InferenceResult['usage'] | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const usage = value as OpenAIUsage;

  const normalized = {
    inputTokens: numberOrUndefined(usage.prompt_tokens),
    outputTokens: numberOrUndefined(usage.completion_tokens),
    totalTokens: numberOrUndefined(usage.total_tokens),
    reasoningTokens: numberOrUndefined(usage.completion_tokens_details?.reasoning_tokens),
    cachedInputTokens: numberOrUndefined(usage.prompt_tokens_details?.cached_tokens),
  };

  return Object.values(normalized).some(value => value !== undefined) ? normalized : undefined;
}

function firstChoice(payload: OpenAIResponse): OpenAIChoice {
  if (!Array.isArray(payload.choices) || !payload.choices[0] || typeof payload.choices[0] !== 'object') {
    throw new ProviderAdapterError(
      'MALFORMED_RESPONSE',
      'Provider response is missing choices[0]',
      { providerState: 'RESPONDED' },
    );
  }
  return payload.choices[0] as OpenAIChoice;
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (!Number.isNaN(seconds)) {
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
  }

  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}

function transportMessages(request: Pilot1Request, correlation: Pilot1Correlation) {
  return [
    {
      role: 'system',
      content:
        'Return only the requested typed proposal artifact. Do not claim provider/model identity from prose.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: request.task,
        packet: request.packet,
        correlation,
      }),
    },
  ];
}

function ensureUsableContent(
  text: string | undefined,
  finishReason: string | undefined,
  status: number,
  usage: Pilot1InferenceResult['usage'] | undefined,
): string {
  if (text?.trim()) return text;

  if (finishReason === 'length') {
    throw new ProviderAdapterError(
      'OUTPUT_BUDGET_EXHAUSTED',
      'Provider exhausted the output budget before producing usable final content',
      { status, providerState: 'RESPONDED', usage },
    );
  }

  throw new ProviderAdapterError(
    'EMPTY_FINAL_CONTENT',
    'Provider returned no usable final content',
    { status, providerState: 'RESPONDED', usage },
  );
}

function normalizeJsonResponse(
  payload: OpenAIResponse,
  status: number,
  configuredProvider: string,
  configuredModel: string,
): Pilot1InferenceResult {
  const choice = firstChoice(payload);
  const finishReason =
    typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined;
  const text =
    typeof choice.message?.content === 'string' ? choice.message.content : undefined;
  const usage = normalizeUsage(payload.usage);

  return {
    text: ensureUsableContent(text, finishReason, status, usage),
    provider:
      typeof payload.provider === 'string' && payload.provider.length > 0
        ? payload.provider
        : configuredProvider,
    model:
      typeof payload.model === 'string' && payload.model.length > 0
        ? payload.model
        : configuredModel,
    finishReason,
    usage,
    runId: typeof payload.id === 'string' ? payload.id : undefined,
  };
}

async function parseSse(
  response: Response,
  configuredProvider: string,
  configuredModel: string,
): Promise<Pilot1InferenceResult> {
  if (!response.body) {
    throw new ProviderAdapterError('STREAM_ERROR', 'Provider stream body is missing', {
      status: response.status,
      providerState: 'RESPONDED',
    });
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let model = configuredModel;
  let provider = configuredProvider;
  let finishReason: string | undefined;
  let runId: string | undefined;
  let usage: Pilot1InferenceResult['usage'] | undefined;

  const reader = response.body.getReader();

  const consumeEvent = (event: string) => {
    const dataLines = event
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart());

    if (dataLines.length === 0) return false;

    const data = dataLines.join('\n').trim();
    if (!data) return false;
    if (data === '[DONE]') return true;

    let payload: OpenAIResponse;
    try {
      payload = JSON.parse(data) as OpenAIResponse;
    } catch (error) {
      throw new ProviderAdapterError('MALFORMED_RESPONSE', 'Provider SSE event is not valid JSON', {
        status: response.status,
        providerState: 'RESPONDED',
        cause: error,
      });
    }

    const choice = firstChoice(payload);
    if (typeof choice.delta?.content === 'string') text += choice.delta.content;
    if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason;
    if (typeof payload.model === 'string' && payload.model.length > 0) model = payload.model;
    if (typeof payload.provider === 'string' && payload.provider.length > 0) {
      provider = payload.provider;
    }
    if (typeof payload.id === 'string') runId = payload.id;
    usage = normalizeUsage(payload.usage) ?? usage;
    return false;
  };

  try {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        buffer = buffer.replace(/\r\n/g, '\n');

        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (consumeEvent(event)) {
            await reader.cancel();
            return {
              text: ensureUsableContent(text, finishReason, response.status, usage),
              provider,
              model,
              finishReason,
              usage,
              runId,
            };
          }
          boundary = buffer.indexOf('\n\n');
        }

        if (done) break;
      }

      if (buffer.trim()) consumeEvent(buffer);

      return {
        text: ensureUsableContent(text, finishReason, response.status, usage),
        provider,
        model,
        finishReason,
        usage,
        runId,
      };
    } catch (error) {
      if (error instanceof ProviderAdapterError) throw error;
      throw new ProviderAdapterError('STREAM_ERROR', 'Provider stream terminated unexpectedly', {
        status: response.status,
        providerState: 'UNKNOWN',
        usage,
        cause: error,
      });
    }
  } finally {
    reader.releaseLock();
  }
}

export function createOpenAIChatInference(options: OpenAIChatInferenceOptions): Pilot1Inference {
  const baseURL = options.baseURL.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 10_000;
  const stream = options.stream ?? false;

  return async (request, correlation) => {
    const startedAt = Date.now();

    const emitEvidence = (
      evidence: Omit<
        ProviderCallEvidence,
        | 'configuredProvider'
        | 'configuredModel'
        | 'configuredModelFamily'
        | 'requestFingerprint'
        | 'evidenceFingerprint'
        | 'latencyMs'
      >,
    ) => {
      options.onEvidence?.({
        configuredProvider: options.configuredProvider,
        configuredModel: options.configuredModel,
        configuredModelFamily: options.configuredModelFamily,
        requestFingerprint: correlation.requestFingerprint,
        evidenceFingerprint: correlation.evidenceFingerprint,
        latencyMs: Math.max(0, Date.now() - startedAt),
        ...evidence,
      });
    };

    try {
      let response: Response;

      try {
        response = await fetch(baseURL + '/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: options.configuredModel,
            messages: transportMessages(request, correlation),
            stream,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') {
          throw new ProviderAdapterError('TIMEOUT', 'Provider request timed out', {
            providerState: 'UNKNOWN',
            cause: error,
          });
        }
        throw new ProviderAdapterError('HTTP_ERROR', 'Provider request failed before a response', {
          providerState: 'UNKNOWN',
          cause: error,
        });
      }

      if (response.status === 429) {
        throw new ProviderAdapterError('RATE_LIMITED', 'Provider rate limited the request', {
          status: response.status,
          retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
          providerState: 'RESPONDED',
        });
      }

      if (!response.ok) {
        throw new ProviderAdapterError(
          'HTTP_ERROR',
          'Provider returned HTTP ' + response.status,
          { status: response.status, providerState: 'RESPONDED' },
        );
      }

      const contentType = response.headers.get('content-type') ?? '';
      let result: Pilot1InferenceResult;

      if (stream || contentType.includes('text/event-stream')) {
        result = await parseSse(response, options.configuredProvider, options.configuredModel);
      } else {
        let payload: OpenAIResponse;
        try {
          payload = (await response.json()) as OpenAIResponse;
        } catch (error) {
          throw new ProviderAdapterError('MALFORMED_RESPONSE', 'Provider response is not valid JSON', {
            status: response.status,
            providerState: 'RESPONDED',
            cause: error,
          });
        }

        result = normalizeJsonResponse(
          payload,
          response.status,
          options.configuredProvider,
          options.configuredModel,
        );
      }

      emitEvidence({
        observedProvider: result.provider,
        observedModel: result.model,
        requestId: result.runId,
        status: response.status,
        providerState: 'RESPONDED',
        usageState: result.usage ? 'PRESENT' : 'ABSENT',
        usage: result.usage,
        outcome: 'SUCCESS',
        usableArtifact: true,
      });

      return result;
    } catch (error) {
      const failure =
        error instanceof ProviderAdapterError
          ? error
          : new ProviderAdapterError('HTTP_ERROR', 'Provider adapter failed unexpectedly', {
              providerState: 'UNKNOWN',
              cause: error,
            });

      emitEvidence({
        status: failure.status,
        retryAfterMs: failure.retryAfterMs,
        providerState: failure.providerState,
        usageState: failure.usage ? 'PRESENT' : 'ABSENT',
        usage: failure.usage,
        outcome: 'FAILURE',
        usableArtifact: false,
        failureCode: failure.code,
      });

      throw failure;
    }
  };
}
