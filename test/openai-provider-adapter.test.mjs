import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import {
  ProviderAdapterError,
  createOpenAIChatInference,
  executeOpenAIChatTransport,
} from '../src/dreaming/openai-provider-adapter.ts';
import { proposalSetJsonSchema } from '../src/dreaming/proposal-schema.ts';

async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const baseURL = 'http://127.0.0.1:' + address.port + '/v1';

  try {
    return await fn(baseURL);
  } finally {
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}

const request = {
  scope: 'SYNTHETIC_FIXTURE',
  task: 'Return a typed proposal.',
  packet: {
    schema: 'theseus-evidence-packet-v1',
    packetId: 'fixture-provider-adapter-001',
    acceptedNewEvidence: true,
    coverage: { state: 'PARTIAL', currentness: 'UNKNOWN' },
    evidence: [
      {
        sourceRef: 'fixture:provider:1',
        evidenceHash: 'sha256:fixture-provider-1',
        text: 'Synthetic provider-adapter evidence.',
      },
    ],
  },
};

const correlation = {
  scope: 'SYNTHETIC_FIXTURE',
  phase: 'PILOT_1_SYNTHETIC_INFERENCE',
  proposalSchema: 'theseus.dreaming-worker.proposals.v1',
  requestFingerprint: 'sha256:req',
  evidenceFingerprint: 'sha256:evidence',
};

function inference(baseURL, options = {}) {
  return createOpenAIChatInference({
    baseURL,
    configuredProvider: 'fake-provider',
    configuredModel: 'fake/model-v1',
    timeoutMs: 250,
    ...options,
  });
}

test('adapter returns normalized non-streaming content and observed transport metadata', async () => {
  let observedRequest;
  await withServer((req, res) => {
    observedRequest = { method: req.method, url: req.url };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      id: 'chatcmpl-1',
      model: 'observed/model-v2',
      provider: 'observed-provider',
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: '{"ok":true}' },
        },
      ],
      usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
        total_tokens: 18,
        completion_tokens_details: { reasoning_tokens: 3 },
        prompt_tokens_details: { cached_tokens: 4 },
      },
    }));
  }, async baseURL => {
    const result = await inference(baseURL)(request, correlation);

    assert.equal(result.text, '{"ok":true}');
    assert.equal(result.provider, 'observed-provider');
    assert.equal(result.model, 'observed/model-v2');
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.runId, 'chatcmpl-1');
    assert.deepEqual(result.usage, {
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      reasoningTokens: 3,
      cachedInputTokens: 4,
    });
  });

  assert.equal(observedRequest.method, 'POST');
  assert.equal(observedRequest.url, '/v1/chat/completions');
});

test('successful SSE response without a body fails as typed STREAM_ERROR', async () => {
  await withServer((_req, res) => {
    res.writeHead(204, { 'content-type': 'text/event-stream' });
    res.end();
  }, async baseURL => {
    await assert.rejects(
      () => inference(baseURL, { stream: true })(request, correlation),
      error =>
        error instanceof ProviderAdapterError &&
        error.code === 'STREAM_ERROR' &&
        error.status === 204 &&
        error.providerState === 'RESPONDED',
    );
  });
});

test('adapter assembles split SSE chunks into one final artifact', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'transfer-encoding': 'chunked',
    });

    const chunks = [
      'data: {"id":"run-sse","model":"observed/sse","choices":[{"delta":{"content":"{\\"a\\""},"finish_reason":null}]}\n\n',
      'data: {"id":"run-sse","model":"observed/sse","choices":[{"delta":{"content":":1}"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    res.write(chunks[0].slice(0, 17));
    res.write(chunks[0].slice(17));
    res.write(chunks[1].slice(0, 9));
    res.write(chunks[1].slice(9));
    res.end(chunks[2]);
  }, async baseURL => {
    const result = await inference(baseURL, { stream: true })(request, correlation);

    assert.equal(result.text, '{"a":1}');
    assert.equal(result.model, 'observed/sse');
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.runId, 'run-sse');
    assert.equal(result.usage, undefined);
  });
});

test('non-object JSON response is MALFORMED_RESPONSE with responded state', async () => {
  for (const rawPayload of ['null', '42', '[]']) {
    await withServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(rawPayload);
    }, async baseURL => {
      await assert.rejects(
        () => inference(baseURL)(request, correlation),
        error =>
          error instanceof ProviderAdapterError &&
          error.code === 'MALFORMED_RESPONSE' &&
          error.status === 200 &&
          error.providerState === 'RESPONDED',
      );
    });
  }
});

test('adapter reports malformed provider JSON as a typed failure', async () => {
  await withServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end('{"choices": [');
  }, async baseURL => {
    await assert.rejects(
      () => inference(baseURL)(request, correlation),
      error =>
        error instanceof ProviderAdapterError &&
        error.name === 'ProviderAdapterError' &&
        error.code === 'MALFORMED_RESPONSE' &&
        error.providerState === 'RESPONDED' &&
        error.cause instanceof SyntaxError,
    );
  });
});

