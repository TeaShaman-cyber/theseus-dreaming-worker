import type {
  AnyExportedSpan,
  ConfigSelector,
  CustomSpanFormatter,
  ObservabilityExporter,
} from '@mastra/core/observability';
import { LangfuseExporter } from '@mastra/langfuse';
import {
  MastraStorageExporter,
  Observability,
  SensitiveDataFilter,
} from '@mastra/observability';
import { OtelExporter } from '@mastra/otel-exporter';

export const OBSERVABILITY_SCOPE_KEY = 'observabilityScope';
export const EXTERNAL_SAFE_SCOPE = 'external-safe';

export type ExporterPlan = {
  otel: null | {
    endpoint: string;
    protocol: 'http/protobuf';
    headers: Record<string, string>;
  };
  langfuse: null | {
    publicKey: string;
    secretKey: string;
    baseUrl?: string;
  };
};

export function parseOtelHeaders(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};

  const headers: Record<string, string> = {};

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      throw new Error(
        `OBSERVABILITY_CONFIG_INVALID: malformed OTEL header entry "${trimmed}"`,
      );
    }

    const key = trimmed.slice(0, separator).trim();
    const encodedValue = trimmed.slice(separator + 1).trim();

    try {
      headers[decodeURIComponent(key)] = decodeURIComponent(encodedValue);
    } catch {
      throw new Error(
        `OBSERVABILITY_CONFIG_INVALID: invalid URL encoding in OTEL header "${key}"`,
      );
    }
  }

  return headers;
}

export function buildExporterPlan(
  env: Record<string, string | undefined>,
): ExporterPlan {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  const protocol = env.OTEL_EXPORTER_OTLP_PROTOCOL?.trim();

  if (protocol && protocol !== 'http/protobuf') {
    throw new Error(
      `OBSERVABILITY_CONFIG_INVALID: OTEL_EXPORTER_OTLP_PROTOCOL must be http/protobuf for the Grafana Pilot 1 route, got "${protocol}"`,
    );
  }

  const otel = endpoint
    ? {
        endpoint,
        protocol: 'http/protobuf' as const,
        headers: parseOtelHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
      }
    : null;

  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim();
  const langfuse =
    publicKey && secretKey
      ? {
          publicKey,
          secretKey,
          ...(env.LANGFUSE_BASE_URL?.trim()
            ? { baseUrl: env.LANGFUSE_BASE_URL.trim() }
            : {}),
        }
      : null;

  return { otel, langfuse };
}

export const operationalSpanFormatter: CustomSpanFormatter = (
  span: AnyExportedSpan,
) => ({
  ...span,
  input: undefined,
  output: undefined,
});

export const selectObservabilityConfig: ConfigSelector = ({ requestContext }) =>
  requestContext?.get(OBSERVABILITY_SCOPE_KEY) === EXTERNAL_SAFE_SCOPE
    ? 'external-safe'
    : 'local';

export function createObservability(
  env: Record<string, string | undefined> = process.env,
): Observability {
  const plan = buildExporterPlan(env);

  const externalExporters: ObservabilityExporter[] = [new MastraStorageExporter()];

  if (plan.otel) {
    externalExporters.push(
      new OtelExporter({
        provider: {
          custom: {
            endpoint: plan.otel.endpoint,
            protocol: plan.otel.protocol,
            headers: plan.otel.headers,
          },
        },
        signals: {
          traces: true,
          logs: false,
        },
        customSpanFormatter: operationalSpanFormatter,
      }),
    );
  }

  if (plan.langfuse) {
    externalExporters.push(
      new LangfuseExporter({
        publicKey: plan.langfuse.publicKey,
        secretKey: plan.langfuse.secretKey,
        baseUrl: plan.langfuse.baseUrl,
        environment: env.THESEUS_ENVIRONMENT ?? 'development',
        release: env.THESEUS_RELEASE,
      }),
    );
  }

  return new Observability({
    configs: {
      local: {
        serviceName: 'theseus-dreaming-builder',
        exporters: [new MastraStorageExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
      'external-safe': {
        serviceName: 'theseus-dreaming-builder',
        exporters: externalExporters,
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
    configSelector: selectObservabilityConfig,
  });
}
