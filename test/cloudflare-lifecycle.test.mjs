import test from 'node:test';
import assert from 'node:assert/strict';

import { createPerInvocationHandler } from '../src/runtime/cloudflare-lifecycle.ts';

function testContext() {
  const pending = [];
  return {
    pending,
    context: {
      waitUntil(promise) {
        pending.push(Promise.resolve(promise));
      },
    },
  };
}

test('Cloudflare lifecycle creates a fresh runtime for every invocation', async () => {
  let created = 0;
  const handler = createPerInvocationHandler(async () => {
    const runtimeId = ++created;
    return {
      async fetch() {
        return new Response(String(runtimeId));
      },
      async flush() {},
    };
  });

  const first = testContext();
  const second = testContext();
  const firstResponse = await handler(new Request('https://worker.test/1'), {}, first.context);
  const secondResponse = await handler(new Request('https://worker.test/2'), {}, second.context);

  assert.equal(await firstResponse.text(), '1');
  assert.equal(await secondResponse.text(), '2');
  await Promise.all([...first.pending, ...second.pending]);
  assert.equal(created, 2);
});

test('Cloudflare lifecycle flushes observability only after a streaming response completes', async () => {
  let flushed = false;
  const { context, pending } = testContext();
  const handler = createPerInvocationHandler(async () => ({
    async fetch() {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('hello'));
          controller.close();
        },
      }));
    },
    async flush() {
      flushed = true;
    },
  }));

  const response = await handler(new Request('https://worker.test/stream'), {}, context);
  assert.equal(flushed, false);
  assert.equal(await response.text(), 'hello');
  await Promise.all(pending);
  assert.equal(flushed, true);
});

test('Cloudflare lifecycle schedules observability flush when request handling throws', async () => {
  let flushed = false;
  const { context, pending } = testContext();
  const handler = createPerInvocationHandler(async () => ({
    async fetch() {
      throw new Error('synthetic handler failure');
    },
    async flush() {
      flushed = true;
    },
  }));

  await assert.rejects(
    handler(new Request('https://worker.test/fail'), {}, context),
    /synthetic handler failure/,
  );
  await Promise.all(pending);
  assert.equal(flushed, true);
});
