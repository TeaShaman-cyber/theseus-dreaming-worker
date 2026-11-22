import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Mastra } from '@mastra/core/mastra';
import { MastraServer } from '@mastra/hono';
import { PostgresStore } from '@mastra/pg';
import { Hono, type ExecutionContext } from 'hono';

import pilotConfig from '../../config/agents/dreaming-worker-pilot1.json';
import pilot1Fixture from '../../fixtures/pilot1-timeout.json';
import type { Pilot1Request } from '../dreaming/pilot1-runner';
import { createObservability } from '../mastra/observability-routing';
import { createPerInvocationHandler } from './cloudflare-lifecycle';
import {
  INTERNAL_MASTRA_HEADER,
  PILOT1_SYNTHETIC_PATH,
  createMastraApiGuard,
  runPilot1ThroughMastra,
} from './cloudflare-pilot1-boundary';
import { createPilot1Agent } from './pilot1-agent';
import {
  buildCloudflareRuntimePlan,
  type CloudflareRuntimeBindings,
} from './cloudflare-runtime';

type WorkerBindings = CloudflareRuntimeBindings;

async function createRuntime(bindings: WorkerBindings) {
  const plan = buildCloudflareRuntimePlan(bindings, pilotConfig);
  const storage = new PostgresStore(plan.storage);
  const model = createOpenAICompatible({
    name: 'cloudflare-runtime-model',
    baseURL: plan.model.baseURL,
    apiKey: plan.model.apiKey,
  }).chatModel(plan.model.modelName);
  const pilot1Agent = createPilot1Agent(pilotConfig, model);

  const mastra = new Mastra({
    storage,
    agents: {
      [pilotConfig.id]: pilot1Agent,
    },
    observability: createObservability(plan.observabilityEnv),
  });

  const app = new Hono();
  const internalMastraToken = crypto.randomUUID();

  app.use('/api/*', createMastraApiGuard(internalMastraToken));

  const server = new MastraServer({ app, mastra });
  await server.init();

  app.post(PILOT1_SYNTHETIC_PATH, async c => {
    const invokeInternal = async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set(INTERNAL_MASTRA_HEADER, internalMastraToken);

      return app.request(
        new URL(path, 'http://theseus-internal.invalid'),
        { ...init, headers },
        c.env,
        c.executionCtx,
      );
    };

    const result = await runPilot1ThroughMastra({
      request: pilot1Fixture as Pilot1Request,
      config: pilotConfig,
      invoke: invokeInternal,
    });

    return c.json(result);
  });

  return {
    fetch(request: Request, runtimeBindings: WorkerBindings, context: ExecutionContext) {
      return app.fetch(request, runtimeBindings, context);
    },
    flush() {
      return mastra.observability.flush();
    },
  };
}

const fetch = createPerInvocationHandler<WorkerBindings, ExecutionContext>(createRuntime);

export default { fetch };
