import test from 'node:test';
import assert from 'node:assert/strict';
import { providerConfigs, parseModelIds } from '../src/mastra/gateways/provider-config.ts';

test('provider endpoints use exe.dev integration proxies', () => {
  assert.equal(providerConfigs.nvidia.baseURL, 'https://nvidi-nim.int.exe.xyz/v1');
  assert.equal(providerConfigs.openrouter.baseURL, 'https://openrouter.int.exe.xyz/api/v1');
  assert.equal(providerConfigs.groq.baseURL, 'https://groq.int.exe.xyz/openai/v1');
  assert.equal(providerConfigs.bothub.baseURL, 'https://bothub-api.int.exe.xyz/v1');
});

test('model discovery accepts OpenAI list payloads and removes duplicates', () => {
  assert.deepEqual(parseModelIds({ data: [{ id: 'a' }, { id: 'b' }, { id: 'a' }, {}] }), ['a', 'b']);
});

test('gateway model IDs resolve to known provider IDs', async () => {
  const { providerIdFromGatewayModelId } = await import('../src/mastra/gateways/provider-config.ts');
  assert.equal(providerIdFromGatewayModelId('exe/nvidia/moonshotai/kimi-k3.1-pro'), 'nvidia');
  assert.equal(providerIdFromGatewayModelId('exe/groq/llama-3.3-70b-versatile'), 'groq');
  assert.equal(providerIdFromGatewayModelId('other/nvidia/model'), undefined);
  assert.equal(providerIdFromGatewayModelId('exe/missing/model'), undefined);
});
