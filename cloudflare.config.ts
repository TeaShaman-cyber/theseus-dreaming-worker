import { bindings, defineConfig } from 'cf/config';
import * as entrypoint from './src/runtime/cloudflare-worker.ts' with { type: 'cf-worker' };

const DEFAULT_HYPERDRIVE_ID = '6b5dcef36ea9423f95dce9a36f49e50d';
const DEFAULT_MODEL_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_OTEL_ENDPOINT = 'https://otlp-gateway-prod-eu-west-2.grafana.net/otlp';

export default defineConfig({
  worker: {
    name: 'theseus-dreaming-worker-issue23',
    compatibilityDate: '2026-11-22',
    entrypoint,
    env: {
      HYPERDRIVE: bindings.hyperdrive({
        id: process.env.CLOUDFLARE_HYPERDRIVE_ID ?? DEFAULT_HYPERDRIVE_ID,
      }),
      MODEL_BASE_URL: bindings.text(
        process.env.MODEL_BASE_URL ?? DEFAULT_MODEL_BASE_URL,
      ),
      MODEL_API_KEY: bindings.secret(),
      OTEL_EXPORTER_OTLP_ENDPOINT: bindings.text(
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? DEFAULT_OTEL_ENDPOINT,
      ),
      OTEL_EXPORTER_OTLP_PROTOCOL: bindings.text('http/protobuf'),
      OTEL_EXPORTER_OTLP_HEADERS: bindings.secret(),
      LANGFUSE_BASE_URL: bindings.text(
        process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
      ),
      LANGFUSE_PUBLIC_KEY: bindings.secret(),
      LANGFUSE_SECRET_KEY: bindings.secret(),
      THESEUS_ENVIRONMENT: bindings.text(
        process.env.THESEUS_ENVIRONMENT ?? 'production',
      ),
      THESEUS_RELEASE: bindings.text(process.env.THESEUS_RELEASE ?? 'UNCONFIGURED'),
    },
  },
});
