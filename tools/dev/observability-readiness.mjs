#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OBSERVABILITY_SERVICE_NAME,
  buildExporterPlan,
} from '../../src/mastra/observability-routing.ts';

const GRAFANA_KEYS = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_PROTOCOL',
  'OTEL_EXPORTER_OTLP_HEADERS',
];

const LANGFUSE_KEYS = [
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
  'LANGFUSE_BASE_URL',
];

const LABEL_KEYS = [
  'THESEUS_ENVIRONMENT',
  'THESEUS_RELEASE',
];

function isPresent(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function presentKeys(env, keys) {
  return keys.filter(key => isPresent(env[key]));
}

export function summarizeObservabilityReadiness(env) {
  const grafanaPresent = presentKeys(env, GRAFANA_KEYS);
  const langfusePresent = presentKeys(env, LANGFUSE_KEYS);
  const labelsPresent = presentKeys(env, LABEL_KEYS);

  let plan;
  let grafanaInvalid = false;
  try {
    plan = buildExporterPlan(env);
  } catch {
    grafanaInvalid = true;
    plan = { otel: null, langfuse: null };
  }

  const grafanaStatus = grafanaInvalid
    ? 'INVALID'
    : plan.otel
      ? 'CONFIGURED'
      : grafanaPresent.length > 0
        ? 'PARTIAL'
        : 'UNCONFIGURED';

  const langfuseConfigured =
    isPresent(env.LANGFUSE_PUBLIC_KEY) && isPresent(env.LANGFUSE_SECRET_KEY);
  const langfuseStatus = langfuseConfigured
    ? 'CONFIGURED'
    : langfusePresent.length > 0
      ? 'PARTIAL'
      : 'UNCONFIGURED';

  const overall = grafanaStatus === 'INVALID'
    ? 'INVALID'
    : grafanaStatus === 'CONFIGURED' && langfuseStatus === 'CONFIGURED'
      ? 'EXTERNAL_READY'
      : grafanaStatus === 'UNCONFIGURED' && langfuseStatus === 'UNCONFIGURED'
        ? 'LOCAL_ONLY'
        : 'PARTIAL';

  return {
    schema: 'theseus.dreaming-worker.observability-readiness.v1',
    serviceName: OBSERVABILITY_SERVICE_NAME,
    overall,
    grafana: {
      status: grafanaStatus,
      present: grafanaPresent,
    },
    langfuse: {
      status: langfuseStatus,
      present: langfusePresent,
    },
    labels: {
      present: labelsPresent,
    },
    valuesDisclosed: false,
  };
}

function main() {
  const summary = summarizeObservabilityReadiness(process.env);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  return summary.overall === 'INVALID' ? 2 : 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (invokedAsScript) {
  process.exitCode = main();
}