test('missing usage stays absent in result and success evidence', async () => {
  const observed = [];
  await withServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      id: 'chatcmpl-no-usage',
      model: 'observed/no-usage',
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: '{"ok":true}' },
        },
      ],
    }));
  }, async baseURL => {
    const result = await createOpenAIChatInference({
      baseURL,
      configuredProvider: 'configured-provider',
      configuredModel: 'configured/model-v1',
      timeoutMs: 250,
      onEvidence: evidence => observed.push(evidence),
    })(request, correlation);
    assert.equal(result.usage, undefined);
  });

  assert.equal(observed.length, 1);
  assert.equal(observed[0].providerState, 'RESPONDED');
  assert.equal(observed[0].usageState, 'ABSENT');
  assert.equal(observed[0].usage, undefined);
});

test('429 preserves Retry-After without retrying implicitly', async () => {
  let calls = 0;

  await withServer((_req, res) => {
    calls += 1;
    res.statusCode = 429;
    res.setHeader('retry-after', '3');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { message: 'rate limited' } }));
  }, async baseURL => {
    await assert.rejects(
      () => inference(baseURL)(request, correlation),
      error =>
        error instanceof ProviderAdapterError &&
        error.code === 'RATE_LIMITED' &&
        error.status === 429 &&
        error.retryAfterMs === 3000 &&
        error.providerState === 'RESPONDED',
    );
  });

  assert.equal(calls, 1);
});

test('immediate TimeoutError is classified before the deadline signal aborts', async () => {
  const originalFetch = globalThis.fetch;
  const timeoutError = new Error('provider timeout');
  timeoutError.name = 'TimeoutError';
  globalThis.fetch = async () => { throw timeoutError; };

  try {
    await assert.rejects(
      () => inference('http://provider.invalid', { timeoutMs: 10_000 })(request, correlation),
      error =>
        error instanceof ProviderAdapterError &&
        error.code === 'TIMEOUT' &&
        error.providerState === 'UNKNOWN' &&
        error.cause === timeoutError,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('deadline abort remains TIMEOUT even when fetch rejects with a generic error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      const guard = setTimeout(() => reject(new Error('deadline signal did not abort promptly')), 150);
      const rejectOnAbort = () => {
        clearTimeout(guard);
        reject(new Error('aborted after deadline'));
      };
      if (init.signal.aborted) rejectOnAbort();
      else init.signal.addEventListener('abort', rejectOnAbort, { once: true });
    });

  try {
    await assert.rejects(
      () => inference('http://provider.invalid', { timeoutMs: 20 })(request, correlation),
      error =>
        error instanceof ProviderAdapterError &&
        error.code === 'TIMEOUT' &&
        error.providerState === 'UNKNOWN',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('timeout preserves unknown provider execution state', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      const guard = setTimeout(() => reject(new Error('timeout contract was not honored promptly')), 150);
      const rejectOnAbort = () => {
        clearTimeout(guard);
        reject(init.signal.reason);
      };
      if (init.signal.aborted) rejectOnAbort();
      else init.signal.addEventListener('abort', rejectOnAbort, { once: true });
    });

  try {
    await assert.rejects(
      () => inference('http://provider.invalid', { timeoutMs: 40 })(request, correlation),
      error =>
        error instanceof ProviderAdapterError &&
        error.code === 'TIMEOUT' &&
        error.providerState === 'UNKNOWN',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('timeout while reading a responded JSON body remains TIMEOUT', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.flushHeaders();
    res.write('{"choices":[');
    // Keep the body open past the adapter deadline.
  }, async baseURL => {
    await assert.rejects(
      () => inference(baseURL, { timeoutMs: 40 })(request, correlation),
      error =>
        error instanceof ProviderAdapterError &&
        error.code === 'TIMEOUT' &&
        error.status === 200 &&
        error.providerState === 'RESPONDED',
    );
  });
});

test('HTTP 200 with stop and empty content is not a usable artifact', async () => {
  await withServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      id: 'chatcmpl-empty',
      model: 'observed/empty',
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: '' },
        },
      ],
      usage: {
        prompt_tokens: 9,
        completion_tokens: 4,
        total_tokens: 13,
      },
    }));
  }, async baseURL => {
    await assert.rejects(
      () => inference(baseURL)(request, correlation),
      error =>
        error instanceof ProviderAdapterError &&
        error.code === 'EMPTY_FINAL_CONTENT' &&
        error.status === 200 &&
        error.providerState === 'RESPONDED' &&
        error.usage?.inputTokens === 9 &&
        error.usage?.outputTokens === 4,
    );
  });
});

