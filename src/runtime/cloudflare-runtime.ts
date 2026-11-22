export const CLOUDFLARE_STORAGE_SCHEMA = 'dw_issue23';

export type HyperdriveBindingLike = {
  connectionString?: string;
};

export type CloudflareRuntimeBindings = {
  HYPERDRIVE?: HyperdriveBindingLike;
  MODEL_BASE_URL?: string;
  MODEL_API_KEY?: string;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  OTEL_EXPORTER_OTLP_PROTOCOL?: string;
  OTEL_EXPORTER_OTLP_HEADERS?: string;
  LANGFUSE_BASE_URL?: string;
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
  THESEUS_ENVIRONMENT?: string;
  THESEUS_RELEASE?: string;
};

type PilotConfig = {
  desired?: {
    model?: {
      name?: string;
    };
  };
};

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`CLOUDFLARE_RUNTIME_INVALID: ${name} is required`);
  }
  return normalized;
}

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function buildCloudflareRuntimePlan(
  bindings: CloudflareRuntimeBindings,
  pilotConfig: PilotConfig,
) {
  const connectionString = required(
    bindings.HYPERDRIVE?.connectionString,
    'HYPERDRIVE.connectionString',
  );
  const baseURL = required(bindings.MODEL_BASE_URL, 'MODEL_BASE_URL');
  const apiKey = required(bindings.MODEL_API_KEY, 'MODEL_API_KEY');
  const modelName = required(pilotConfig.desired?.model?.name, 'Pilot 1 model name');

  const observabilityEnv = {
    OTEL_EXPORTER_OTLP_ENDPOINT: optional(bindings.OTEL_EXPORTER_OTLP_ENDPOINT),
    OTEL_EXPORTER_OTLP_PROTOCOL: optional(bindings.OTEL_EXPORTER_OTLP_PROTOCOL),
    OTEL_EXPORTER_OTLP_HEADERS: optional(bindings.OTEL_EXPORTER_OTLP_HEADERS),
    LANGFUSE_BASE_URL: optional(bindings.LANGFUSE_BASE_URL),
    LANGFUSE_PUBLIC_KEY: optional(bindings.LANGFUSE_PUBLIC_KEY),
    LANGFUSE_SECRET_KEY: optional(bindings.LANGFUSE_SECRET_KEY),
    THESEUS_ENVIRONMENT: optional(bindings.THESEUS_ENVIRONMENT),
    THESEUS_RELEASE: optional(bindings.THESEUS_RELEASE),
  };

  return {
    storage: {
      id: 'dreaming-worker-production',
      connectionString,
      schemaName: CLOUDFLARE_STORAGE_SCHEMA,
      disableInit: true as const,
    },
    model: {
      baseURL,
      apiKey,
      modelName,
    },
    observabilityEnv,
  };
}
