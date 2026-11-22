import {
  createOpenAIChatInference,
  type ProviderCallEvidence,
} from './openai-provider-adapter.ts';
import type { Pilot2Route } from './pilot2-runner.ts';

export type Pilot2E2ERouteConfig = {
  id: string;
  provider: string;
  model: string;
  modelFamily: string;
  baseURL: string;
  maxTokens: number;
  timeoutMs: number;
  responseFormat?: 'json_object';
  stream?: boolean;
  apiKeyEnv?: string;
};

export type Pilot2E2EConfig = {
  routes: Pilot2E2ERouteConfig[];
};

export type Pilot2E2EProviderEvidence = ProviderCallEvidence & {
  routeId: string;
};

type BuildPilot2RoutesOptions = {
  env?: Record<string, string | undefined>;
  onEvidence?: (evidence: Pilot2E2EProviderEvidence) => void;
};

function requireText(routeIndex: number, field: string, value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`PILOT2_E2E_ROUTE_INVALID: routes[${routeIndex}].${field} must be non-empty`);
  }
  return value.trim();
}

function requirePositiveInteger(routeIndex: number, field: string, value: unknown): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`PILOT2_E2E_ROUTE_INVALID: routes[${routeIndex}].${field} must be a positive integer`);
  }
  return Number(value);
}

export function buildPilot2Routes(
  config: Pilot2E2EConfig,
  options: BuildPilot2RoutesOptions = {},
): Pilot2Route[] {
  if (!config || !Array.isArray(config.routes) || config.routes.length !== 2) {
    throw new Error('PILOT2_E2E_CONFIG_INVALID: exactly two routes are required');
  }

  const env = options.env ?? process.env;

  return config.routes.map((route, index) => {
    const id = requireText(index, 'id', route.id);
    const provider = requireText(index, 'provider', route.provider);
    const model = requireText(index, 'model', route.model);
    const modelFamily = requireText(index, 'modelFamily', route.modelFamily);
    const baseURL = requireText(index, 'baseURL', route.baseURL);
    const maxTokens = requirePositiveInteger(index, 'maxTokens', route.maxTokens);
    const timeoutMs = requirePositiveInteger(index, 'timeoutMs', route.timeoutMs);
    if (route.responseFormat !== undefined && route.responseFormat !== 'json_object') {
      throw new Error(
        `PILOT2_E2E_ROUTE_INVALID: routes[${index}].responseFormat must be json_object when set`,
      );
    }

    let apiKey: string | undefined;
    if (route.apiKeyEnv !== undefined) {
      const apiKeyEnv = requireText(index, 'apiKeyEnv', route.apiKeyEnv);
      apiKey = env[apiKeyEnv];
      if (!apiKey) {
        throw new Error(`PILOT2_E2E_API_KEY_MISSING: environment variable ${apiKeyEnv} is not set`);
      }
    }

    const infer = createOpenAIChatInference({
      baseURL,
      configuredProvider: provider,
      configuredModel: model,
      configuredModelFamily: modelFamily,
      maxTokens,
      timeoutMs,
      responseFormat: route.responseFormat,
      stream: route.stream ?? false,
      apiKey,
      onEvidence: evidence => options.onEvidence?.({ routeId: id, ...evidence }),
    });

    return { id, provider, model, modelFamily, infer };
  });
}
