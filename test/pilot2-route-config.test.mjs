import test from 'node:test';
import assert from 'node:assert/strict';

import { resolvePilot2RouteSecrets } from '../tools/agent/pilot2-route-config.mjs';

const base = {
  routes: [
    {
      id: 'a', provider: 'p1', model: 'm1', modelFamily: 'f1',
      baseURL: 'https://a.example/v1', maxOutputTokens: 400, timeoutMs: 1000,
      apiKeyEnv: 'PILOT2_A_KEY',
    },
    {
      id: 'b', provider: 'p2', model: 'm2', modelFamily: 'f2',
      baseURL: 'https://b.example/v1', maxOutputTokens: 400, timeoutMs: 1000,
    },
  ],
};

test('resolves apiKeyEnv into an in-memory apiKey without preserving the env name', () => {
  const routes = resolvePilot2RouteSecrets(base, { PILOT2_A_KEY: 'secret-a' });
  assert.equal(routes[0].apiKey, 'secret-a');
  assert.equal('apiKeyEnv' in routes[0], false);
  assert.equal(routes[1].apiKey, undefined);
});

test('fails before execution when a declared apiKeyEnv is missing', () => {
  assert.throws(
    () => resolvePilot2RouteSecrets(base, {}),
    /PILOT2_ROUTE_API_KEY_MISSING: PILOT2_A_KEY/,
  );
});
