import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Mastra } from '@mastra/core/mastra';
import { MastraServer } from '@mastra/hono';
import { PostgresStore } from '@mastra/pg';
import { Hono, type ExecutionContext } from 'hono';

import pilotConfig from '../../config/agents/dreaming-worker-pilot1.json';
import { createObservability } from '../mastra/observability-routing';
import { createPilot1Agent } from './pilot1-agent';
import {
  buildCloudflareRuntimePlan,
  type CloudflareRuntimeBindings,
} from './cloudflare-runtime';

type WorkerBindings = CloudflareRuntimeBindings;

let appPromise: Promise<Hono> | undefined;

async function createApp(bindings: WorkerBindings): Promise<Hono> {
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
  const server = new MastraServer({ app, mastra });
  await server.init();
  return app;
}

function getApp(bindings: WorkerBindings): Promise<Hono> {
  appPromise ??= createApp(bindings);
  return appPromise;
}

export default {
  async fetch(
    request: Request,
    bindings: WorkerBindings,
    context: ExecutionContext,
  ): Promise<Response> {
    const app = await getApp(bindings);
    return app.fetch(request, bindings, context);
  },
};
