import {
  ProviderAdapterError,
  createOpenAIChatInference,
  type ProviderCallEvidence,
} from './openai-provider-adapter.ts';
import {
  runPilot2,
  type Pilot2Result,
} from './pilot2-runner.ts';
import type { Pilot1Request } from './pilot1-runner.ts';

export type Pilot2ProviderRouteConfig = {
  id: string;
  provider: string;
  model: string;
  modelFamily: string;
  baseURL: string;
  timeoutMs?: number;
  maxOutputTokens: number;
  stream?: boolean;
};

export type Pilot2ProviderEvidence = {
  routeId: string;
  evidence: ProviderCallEvidence;
};

function nonEmpty(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function rethrowForPilot2(error: unknown): never {
  if (error instanceof ProviderAdapterError) {
    if (error.code === 'OUTPUT_BUDGET_EXHAUSTED') {
      throw new Error(`PILOT2_OUTPUT_BUDGET_EXHAUSTED: ${error.message}`, { cause: error });
    }
    if (error.code === 'EMPTY_FINAL_CONTENT') {
      throw new Error(`PILOT2_EMPTY_FINAL_CONTENT: ${error.message}`, { cause: error });
    }
  }
  throw error;
}

function validateRouteConfigs(routes: Pilot2ProviderRouteConfig[]): void {
  if (routes.length !== 2) {
    throw new Error(`PILOT2_PROVIDER_ROUTES_INVALID: expected exactly two routes; observed ${routes.length}`);
  }

  for (const route of routes) {
    if (
      !nonEmpty(route.id) ||
      !nonEmpty(route.provider) ||
      !nonEmpty(route.model) ||
      !nonEmpty(route.modelFamily) ||
      !nonEmpty(route.baseURL) ||
      !Number.isInteger(route.maxOutputTokens) ||
      route.maxOutputTokens <= 0
    ) {
      throw new Error(
        'PILOT2_PROVIDER_ROUTES_INVALID: id/provider/model/modelFamily/baseURL must be non-empty and maxOutputTokens must be a positive integer',
      );
    }
  }
}

export async function runPilot2WithProviders(
  request: Pilot1Request,
  routeConfigs: Pilot2ProviderRouteConfig[],
  onEvidence?: (record: Pilot2ProviderEvidence) => void,
): Promise<Pilot2Result> {
  validateRouteConfigs(routeConfigs);

  return runPilot2(
    request,
    routeConfigs.map(route => ({
      id: route.id,
      provider: route.provider,
      model: route.model,
      modelFamily: route.modelFamily,
      infer: (() => {
        const adapterInference = createOpenAIChatInference({
          baseURL: route.baseURL,
          configuredProvider: route.provider,
          configuredModel: route.model,
          configuredModelFamily: route.modelFamily,
          timeoutMs: route.timeoutMs,
          maxOutputTokens: route.maxOutputTokens,
          stream: route.stream,
          onEvidence: evidence => onEvidence?.({ routeId: route.id, evidence }),
        });

        return async (innerRequest, correlation) => {
          try {
            return await adapterInference(innerRequest, correlation);
          } catch (error) {
            return rethrowForPilot2(error);
          }
        };
      })(),
    })),
  );
}