test('HTTP 200 length with empty content is output-budget exhaustion', async () => {
  await withServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      id: 'chatcmpl-length',
      model: 'observed/reasoner',
      choices: [
        {
          finish_reason: 'length',
          message: { role: 'assistant', content: null },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 180,
        total_tokens: 190,
        completion_tokens_details: { reasoning_tokens: 180 },
      },
    }));
  }, async baseURL => {
    await assert.rejects(
      () => inference(baseURL)(request, correlation),
      error =>
        error instanceof ProviderAdapterError &&
        error.code === 'OUTPUT_BUDGET_EXHAUSTED' &&
        error.providerState === 'RESPONDED' &&
        error.usage?.reasoningTokens === 180,
    );
  });
});


test('dropped SSE connection becomes typed STREAM_ERROR with unknown completion state', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'transfer-encoding': 'chunked',
    });
    res.write('data: {"id":"drop-1","model":"observed/drop","choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n');
    setTimeout(() => res.destroy(), 5);
  }, async baseURL => {
    await assert.rejects(
      () => inference(baseURL, { stream: true })(request, correlation),
      error =>
        error instanceof ProviderAdapterError &&
        error.code === 'STREAM_ERROR' &&
        error.providerState === 'UNKNOWN',
    );
  });
});

test('model-authored self-identification never overrides transport metadata', async () => {
  await withServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      id: 'chatcmpl-self-id',
      model: 'transport/actual-model',
      provider: 'transport-provider',
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: '{"reviewer_model":"gpt-4o","claim":"synthetic"}',
          },
        },
      ],
    }));
  }, async baseURL => {
    const result = await inference(baseURL)(request, correlation);

    assert.equal(result.model, 'transport/actual-model');
    assert.equal(result.provider, 'transport-provider');
    assert.match(result.text, /"reviewer_model":"gpt-4o"/);
  });
});

test('adapter emits success evidence with configured and observed identity plus fingerprints', async () => {
  const observed = [];

  await withServer((_req, res) => {
    setTimeout(() => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        id: 'chatcmpl-evidence',
      model: 'transport/model-v2',
      provider: 'transport-provider',
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: '{"ok":true}' },
        },
      ],
      usage: {
        prompt_tokens: 5,
        completion_tokens: 2,
        total_tokens: 7,
        },
      }));
    }, 12);
  }, async baseURL => {
    await createOpenAIChatInference({
      baseURL,
      configuredProvider: 'configured-provider',
      configuredModel: 'configured/model-v1',
      configuredModelFamily: 'configured-family',
      timeoutMs: 250,
      onEvidence: evidence => observed.push(evidence),
    })(request, correlation);
  });

  assert.equal(observed.length, 1);
  const evidence = observed[0];
  assert.equal(evidence.configuredProvider, 'configured-provider');
  assert.equal(evidence.configuredModel, 'configured/model-v1');
  assert.equal(evidence.configuredModelFamily, 'configured-family');
  assert.equal(evidence.observedProvider, 'transport-provider');
  assert.equal(evidence.observedModel, 'transport/model-v2');
  assert.equal(evidence.requestId, 'chatcmpl-evidence');
  assert.equal(evidence.requestFingerprint, 'sha256:req');
  assert.equal(evidence.evidenceFingerprint, 'sha256:evidence');
  assert.equal(evidence.usageState, 'PRESENT');
  assert.equal(evidence.usage.totalTokens, 7);
  assert.equal(evidence.outcome, 'SUCCESS');
  assert.equal(evidence.usableArtifact, true);
  assert.equal(evidence.failureCode, undefined);
  assert.ok(evidence.latencyMs >= 5);
  assert.ok(evidence.latencyMs < 1000);
});

test('adapter emits failure evidence for 429 without inventing usage or success', async () => {
  const observed = [];

  await withServer((_req, res) => {
    res.statusCode = 429;
    res.setHeader('retry-after', '2');
    res.end('rate limited');
  }, async baseURL => {
    await assert.rejects(
      () =>
        createOpenAIChatInference({
          baseURL,
          configuredProvider: 'configured-provider',
          configuredModel: 'configured/model-v1',
          configuredModelFamily: 'configured-family',
          timeoutMs: 250,
          onEvidence: evidence => observed.push(evidence),
        })(request, correlation),
      error => error instanceof ProviderAdapterError && error.code === 'RATE_LIMITED',
    );
  });

  assert.equal(observed.length, 1);
  const evidence = observed[0];
  assert.equal(evidence.outcome, 'FAILURE');
  assert.equal(evidence.failureCode, 'RATE_LIMITED');
  assert.equal(evidence.status, 429);
  assert.equal(evidence.retryAfterMs, 2000);
  assert.equal(evidence.providerState, 'RESPONDED');
  assert.equal(evidence.usageState, 'ABSENT');
  assert.equal(evidence.usage, undefined);
  assert.equal(evidence.usableArtifact, false);
  assert.equal(evidence.requestFingerprint, 'sha256:req');
  assert.equal(evidence.evidenceFingerprint, 'sha256:evidence');
});


