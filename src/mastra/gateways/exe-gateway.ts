import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { MastraModelGatewayInterface, ProviderConfig } from '@mastra/core/llm';

import { providerConfigs, parseModelIds, providerIdFromGatewayModelId } from './provider-config';

type ProviderId = keyof typeof providerConfigs;

async function discoverModels(baseURL: string): Promise<string[]> {
  try {
    const response = await fetch(`${baseURL}/models`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return [];
    return parseModelIds(await response.json());
  } catch {
    return [];
  }
}

export const exeGateway: MastraModelGatewayInterface = {
  id: 'exe',
  name: 'exe.dev providers',

  async fetchProviders(): Promise<Record<string, ProviderConfig>> {
    const entries = await Promise.all(
      Object.entries(providerConfigs).map(async ([providerId, config]) => {
        const models = await discoverModels(config.baseURL);
        return [
          providerId,
          {
            name: config.name,
            models,
            apiKeyEnvVar: [],
            gateway: 'exe',
            url: config.baseURL,
          } satisfies ProviderConfig,
        ] as const;
      }),
    );
    return Object.fromEntries(entries);
  },

  buildUrl(modelId: string): string | undefined {
    const providerId = providerIdFromGatewayModelId(modelId);
    return providerId ? providerConfigs[providerId].baseURL : undefined;
  },

  async getApiKey(): Promise<string> {
    return '';
  },

  resolveLanguageModel({ modelId, providerId }) {
    const config = providerConfigs[providerId as ProviderId];
    if (!config) throw new Error(`Unknown exe.dev model provider: ${providerId}`);

    return createOpenAICompatible({
      name: `exe-${providerId}`,
      baseURL: config.baseURL,
    }).chatModel(modelId);
  },
};
