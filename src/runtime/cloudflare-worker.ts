import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Mastra } from '@mastra/core/mastra';
import { MastraServer } from '@mastra/hono';
import { PostgresStore } from '@mastra/pg';
import { Hono, type ExecutionContext } from 'hono';

import pilotConfig from '../../config/agents/dreaming-worker-pilot1.json';
import { createObservability } from '../mastra/observability-routing';
import { createPerInvocationHandler } from './cloudflare-lifecycle';
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
  const server = new MastraServer({ app, mastra });
  await server.init();

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