test('adapter sends configured model, stream flag, task, packet and correlation in the request body', async () => {
  let captured;

  await withServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    captured = {
      method: req.method,
      contentType: req.headers['content-type'],
      rawBody: body,
    };

    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: '{"ok":true}' },
        },
      ],
    }));
  }, async baseURL => {
    await createOpenAIChatInference({
      baseURL: baseURL + '///',
      configuredProvider: 'configured-provider',
      configuredModel: 'configured/model-v1',
      timeoutMs: 250,
      stream: false,
    })(request, correlation);
  });

  assert.equal(captured.method, 'POST');
  assert.equal(captured.contentType, 'application/json');
  const capturedBody = JSON.parse(captured.rawBody);
  assert.equal(capturedBody.model, 'configured/model-v1');
  assert.equal(capturedBody.stream, false);
  assert.equal(capturedBody.messages.length, 2);
  assert.equal(capturedBody.messages[0].role, 'system');
  assert.match(capturedBody.messages[0].content, /theseus\.dreaming-worker\.proposals\.v1/);
  assert.match(capturedBody.messages[0].content, /source_refs/);
  assert.equal(capturedBody.messages[1].role, 'user');

  const userPayload = JSON.parse(capturedBody.messages[1].content);
  assert.equal(userPayload.task, request.task);
  assert.equal(userPayload.packet.packetId, request.packet.packetId);
  assert.equal(userPayload.correlation.requestFingerprint, correlation.requestFingerprint);
  assert.equal(userPayload.correlation.evidenceFingerprint, correlation.evidenceFingerprint);
});

test('adapter falls back to configured provider/model when transport metadata is absent or empty', async () => {
  await withServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      id: 123,
      model: '',
      provider: '',
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: '{"ok":true}' },
        },
      ],
    }));
  }, async baseURL => {
    const result = await createOpenAIChatInference({
      baseURL,
      configuredProvider: 'configured-provider',
      configuredModel: 'configured/model-v1',
      timeoutMs: 250,
    })(request, correlation);

    assert.equal(result.provider, 'configured-provider');
    assert.equal(result.model, 'configured/model-v1');
    assert.equal(result.runId, undefined);
  });
});

test('usage normalization keeps only finite numeric fields and otherwise stays absent', async () => {
  await withServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: '{"ok":true}' },
        },
      ],
      usage: {
        prompt_tokens: '11',
        completion_tokens: null,
        total_tokens: '18',
        completion_tokens_details: { reasoning_tokens: '3' },
      },
    }));
  }, async baseURL => {
    const result = await inference(baseURL)(request, correlation);
    assert.equal(result.usage, undefined);
  });
});

test('usage overflow numeric literals never become finite token counts', async () => {
  await withServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end('{"choices":[{"finish_reason":"stop","message":{"content":"ok"}}],"usage":{"prompt_tokens":1e309,"completion_tokens":-1e309}}');
  }, async baseURL => {
    const result = await inference(baseURL)(request, correlation);
    assert.equal(result.usage, undefined);
  });
});

test('missing or invalid choices are MALFORMED_RESPONSE', async () => {
  for (const choices of [undefined, null, [], [null], ['wrong-type']]) {
    await withServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices }));
    }, async baseURL => {
      await assert.rejects(
        () => inference(baseURL)(request, correlation),
        error =>
          error instanceof ProviderAdapterError &&
          error.code === 'MALFORMED_RESPONSE' &&
          error.providerState === 'RESPONDED',
      );
    });
  }
});

test('Retry-After invalid value stays unknown and zero seconds remains valid', async () => {
  for (const [header, expected] of [[null, undefined], ['not-a-date', undefined], ['0', 0]]) {
    await withServer((_req, res) => {
      res.statusCode = 429;
      if (header !== null) res.setHeader('retry-after', header);
      res.end('rate limited');
    }, async baseURL => {
      await assert.rejects(
        () => inference(baseURL)(request, correlation),
        error =>
          error instanceof ProviderAdapterError &&
          error.code === 'RATE_LIMITED' &&
          error.retryAfterMs === expected,
      );
    });
  }
});

test('ordinary non-2xx response becomes HTTP_ERROR with responded provider state', async () => {
  await withServer((_req, res) => {
    res.statusCode = 500;
    res.end('boom');
  }, async baseURL => {
    await assert.rejects(
      () => inference(baseURL)(request, correlation),
      error =>
        error instanceof ProviderAdapterError &&
        error.code === 'HTTP_ERROR' &&
        error.status === 500 &&
        error.providerState === 'RESPONDED',
    );
  });
});

test('whitespace-only content is not a usable artifact', async () => {
  await withServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: '   ' },
        },
      ],
    }));
  }, async baseURL => {
    await assert.rejects(
      () => inference(baseURL)(request, correlation),
      error => error instanceof ProviderAdapterError && error.code === 'EMPTY_FINAL_CONTENT',
    );
  });
});

