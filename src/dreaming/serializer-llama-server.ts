import type {
  SerializerCandidateExecutor,
  SerializerCandidateMeasurementInput,
} from './serializer-benchmark-runner.ts';

export type LocalLlamaSerializerErrorCode =
  | 'TIMEOUT'
  | 'HTTP_ERROR'
  | 'MALFORMED_RESPONSE'
  | 'EMPTY_CONTENT';

export class LocalLlamaSerializerError extends Error {
  readonly code: LocalLlamaSerializerErrorCode;
  readonly status?: number;

  constructor(
    code: LocalLlamaSerializerErrorCode,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'LocalLlamaSerializerError';
    this.code = code;
    this.status = options.status;
  }
}

export type LocalLlamaSerializerOptions = {
  baseURL: string;
  timeoutMs: number;
  maxOutputTokens: number;
  coldStartMs?: number;
  peakRssBytes?: number;
};

type OpenAIUsage = {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  completion_tokens_details?: { reasoning_tokens?: unknown };
  prompt_tokens_details?: { cached_tokens?: unknown };
};

type OpenAIResponse = {
  choices?: unknown;
  usage?: unknown;
};

function nonNegativeFiniteOrUndefined(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value >= 0);
}

function validatedBaseURL(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('LOCAL_LLAMA_CONFIG_INVALID');
  }

  const loopback = url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (
    url.protocol !== 'http:' ||
    !loopback ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new Error('LOCAL_LLAMA_CONFIG_INVALID');
  }

  const normalized = url.toString();
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function validateOptions(options: LocalLlamaSerializerOptions): string {
  if (
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    !Number.isInteger(options.maxOutputTokens) ||
    options.maxOutputTokens <= 0 ||
    !nonNegativeFiniteOrUndefined(options.coldStartMs) ||
    !nonNegativeFiniteOrUndefined(options.peakRssBytes)
  ) {
    throw new Error('LOCAL_LLAMA_CONFIG_INVALID');
  }
  return validatedBaseURL(options.baseURL);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeUsage(value: unknown): SerializerCandidateMeasurementInput['usage'] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const usage = value as OpenAIUsage;
  const normalized = {
    inputTokens: numberOrUndefined(usage.prompt_tokens),
    outputTokens: numberOrUndefined(usage.completion_tokens),
    totalTokens: numberOrUndefined(usage.total_tokens),
    reasoningTokens: numberOrUndefined(usage.completion_tokens_details?.reasoning_tokens),
    cachedInputTokens: numberOrUndefined(usage.prompt_tokens_details?.cached_tokens),
  };
  return Object.values(normalized).some(item => item !== undefined) ? normalized : undefined;
}

function serializerMessages(rawOutput: string, targetSchema: unknown) {
  return [
    {
      role: 'system',
      content: [
        'You are a bounded serializer/compiler.',
        'Transform the frozen raw output into exactly one JSON object matching the target schema.',
        'Preserve meaning and copy identifiers/claims only when supported by the raw output.',
        'Never invent missing claims, source references, hashes, assumptions, or evidence.',
        'Do not explain or review truth. Output JSON only.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        JSON.stringify({
          raw_output: rawOutput,
          target_schema: targetSchema,
        }),
        '/no_think',
      ].join(String.fromCharCode(10)),
    },
  ];
}

function parseResponse(payload: unknown): {
  text: string;
  finishReason?: string;
  usage?: SerializerCandidateMeasurementInput['usage'];
} {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new LocalLlamaSerializerError(
      'MALFORMED_RESPONSE',
      'Local llama server response is not an object',
    );
  }

  const response = payload as OpenAIResponse;
  if (!Array.isArray(response.choices) || response.choices.length === 0) {
    throw new LocalLlamaSerializerError(
      'MALFORMED_RESPONSE',
      'Local llama server response is missing choices',
    );
  }

  const first = response.choices[0];
  if (first === null || typeof first !== 'object' || Array.isArray(first)) {
    throw new LocalLlamaSerializerError(
      'MALFORMED_RESPONSE',
      'Local llama server first choice is invalid',
    );
  }

  const choice = first as {
    finish_reason?: unknown;
    message?: { content?: unknown };
  };
  if (typeof choice.message?.content !== 'string' || !choice.message.content.trim()) {
    throw new LocalLlamaSerializerError(
      'EMPTY_CONTENT',
      'Local llama server returned no usable content',
    );
  }

  return {
    text: choice.message.content,
    finishReason:
      typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined,
    usage: normalizeUsage(response.usage),
  };
}

export function createLocalLlamaSerializerExecutor(
  options: LocalLlamaSerializerOptions,
): SerializerCandidateExecutor {
  const baseURL = validateOptions(options);

  return async input => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);

    let response: Response;
    try {
      response = await fetch(baseURL + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: serializerMessages(input.rawOutput, input.targetSchema),
          temperature: 0,
          max_tokens: options.maxOutputTokens,
          stream: false,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'serializer_output',
              schema: input.targetSchema,
              strict: true,
            },
          },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new LocalLlamaSerializerError(
          'TIMEOUT',
          'Local llama server request timed out',
          { cause: error },
        );
      }
      throw new LocalLlamaSerializerError(
        'HTTP_ERROR',
        'Local llama server request failed',
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new LocalLlamaSerializerError(
        'HTTP_ERROR',
        'Local llama server returned an HTTP error',
        { status: response.status },
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new LocalLlamaSerializerError(
        'MALFORMED_RESPONSE',
        'Local llama server response is not JSON',
        { status: response.status, cause: error },
      );
    }

    const parsed = parseResponse(payload);
    const measurement: SerializerCandidateMeasurementInput = {
      coldStartMs: options.coldStartMs,
      peakRssBytes: options.peakRssBytes,
      usage: parsed.usage,
    };

    return {
      text: parsed.text,
      finishReason: parsed.finishReason,
      measurement,
    };
  };
}
