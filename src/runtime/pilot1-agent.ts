import { Agent } from '@mastra/core/agent';
import type { AgentConfig } from '@mastra/core/agent';

type Pilot1GitConfig = {
  id: string;
  desired: {
    name: string;
    description?: string;
    instructions: string;
    tools: Record<string, never>;
    memory: null;
    metadata: Record<string, unknown>;
  };
};

export function createPilot1Agent(
  config: Pilot1GitConfig,
  model: AgentConfig['model'],
) {
  if (config.desired.memory !== null) {
    throw new Error('PILOT1_STATIC_AGENT_INVALID: memory must remain disabled');
  }
  if (Object.keys(config.desired.tools).length !== 0) {
    throw new Error('PILOT1_STATIC_AGENT_INVALID: tools must remain disabled');
  }

  return new Agent({
    id: config.id,
    name: config.desired.name,
    description: config.desired.description,
    instructions: config.desired.instructions,
    model,
    tools: {},
    metadata: config.desired.metadata,
  });
}