test('timeout while reading a responded SSE body remains TIMEOUT', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.flushHeaders();
    res.write('data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}');
    // Keep the stream open past the adapter deadline without an event boundary.
  }, async baseURL => {
    await assert.rejects(
      () => inference(baseURL, { stream: true, timeoutMs: 40 })(request, correlation),
      error =>
        error instanceof ProviderAdapterError &&
        error.code === 'TIMEOUT' &&
        error.status === 200 &&
        error.providerState === 'RESPONDED',
    );
  });
});

test('SSE empty choices without usage remains malformed', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"choices":[]}\n\n');
  }, async baseURL => {
    await assert.rejects(
      () => inference(baseURL, { stream: true })(request, correlation),
      error =>
        error instanceof ProviderAdapterError &&
        error.code === 'MALFORMED_RESPONSE' &&
        error.providerState === 'RESPONDED',
    );
  });
});

test('SSE usage-only chunk does not terminate later content', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[],"usage":{"prompt_tokens":5}}\n\n');
    res.write('data: {"choices":[{"delta":{"content":"later"},"finish_reason":"stop"}]}\n\n');
    res.end('data: [DONE]\n\n');
  }, async baseURL => {
    const result = await inference(baseURL, { stream: true })(request, correlation);
    assert.equal(result.text, 'later');
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.usage.inputTokens, 5);
  });
});

test('SSE usage-only final chunk preserves assembled content and usage', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"id":"usage-stream","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n');
    res.write('data: {"id":"usage-stream","choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n');
    res.end('data: [DONE]\n\n');
  }, async baseURL => {
    const result = await inference(baseURL, { stream: true })(request, correlation);
    assert.equal(result.text, 'ok');
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.runId, 'usage-stream');
    assert.deepEqual(result.usage, {
      inputTokens: 5,
      outputTokens: 2,
      totalTokens: 7,
      reasoningTokens: undefined,
      cachedInputTokens: undefined,
    });
  });
});

test('SSE clean EOF without completion evidence is STREAM_ERROR', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n');
  }, async baseURL => {
    await assert.rejects(
      () => inference(baseURL, { stream: true })(request, correlation),
      error =>
        error instanceof ProviderAdapterError &&
        error.code === 'STREAM_ERROR' &&
        error.status === 200 &&
        error.providerState === 'RESPONDED',
    );
  });
});

test('SSE may finish on clean EOF without DONE and preserves final usage metadata', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"id":"sse-eof","model":"transport/sse","provider":"transport-provider","choices":[{"delta":{"content":"{\\"ok\\":"},"finish_reason":null}]}\n\n');
    res.end('data: {"id":"sse-eof","model":"transport/sse","provider":"transport-provider","choices":[{"delta":{"content":"true}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\n\n');
  }, async baseURL => {
    const result = await inference(baseURL, { stream: true })(request, correlation);

    assert.equal(result.text, '{"ok":true}');
    assert.equal(result.provider, 'transport-provider');
    assert.equal(result.model, 'transport/sse');
    assert.equal(result.runId, 'sse-eof');
    assert.equal(result.finishReason, 'stop');
    assert.deepEqual(result.usage, {
      inputTokens: 4,
      outputTokens: 2,
      totalTokens: 6,
      reasoningTokens: undefined,
      cachedInputTokens: undefined,
    });
  });
});

test('SSE ignores comment-only and blank data events before usable content', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(': keepalive\n\n');
    res.write('data:\n\n');
    res.write('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n');
    res.end('data: [DONE]\n\n');
  }, async baseURL => {
    const result = await inference(baseURL, { stream: true })(request, correlation);
    assert.equal(result.text, 'ok');
    assert.equal(result.finishReason, 'stop');
  });
});

test('SSE accepts DONE with trailing whitespace and ignores later invalid bytes', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n');
    res.write('data: [DONE]   \n\n');
    res.end('data: {"choices":[INVALID]}\n\n');
  }, async baseURL => {
    const result = await inference(baseURL, { stream: true })(request, correlation);
    assert.equal(result.text, 'ok');
    assert.equal(result.finishReason, 'stop');
  });
});

test('SSE leading empty frame cannot merge later data events', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(
      '\n\n' +
      'data: {"choices":[{"delta":{"content":"first"},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"second"},"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n',
    );
  }, async baseURL => {
    const result = await inference(baseURL, { stream: true })(request, correlation);
    assert.equal(result.text, 'firstsecond');
    assert.equal(result.finishReason, 'stop');
  });
});

test('SSE data lines preserve newline boundaries instead of repairing split JSON tokens', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(
      'data: {"choi\n' +
      'data: ces":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n',
    );
  }, async baseURL => {
    await assert.rejects(
      () => inference(baseURL, { stream: true })(request, correlation),
      error =>
        error instanceof ProviderAdapterError &&
        error.code === 'MALFORMED_RESPONSE' &&
        error.providerState === 'RESPONDED',
    );
  });
});

