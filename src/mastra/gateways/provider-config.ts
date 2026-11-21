export const providerConfigs = Object.freeze({
  nvidia: { name: 'NVIDIA NIM', baseURL: 'https://nvidi-nim.int.exe.xyz/v1' },
  openrouter: { name: 'OpenRouter', baseURL: 'https://openrouter.int.exe.xyz/api/v1' },
  groq: { name: 'Groq', baseURL: 'https://groq.int.exe.xyz/openai/v1' },
  bothub: { name: 'BotHub', baseURL: 'https://bothub-api.int.exe.xyz/v1' },
});

export type ProviderId = keyof typeof providerConfigs;

export function parseModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const ids = data
    .map(item => {
      if (!item || typeof item !== 'object') return undefined;
      const id = (item as { id?: unknown }).id;
      return typeof id === 'string' && id.length > 0 ? id : undefined;
    })
    .filter((id): id is string => Boolean(id));
  return [...new Set(ids)].sort();
}

export function providerIdFromGatewayModelId(modelId: unknown, gatewayId = 'exe'): ProviderId | undefined {
  if (typeof modelId !== 'string') return undefined;
  const [prefix, providerId] = modelId.split('/');
  if (prefix !== gatewayId || !providerId) return undefined;
  return Object.prototype.hasOwnProperty.call(providerConfigs, providerId) ? (providerId as ProviderId) : undefined;
}
