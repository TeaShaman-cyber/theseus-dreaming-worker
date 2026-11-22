#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLOUDFLARE_STORAGE_SCHEMA } from '../../src/runtime/cloudflare-runtime.ts';

const EXPECTED_WORKER = 'theseus-dreaming-worker-issue23';
const PLACEHOLDER_HYPERDRIVE_ID = '00000000-0000-0000-0000-000000000023';
const REQUIRED_SECRET_BINDINGS = [
  'MODEL_API_KEY',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
];

function textValue(binding) {
  return binding?.type === 'text' && typeof binding.value === 'string'
    ? binding.value.trim()
    : '';
}

function secretBindingPresent(binding) {
  return binding?.type === 'secret';
}

export function summarizeCloudflareReadiness(workerConfig) {
  const env = workerConfig?.env ?? {};
  const missingSecrets = REQUIRED_SECRET_BINDINGS.filter(
    key => !secretBindingPresent(env[key]),
  );

  const hyperdriveConfigured =
    env.HYPERDRIVE?.type === 'hyperdrive' &&
    typeof env.HYPERDRIVE.id === 'string' &&
    env.HYPERDRIVE.id.trim().length > 0 &&
    env.HYPERDRIVE.id !== PLACEHOLDER_HYPERDRIVE_ID;
  const modelBaseConfigured =
    textValue(env.MODEL_BASE_URL).length > 0 &&
    !textValue(env.MODEL_BASE_URL).includes('unconfigured.invalid');
  const otelConfigured = textValue(env.OTEL_EXPORTER_OTLP_ENDPOINT).length > 0;
  const releaseConfigured =
    textValue(env.THESEUS_RELEASE).length > 0 &&
    textValue(env.THESEUS_RELEASE) !== 'UNCONFIGURED';

  const unconfigured = [
    ...(!hyperdriveConfigured ? ['CLOUDFLARE_HYPERDRIVE_ID'] : []),
    ...(!modelBaseConfigured ? ['MODEL_BASE_URL'] : []),
    ...(!otelConfigured ? ['OTEL_EXPORTER_OTLP_ENDPOINT'] : []),
    ...(!releaseConfigured ? ['THESEUS_RELEASE'] : []),
  ];

  const structurallyValid =
    workerConfig?.name === EXPECTED_WORKER &&
    env.HYPERDRIVE?.type === 'hyperdrive' &&
    env.OTEL_EXPORTER_OTLP_PROTOCOL?.type === 'text' &&
    textValue(env.OTEL_EXPORTER_OTLP_PROTOCOL) === 'http/protobuf' &&
    missingSecrets.length === 0;

  const overall = !structurallyValid
    ? 'INVALID'
    : unconfigured.length === 0
      ? 'DEPLOY_CONFIG_READY'
      : 'BUILD_READY';

  return {
    schema: 'theseus.dreaming-worker.cloudflare-readiness.v1',
    workerName: EXPECTED_WORKER,
    overall,
    storage: {
      backend: 'HYPERDRIVE_POSTGRES',
      schema: CLOUDFLARE_STORAGE_SCHEMA,
      runtimeDdl: 'DISABLED',
      configured: hyperdriveConfigured,
    },
    modelTransport: {
      configured: modelBaseConfigured,
      secretBindingDeclared: secretBindingPresent(env.MODEL_API_KEY),
    },
    observability: {
      otelEndpointConfigured: otelConfigured,
      langfuseBaseDeclared: textValue(env.LANGFUSE_BASE_URL).length > 0,
      externalSecretBindingsDeclared: [
        'OTEL_EXPORTER_OTLP_HEADERS',
        'LANGFUSE_PUBLIC_KEY',
        'LANGFUSE_SECRET_KEY',
      ].every(key => secretBindingPresent(env[key])),
    },
    release: {
      configured: releaseConfigured,
    },
    secretBindings: {
      status: missingSecrets.length === 0
        ? 'DECLARED_VALUES_UNVERIFIED'
        : 'MISSING_DECLARATIONS',
      declared: REQUIRED_SECRET_BINDINGS.filter(key => secretBindingPresent(env[key])),
      missing: missingSecrets,
    },
    unconfigured,
    releaseBoundary: 'EXPLICIT_AUTHORIZATION_REQUIRED',
    valuesDisclosed: false,
  };
}

function main() {
  const buildOutputPath = path.resolve(
    '.cloudflare/output/v1/workers/default/worker.config.json',
  );
  let workerConfig;
  try {
    workerConfig = JSON.parse(readFileSync(buildOutputPath, 'utf8'));
  } catch {
    process.stdout.write(`${JSON.stringify({
      schema: 'theseus.dreaming-worker.cloudflare-readiness.v1',
      overall: 'NO_BUILD_OUTPUT',
      valuesDisclosed: false,
    })}\n`);
    return 2;
  }

  const summary = summarizeCloudflareReadiness(workerConfig);
  process.stdout.write(`${JSON.stringify(summary)}\n`);

  if (summary.overall === 'INVALID') return 2;
  if (process.argv.includes('--require-configured') && summary.overall !== 'DEPLOY_CONFIG_READY') {
    return 3;
  }
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (invokedAsScript) {
  process.exitCode = main();
}