test('SSE reader lock is released after parsing completes', async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n'),
      );
      controller.close();
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });

  try {
    const result = await inference('http://provider.invalid', { stream: true })(request, correlation);
    assert.equal(result.text, 'ok');
    assert.equal(stream.locked, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SSE preserves split multi-byte UTF-8 content across transport chunks', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const event = Buffer.from('data: {"choices":[{"delta":{"content":"tea 🍵"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    const cup = Buffer.from('🍵');
    const cupStart = event.indexOf(cup);
    assert.notEqual(cupStart, -1);
    res.write(event.subarray(0, cupStart + 1));
    setTimeout(() => res.end(event.subarray(cupStart + 1)), 10);
  }, async baseURL => {
    const result = await inference(baseURL, { stream: true })(request, correlation);
    assert.equal(result.text, 'tea 🍵');
    assert.equal(result.finishReason, 'stop');
  });
});

test('SSE keeps the last unterminated data event on clean EOF', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"first"},"finish_reason":null}]}\n\n');
    // A valid final event need not be followed by a blank-line separator at EOF.
    res.end('data: {"choices":[{"delta":{"content":"second"},"finish_reason":"stop"}]}');
  }, async baseURL => {
    const result = await inference(baseURL, { stream: true })(request, correlation);
    assert.equal(result.text, 'firstsecond');
    assert.equal(result.finishReason, 'stop');
  });
});

test('SSE empty later identity fields cannot erase observed transport identity', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"model":"transport/model-v2","provider":"observed-provider","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n');
    res.write('data: {"model":"","provider":"","choices":[{}]}\n\n');
    res.end('data: [DONE]\n\n');
  }, async baseURL => {
    const result = await inference(baseURL, { stream: true })(request, correlation);
    assert.equal(result.text, 'ok');
    assert.equal(result.provider, 'observed-provider');
    assert.equal(result.model, 'transport/model-v2');
    assert.equal(result.finishReason, 'stop');
  });
});

