#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runPilot1 } from '../../src/dreaming/pilot1-runner.ts';

const requestPath = process.argv[2];
if (!requestPath) {
  console.error('usage: node tools/agent/run-pilot1.mjs <pilot1-request.json>');
  process.exit(2);
}

const request = JSON.parse(readFileSync(resolve(requestPath), 'utf8'));
const config = JSON.parse(
  readFileSync('config/agents/dreaming-worker-pilot1.json', 'utf8'),
);
const baseUrl = (process.env.MASTRA_API_URL ?? 'http://127.0.0.1:8001/api').replace(/\/$/, '');
const timeoutMs = Number(process.env.PILOT1_TIMEOUT_MS ?? 90_000);

function renderPrompt(input) {
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

const result = await runPilot1(request, async input => {
  const payload = {
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
  };

  const response = await fetch(
    `${baseUrl}/agents/${encodeURIComponent(config.id)}/generate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Mastra HTTP ${response.status}: ${text}`);
  }

  const body = JSON.parse(text);

  async function readTraceWitness(traceId) {
    if (!traceId) {
      throw new Error('PILOT1_TRACE_REQUIRED: Mastra response did not include traceId');
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const traceResponse = await fetch(
        `${baseUrl}/observability/traces/${encodeURIComponent(traceId)}/light`,
      );

      if (traceResponse.ok) {
        const trace = await traceResponse.json();
        const spans = Array.isArray(trace.spans) ? trace.spans : [];
        if (spans.length > 0) {
          const count = spanType =>
            spans.filter(span => span.spanType === spanType).length;
          const toolTypes = new Set([
            'tool_call',
            'client_tool_call',
            'provider_tool_call',
            'mcp_tool_call',
          ]);
          return {
            source: 'MASTRA_TRACE',
            modelInferences: count('model_inference'),
            toolCalls: spans.filter(span => toolTypes.has(span.spanType)).length,
            memoryOperations: count('memory_operation'),
            workspaceActions: count('workspace_action'),
          };
        }
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    throw new Error(
      `PILOT1_TRACE_REQUIRED: trace ${traceId} was not observable after bounded retries`,
    );
  }

  return {
    text: body.text ?? '',
    provider: config.desired.model.provider,
    model: config.desired.model.name,
    finishReason: body.finishReason,
    toolCalls: body.toolCalls ?? [],
    usage: body.usage,
    runId: body.runId,
    traceId: body.traceId,
    runtimeWitness: await readTraceWitness(body.traceId),
  };
});

process.stdout.write(JSON.stringify(result, null, 2) + '\n');
