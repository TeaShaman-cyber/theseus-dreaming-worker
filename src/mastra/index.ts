import { Mastra } from '@mastra/core/mastra';
import { MastraEditor } from '@mastra/editor';
import { createBuilderAgent } from '@mastra/editor/ee';
import { LibSQLStore } from '@mastra/libsql';

import { getEnv } from './env';
import { exeGateway } from './gateways/exe-gateway';
import { workspace } from './workspace';
import { createObservability } from './observability-routing';

const storage = new LibSQLStore({
  id: 'mastra-storage',
  url: 'file:./mastra.db',
});

const builderModel = getEnv('BUILDER_MODEL') ?? 'exe/nvidia/moonshotai/kimi-k3.1-pro';

const editor = new MastraEditor({
  builder: {
    enabled: true,
    configuration: {
      agent: {
        workspace: { type: 'id', workspaceId: workspace.id },
        memory: {
          options: { lastMessages: 10 },
        },
      },
    },
  },
});

export const mastra = new Mastra({
  storage,
  workspace,
  gateways: { exeGateway },
  agents: {
    builderAgent: createBuilderAgent({ model: builderModel }),
  },
  bundler: {
    sourcemap: true,
  },
  server: {
    host: '0.0.0.0',
    port: Number(process.env.MASTRA_PORT ?? 8000),
    build: { swaggerUI: true },
  },
  observability: createObservability(),
  editor,
});