test('SSE non-object payload is MALFORMED_RESPONSE with responded state', async () => {
  for (const rawPayload of ['null', '42', '[]']) {
    await withServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${rawPayload}\n\n`);
    }, async baseURL => {
      await assert.rejects(
        () => inference(baseURL, { stream: true })(request, correlation),
        error =>
          error instanceof ProviderAdapterError &&
          error.code === 'MALFORMED_RESPONSE' &&
          error.status === 200 &&
          error.providerState === 'RESPONDED',
      );
    });
  }
});

test('malformed SSE JSON becomes typed MALFORMED_RESPONSE', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"choices":[\n\n');
  }, async baseURL => {
    await assert.rejects(
      () => inference(baseURL, { stream: true })(request, correlation),
      error =>
        error instanceof ProviderAdapterError &&
        error.code === 'MALFORMED_RESPONSE' &&
        error.providerState === 'RESPONDED' &&
        error.cause instanceof SyntaxError,
    );
  });
});


test('negative Retry-After is rejected while HTTP-date is converted to a bounded delay', async () => {
  await withServer((_req, res) => {
    res.statusCode = 429;
    res.setHeader('retry-after', '-1');
    res.end('rate limited');
  }, async baseURL => {
    await assert.rejects(
      () => inference(baseURL)(request, correlation),
      error =>
        error instanceof ProviderAdapterError &&
        error.code === 'RATE_LIMITED' &&
        error.retryAfterMs === undefined,
    );
  });

  const future = new Date(Date.now() + 60_000).toUTCString();
  await withServer((_req, res) => {
    res.statusCode = 429;
    res.setHeader('retry-after', future);
    res.end('rate limited');
  }, async baseURL => {
    await assert.rejects(
      () => inference(baseURL)(request, correlation),
      error =>
        error instanceof ProviderAdapterError &&
        error.code === 'RATE_LIMITED' &&
        typeof error.retryAfterMs === 'number' &&
        error.retryAfterMs >= 30_000 &&
        error.retryAfterMs <= 60_000,
    );
  });
});

test('usage arrays and primitive values never become token counts', async () => {
  for (const usage of [null, [], 12, '12', true]) {
    await withServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: '{"ok":true}' },
          },
        ],
        usage,
      }));
    }, async baseURL => {
      const result = await inference(baseURL)(request, correlation);
      assert.equal(result.usage, undefined);
    });
  }
});

test('non-string finish reason and invalid message content are normalized safely', async () => {
  await withServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{ finish_reason: 123, message: { content: 'ok' } }],
    }));
  }, async baseURL => {
    const result = await inference(baseURL)(request, correlation);
    assert.equal(result.text, 'ok');
    assert.equal(result.finishReason, undefined);
  });

  for (const choice of [
    { finish_reason: 'stop', message: { content: 123 } },
    { finish_reason: 'stop' },
  ]) {
    await withServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [choice] }));
    }, async baseURL => {
      await assert.rejects(
        () => inference(baseURL)(request, correlation),
        error =>
          error instanceof ProviderAdapterError &&
          error.code === 'EMPTY_FINAL_CONTENT' &&
          error.providerState === 'RESPONDED',
      );
    });
  }
});

test('stream selection works independently by explicit stream flag or SSE content type', async () => {
  for (const mode of ['explicit', 'content-type']) {
    let observedRequest;
    await withServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      observedRequest = { method: req.method, rawBody: body };

      if (mode === 'explicit') {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
      } else {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
      }

      res.end('data: {"id":"route-mode","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    }, async baseURL => {
      const result = await inference(baseURL, { stream: mode === 'explicit' })(request, correlation);
      assert.equal(result.text, 'ok');
      assert.equal(result.runId, 'route-mode');
    });

    assert.equal(observedRequest.method, 'POST');
    const parsed = JSON.parse(observedRequest.rawBody);
    assert.equal(parsed.stream, mode === 'explicit');
  }
});

test('base URL normalization removes all trailing slashes', async () => {
  let seenUrl;

  await withServer((req, res) => {
    seenUrl = req.url;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: '{"ok":true}' },
        },
      ],
    }));
  }, async baseURL => {
    await inference(baseURL + '///')(request, correlation);
  });

  assert.equal(seenUrl, '/v1/chat/completions');
});

test('connection failure before any response is HTTP_ERROR with unknown provider state', async () => {
  const evidence = [];
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const baseURL = 'http://127.0.0.1:' + address.port + '/v1';
  await new Promise(resolve => server.close(resolve));

  await assert.rejects(
    () =>
      createOpenAIChatInference({
        baseURL,
        configuredProvider: 'configured-provider',
        configuredModel: 'configured/model-v1',
        timeoutMs: 250,
        onEvidence: item => evidence.push(item),
      })(request, correlation),
    error =>
      error instanceof ProviderAdapterError &&
      error.code === 'HTTP_ERROR' &&
      error.providerState === 'UNKNOWN',
  );

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].failureCode, 'HTTP_ERROR');
  assert.equal(evidence[0].providerState, 'UNKNOWN');
  assert.equal(evidence[0].usableArtifact, false);
});

test('empty-content failure evidence preserves known usage instead of inventing success', async () => {
  const evidence = [];

  await withServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: '' },
        },
      ],
      usage: {
        prompt_tokens: 9,
        completion_tokens: 4,
        total_tokens: 13,
      },
    }));
  }, async baseURL => {
    await assert.rejects(
      () =>
        createOpenAIChatInference({
          baseURL,
          configuredProvider: 'configured-provider',
          configuredModel: 'configured/model-v1',
          timeoutMs: 250,
          onEvidence: item => evidence.push(item),
        })(request, correlation),
      error => error instanceof ProviderAdapterError && error.code === 'EMPTY_FINAL_CONTENT',
    );
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].outcome, 'FAILURE');
  assert.equal(evidence[0].failureCode, 'EMPTY_FINAL_CONTENT');
  assert.equal(evidence[0].usageState, 'PRESENT');
  assert.equal(evidence[0].usage.inputTokens, 9);
  assert.equal(evidence[0].usage.outputTokens, 4);
  assert.equal(evidence[0].usableArtifact, false);
});

test('unexpected observer failure is normalized with unknown provider state and preserved cause', async () => {
  const evidence = [];
  const observerFailure = new Error('observer failed');
  let observerCalls = 0;

  await withServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
    }));
  }, async baseURL => {
    await assert.rejects(
      () => createOpenAIChatInference({
        baseURL,
        configuredProvider: 'configured-provider',
        configuredModel: 'configured/model-v1',
        timeoutMs: 250,
        onEvidence: item => {
          observerCalls += 1;
          if (observerCalls === 1) throw observerFailure;
          evidence.push(item);
        },
      })(request, correlation),
      error =>
        error instanceof ProviderAdapterError &&
        error.code === 'HTTP_ERROR' &&
        error.providerState === 'UNKNOWN' &&
        error.cause === observerFailure,
    );
  });

  assert.equal(observerCalls, 2);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].outcome, 'FAILURE');
  assert.equal(evidence[0].failureCode, 'HTTP_ERROR');
  assert.equal(evidence[0].providerState, 'UNKNOWN');
});

test('SSE parser handles CRLF, comment lines, DONE and invalid metadata without trusting it', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(': keepalive\r\n');
    res.write('event: message\r\n');
    res.write('data: {"id":123,"model":7,"provider":false,"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\r\n\r\n');
    res.write('data: [DONE]\r\n\r\n');
    res.end('data: {"choices":[INVALID]}\r\n\r\n');
  }, async baseURL => {
    const result = await createOpenAIChatInference({
      baseURL,
      configuredProvider: 'configured-provider',
      configuredModel: 'configured/model-v1',
      timeoutMs: 250,
      stream: true,
    })(request, correlation);

    assert.equal(result.text, 'ok');
    assert.equal(result.provider, 'configured-provider');
    assert.equal(result.model, 'configured/model-v1');
    assert.equal(result.runId, undefined);
    assert.equal(result.finishReason, 'stop');
  });
});

test('adapter sends the configured output-token bound to the provider', async () => {
  let observedBody;
  await withServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      observedBody = JSON.parse(body);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        id: 'chatcmpl-bounded',
        model: 'fake/model-v1',
        choices: [{ finish_reason: 'stop', message: { content: '{\"ok\":true}' } }],
      }));
    });
  }, async baseURL => {
    await inference(baseURL, { maxOutputTokens: 321 })(request, correlation);
  });

  assert.equal(observedBody.max_tokens, 321);
});

test('adapter carries the exact Proposal v1 output contract in the system message', async () => {
  let observedBody;
  await withServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      observedBody = JSON.parse(body);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        model: 'fake/model-v1',
        choices: [{ finish_reason: 'stop', message: { content: '{\"ok\":true}' } }],
      }));
    });
  }, async baseURL => {
    await inference(baseURL, { maxOutputTokens: 321 })(request, correlation);
  });

  const system = observedBody.messages[0].content;
  assert.match(system, /theseus\.dreaming-worker\.proposals\.v1/);
  assert.match(system, /source_refs/);
  assert.match(system, /evidence_hash/);
  assert.match(system, /FACT.*INFERENCE.*HYPOTHESIS.*UNKNOWN/s);
});


test('adapter system prompt embeds the canonical generated Proposal v1 JSON Schema', async () => {
  let observedBody;
  await withServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      observedBody = JSON.parse(body);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        model: 'fake/model-v1',
        choices: [{ finish_reason: 'stop', message: { content: '{\"ok\":true}' } }],
      }));
    });
  }, async baseURL => {
    await inference(baseURL, { maxOutputTokens: 321 })(request, correlation);
  });

  assert.match(observedBody.messages[0].content, /Match this JSON Schema exactly:/);
  assert.ok(observedBody.messages[0].content.includes(JSON.stringify(proposalSetJsonSchema)));
});

test('adapter can request provider JSON-object mode and bearer auth explicitly', async () => {
  let observed;
  await withServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      observed = {
        authorization: req.headers.authorization,
        body: JSON.parse(body),
      };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        model: 'fake/model-v1',
        choices: [{ finish_reason: 'stop', message: { content: '{\"ok\":true}' } }],
      }));
    });
  }, async baseURL => {
    await inference(baseURL, {
      maxOutputTokens: 321,
      responseFormat: 'json_object',
      apiKey: 'test-secret',
    })(request, correlation);
  });

  assert.equal(observed.authorization, 'Bearer test-secret');
  assert.deepEqual(observed.body.response_format, { type: 'json_object' });
});

test('adapter omits Authorization entirely when apiKey is not configured', async () => {
  let observedAuthorization;
  await withServer((req, res) => {
    observedAuthorization = req.headers.authorization;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      model: 'fake/model-v1',
      choices: [{ finish_reason: 'stop', message: { content: '{\"ok\":true}' } }],
    }));
  }, async baseURL => {
    await inference(baseURL, { maxOutputTokens: 321 })(request, correlation);
  });

  assert.equal(observedAuthorization, undefined);
});

test('adapter omits response_format when JSON-object mode is not configured', async () => {
  let observedBody;
  await withServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      observedBody = JSON.parse(body);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        model: 'fake/model-v1',
        choices: [{ finish_reason: 'stop', message: { content: '{\"ok\":true}' } }],
      }));
    });
  }, async baseURL => {
    await inference(baseURL, { maxOutputTokens: 321 })(request, correlation);
  });

  assert.equal(observedBody.response_format, undefined);
});


test('shared OpenAI chat transport accepts caller-supplied messages and preserves wire semantics', async () => {
  let observedBody;
  await withServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      observedBody = JSON.parse(body);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        id: 'shared-transport-run',
        provider: 'observed-provider',
        model: 'observed-model',
        choices: [{ finish_reason: 'stop', message: { content: '{\"ok\":true}' } }],
      }));
    });
  }, async baseURL => {
    const result = await executeOpenAIChatTransport({
      baseURL,
      configuredProvider: 'configured-provider',
      configuredModel: 'configured-model',
      messages: [
        { role: 'system', content: 'system-contract' },
        { role: 'user', content: 'user-payload' },
      ],
      maxOutputTokens: 321,
      responseFormat: 'json_object',
      apiKey: 'secret',
      stream: false,
    });

    assert.equal(result.text, '{\"ok\":true}');
    assert.equal(result.provider, 'observed-provider');
    assert.equal(result.model, 'observed-model');
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.runId, 'shared-transport-run');
    assert.equal(result.status, 200);
  });

  assert.deepEqual(observedBody.messages, [
    { role: 'system', content: 'system-contract' },
    { role: 'user', content: 'user-payload' },
  ]);
  assert.equal(observedBody.max_tokens, 321);
  assert.deepEqual(observedBody.response_format, { type: 'json_object' });
  assert.equal(observedBody.stream, false);
});
