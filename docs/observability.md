# Observability architecture

Theseus Dreaming Worker keeps observability separate from authority.

## Roles

- **Mastra trace** is the nearest witness for one concrete run. Deterministic Pilot 1 receipts read it back to verify model/tool/memory/workspace activity.
- **Grafana** is the operational plane: traces, latency, errors, provider/runtime behavior, and later service-level metrics/log correlation.
- **Langfuse** is the semantic LLM-development plane: generations, agent/tool spans, token/cost inspection, evaluations, datasets, and experiments.
- **PostHog** remains optional for longer-window product/development analytics. It is not the primary trace store.

## Scope gate

External exporters are never the default.

The default observability config is local Mastra storage only. A request must carry:

```text
requestContext.observabilityScope = external-safe
```

to select the external-safe config.

Pilot 1 emits that selector only after its outer runner has already accepted one of these evidence scopes:

- `SYNTHETIC_FIXTURE`
- `PUBLICATION_SAFE`

Private or unclassified evidence is outside this phase.

## Correlation spine

The external-safe path carries non-sensitive correlation metadata:

- request fingerprint
- evidence fingerprint
- phase
- proposal schema version
- safe evidence scope
- Mastra trace ID remains available from the run response/trace itself

The tracing metadata deliberately does not duplicate task text or evidence text.

## Backend data boundary

Grafana receives OpenTelemetry traces through `@mastra/otel-exporter`. Its per-exporter formatter removes Mastra span `input` and `output` before export, while preserving operational span structure and correlation metadata.

Langfuse receives the normal Mastra LLM trace representation only when both Langfuse credentials are configured and the run selects `external-safe`. This is the backend intended for semantic LLM inspection and evaluation during the current safe-data phase.

Both routes still pass through Mastra's `SensitiveDataFilter`.

## Optional configuration

No external exporter is required for build, boot, Studio, or Pilot 1.

Grafana-compatible OTLP uses the standard OpenTelemetry variables:

```text
OTEL_EXPORTER_OTLP_ENDPOINT
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS
```

Langfuse uses:

```text
LANGFUSE_PUBLIC_KEY
LANGFUSE_SECRET_KEY
LANGFUSE_BASE_URL
```

Optional labels:

```text
THESEUS_ENVIRONMENT
THESEUS_RELEASE
```

When Grafana/OTel is enabled, these map to standard OpenTelemetry resource attributes:

- `THESEUS_ENVIRONMENT` -> `deployment.environment.name`
- `THESEUS_RELEASE` -> `service.version`

Langfuse receives the same values through its exporter `environment` and `release` options. Missing exporter variables leave that exporter disabled; missing optional labels do not disable export.

## Local readiness probe

Use the repo-owned readiness command to classify current runtime configuration without printing endpoint, header, key, environment-label, or release values:

```bash
tools/dev/observability-readiness
```

It reports the fixed observability service name plus only configuration state and the names of present variables. Expected states are:

- `LOCAL_ONLY` — neither external backend is configured;
- `PARTIAL` — at least one external route is incomplete or only one backend is configured;
- `EXTERNAL_READY` — both Grafana/OTel and Langfuse configuration contracts are complete;
- `INVALID` — Grafana/OTel configuration violates the existing exporter contract.

`UNCONFIGURED` and `PARTIAL` are observations, not execution failures: external observability is optional and missing telemetry never overrides the deterministic receipt or local Mastra witness. The command makes no backend calls and does not attach or modify credentials.

## Authority

External telemetry is advisory. A missing Grafana or Langfuse record is never proof that a run did not happen.

Runtime facts used for acceptance remain tied to deterministic receipts and Mastra readback. Git contracts/configuration remain the desired-state authority.

## Current verification

The exe.dev development/acceptance runtime is externally configured without storing real Grafana or Langfuse credentials in the VM. Provider-side exe.dev HTTP proxy integrations hold Basic authentication; the runtime receives only proxy URLs and non-secret Langfuse constructor placeholders. Production remains a separate Cloudflare Workers target.

A synthetic Pilot 1 run was independently read back from the deterministic Mastra receipt, Grafana Tempo, and Langfuse with the same trace ID and matching request/evidence fingerprints. Grafana's OTel export omits span `input` and `output`; Langfuse intentionally retains semantic input/output for the current `SYNTHETIC_FIXTURE` / `PUBLICATION_SAFE` phase, so broader evidence classes remain prohibited on the external-safe route.

A bounded stable-runtime failure canary made both external exporter endpoints unreachable while Pilot 1 still completed `PROPOSED / TRACE_VERIFIED` with one external model call, zero tools, and zero canonical writes. External telemetry is therefore verified as advisory rather than execution authority for the current acceptance surface.
