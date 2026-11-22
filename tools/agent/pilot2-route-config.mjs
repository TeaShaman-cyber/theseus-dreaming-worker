export function resolvePilot2RouteSecrets(config, env = process.env) {
  const routes = Array.isArray(config?.routes) ? config.routes : [];

  return routes.map(route => {
    const { apiKeyEnv, ...rest } = route;
    if (apiKeyEnv === undefined) return { ...rest };

    if (typeof apiKeyEnv !== 'string' || !apiKeyEnv.trim()) {
      throw new Error('PILOT2_ROUTE_API_KEY_ENV_INVALID');
    }

    const key = env[apiKeyEnv];
    if (!key) {
      throw new Error(`PILOT2_ROUTE_API_KEY_MISSING: ${apiKeyEnv}`);
    }

    return { ...rest, apiKey: key };
  });
}
