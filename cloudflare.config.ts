import { bindings, defineConfig } from 'cf/config';
import * as entrypoint from './src/runtime/cloudflare-worker.ts' with { type: 'cf-worker' };

const UNCONFIGURED_HYPERDRIVE_ID = '00000000-0000-0000-0000-000000000023';

export default defineConfig({
  worker: {
    name: 'theseus-dreaming-worker-issue23',
    compatibilityDate: '2026-11-22',
    entrypoint,
    env: {
      HYPERDRIVE: bindings.hyperdrive({
        id: process.env.CLOUDFLARE_HYPERDRIVE_ID ?? UNCONFIGURED_HYPERDRIVE_ID,
      }),
      MODEL_BASE_URL: bindings.text(
        process.env.MODEL_BASE_URL ?? 'https://unconfigured.invalid/v1',
      ),
      MODEL_API_KEY: bindings.secret(),
      OTEL_EXPORTER_OTLP_ENDPOINT: bindings.text(
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '',
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
