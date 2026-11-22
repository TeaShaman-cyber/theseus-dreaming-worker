export type WaitUntilContext = {
  waitUntil(promise: Promise<unknown>): void;
};

export type InvocationRuntime<Bindings, Context extends WaitUntilContext> = {
  fetch(
    request: Request,
    bindings: Bindings,
    context: Context,
  ): Response | Promise<Response>;
  flush(): Promise<void>;
};

function scheduleFlushAfterBody(
  response: Response,
  context: WaitUntilContext,
  flush: () => Promise<void>,
): Response {
  if (!response.body) {
    context.waitUntil(Promise.resolve().then(flush));
    return response;
  }

  const reader = response.body.getReader();
  let finish!: () => void;
  const completed = new Promise<void>(resolve => {
    finish = resolve;
  });
  let finished = false;
  const markFinished = () => {
    if (finished) return;
    finished = true;
    finish();
  };

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          controller.close();
          markFinished();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        markFinished();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        markFinished();
      }
    },
  });

  context.waitUntil(completed.then(flush));

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function createPerInvocationHandler<
  Bindings,
  Context extends WaitUntilContext,
>(
  createRuntime: (
    bindings: Bindings,
  ) => InvocationRuntime<Bindings, Context> | Promise<InvocationRuntime<Bindings, Context>>,
) {
  return async (
    request: Request,
    bindings: Bindings,
    context: Context,
  ): Promise<Response> => {
    const runtime = await createRuntime(bindings);
    try {
      const response = await runtime.fetch(request, bindings, context);
      return scheduleFlushAfterBody(response, context, () => runtime.flush());
    } catch (error) {
      context.waitUntil(Promise.resolve().then(() => runtime.flush()));
      throw error;
    }
  };
}
