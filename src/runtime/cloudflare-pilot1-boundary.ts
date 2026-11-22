import type { MiddlewareHandler } from 'hono';

import {
  runPilot1,
  type Pilot1Request,
  type Pilot1Result,
} from '../dreaming/pilot1-runner.ts';
import { buildPilot1TracingEnvelope } from '../mastra/pilot1-tracing.ts';

export const INTERNAL_MASTRA_HEADER = 'x-theseus-internal-capability';
export const PILOT1_SYNTHETIC_PATH = '/__theseus/pilot1/synthetic';

type Pilot1RuntimeConfig = {
  id: string;
  desired: {
    model: {
      provider: string;
      name: string;
    };
    defaultOptions: {
      maxSteps: number;
      activeTools: string[];
      toolChoice: string;
      requireToolApproval: boolean;
      modelSettings: Record<string, unknown>;
    };
  };
};

type MastraInvoke = (path: string, init?: RequestInit) => Promise<Response>;

export function createMastraApiGuard(internalToken: string): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.header(INTERNAL_MASTRA_HEADER) !== internalToken) {
      return c.json({ error: 'not_found' }, 404);
    }

    await next();
  };
}

function renderPrompt(input: Pilot1Request): string {
  return [
    `${input.scope}: true`,
    `COVERAGE: ${input.packet.coverage.state}`,
    `CURRENTNESS: ${input.packet.coverage.currentness}`,
    'EVIDENCE_JSON:',
    JSON.stringify(input.packet.evidence, null, 2),
    '',
    'TASK:',
    input.task,
  ].join('\n');
}

async function readTraceWitness(
  invoke: MastraInvoke,
  traceId: string | undefined,
  retryDelayMs: number,
) {
  if (!traceId) {
    throw new Error('PILOT1_TRACE_REQUIRED: Mastra response did not include traceId');
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await invoke(
      `/api/observability/traces/${encodeURIComponent(traceId)}/light`,
    );

    if (response.ok) {
      const trace = (await response.json()) as { spans?: Array<{ spanType?: string }> };
      const spans = Array.isArray(trace.spans) ? trace.spans : [];

      if (spans.length > 0) {
        const count = (spanType: string) =>
          spans.filter(span => span.spanType === spanType).length;
        const toolTypes = new Set([
          'tool_call',
          'client_tool_call',
          'provider_tool_call',
          'mcp_tool_call',
        ]);

        return {
          source: 'MASTRA_TRACE' as const,
          modelInferences: count('model_inference'),
          toolCalls: spans.filter(span => span.spanType && toolTypes.has(span.spanType))
            .length,
          memoryOperations: count('memory_operation'),
          workspaceActions: count('workspace_action'),
        };
      }
    }

    if (retryDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(
    `PILOT1_TRACE_REQUIRED: trace ${traceId} was not observable after bounded retries`,
  );
}

export async function runPilot1ThroughMastra(options: {
  request: Pilot1Request;
  config: Pilot1RuntimeConfig;
  invoke: MastraInvoke;
  traceRetryDelayMs?: number;
}): Promise<Pilot1Result> {
  const { request, config, invoke } = options;
  const traceRetryDelayMs = options.traceRetryDelayMs ?? 500;

  return runPilot1(request, async (input, correlation) => {
    const tracingEnvelope = buildPilot1TracingEnvelope(correlation);
    const response = await invoke(
      `/api/agents/${encodeURIComponent(config.id)}/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...tracingEnvelope,
          messages: renderPrompt(input),
          maxSteps: config.desired.defaultOptions.maxSteps,
          activeTools: config.desired.defaultOptions.activeTools,
          toolChoice: config.desired.defaultOptions.toolChoice,
          requireToolApproval: config.desired.defaultOptions.requireToolApproval,
          modelSettings: config.desired.defaultOptions.modelSettings,
          versions: {
            agents: {
              [config.id]: { status: 'published' },
            },
          },
        }),
      },
    );

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Mastra HTTP ${response.status}: ${text}`);
    }

    const body = JSON.parse(text) as {
      text?: string;
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
    };

    return {
      text: body.text ?? '',
      provider: config.desired.model.provider,
      model: config.desired.model.name,
      finishReason: body.finishReason,
      toolCalls: body.toolCalls ?? [],
      usage: body.usage,
      runId: body.runId,
      traceId: body.traceId,
      runtimeWitness: await readTraceWitness(
        invoke,
        body.traceId,
        traceRetryDelayMs,
      ),
    };
  });
}
