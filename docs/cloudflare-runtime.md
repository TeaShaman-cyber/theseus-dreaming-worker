# Cloudflare production runtime readiness

Issue: #23. Architecture authority: TeaShaman-cyber/theseus-research#127.

This repository has two deliberately different runtime surfaces:

- `src/mastra/index.ts` is the **exe.dev development/Builder surface**. It keeps Editor, workspace, local LibSQL and the exe.dev model gateway.
- `src/runtime/cloudflare-worker.ts` is the **Cloudflare production candidate**. It constructs Pilot 1 directly from Git-owned configuration and does not depend on Editor/Stored Agent state or the exe.dev gateway.

Production deployment is not implied by this document. It remains an explicit promotion boundary.

## Cloudflare runtime contract

The Worker uses:

```text
Cloudflare Worker
  -> Hono / Mastra HTTP adapter
  -> Git-defined Pilot 1 Agent
  -> OpenAI-compatible model endpoint from Worker bindings
  -> @mastra/pg
  -> Hyperdrive
  -> issue-owned Neon/Postgres boundary
```

The runtime storage plan is fixed to schema `dw_issue23` and sets `disableInit: true`.
The Worker runtime therefore does **not** create or alter Postgres schema objects on first request.

Cloudflare request lifecycle is also part of the storage contract:

- each Worker invocation constructs a fresh Mastra/Postgres runtime; no `pg.Pool` is cached across requests;
- Hyperdrive owns the reusable origin-side connection pool, while Worker-side database clients remain invocation-scoped;
- observability `flush()` is registered with `ExecutionContext.waitUntil()` and is delayed until a streaming response completes (or is cancelled/errors), so Postgres/Grafana/Langfuse exporters are not abandoned when the response returns;
- request-handler failures also schedule an observability flush before propagating the original error.

Mastra DDL is exported deterministically with:

```bash
npm run cloudflare:schema
```

The schema name is intentionally short. A longer initial name caused generated Postgres index names to exceed PostgreSQL's 63-character identifier limit during `@mastra/pg exportSchemas()`; the regression is covered by tests.

## Neon boundary

Session Search Neon experience is a required preflight for this runtime.

Do not reuse:

- any project in the dedicated `Theseus Session Search` Neon organization;
- `theseus-research-dev-sandbox` public schema, `memory_probe_owner`, or its existing `theseus_memory_*` tables.

Before a Hyperdrive binding is provisioned, Issue #23 must record an issue-owned Neon boundary and independently verify its runtime role as at least:

```text
NOSUPERUSER
NOCREATEDB
NOCREATEROLE
NOINHERIT
```

The runtime role should receive only the privileges required for the issue-owned schema. Schema/bootstrap DDL is an owner-capability operation and remains separate from runtime credentials.

A Neon control-plane API key is never a Worker database credential.

## Bindings

`cloudflare.config.ts` declares the binding names but contains no secret values.

Resource/text configuration:

- `HYPERDRIVE`
- `MODEL_BASE_URL`
- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_PROTOCOL`
- `LANGFUSE_BASE_URL`
- `THESEUS_ENVIRONMENT`
- `THESEUS_RELEASE`

Secret bindings:

- `MODEL_API_KEY`
- `OTEL_EXPORTER_OTLP_HEADERS`
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`

The Worker has no `NEON_API_KEY` binding.

## Reproducible readiness checks

The normal Cloudflare build gate is:

```bash
npm run cloudflare:check
```

It performs:

1. `cf build`;
2. a compact non-secret `theseus.dreaming-worker.cloudflare-readiness.v1` receipt;
3. `cf deploy --prebuilt --mode production --dry-run --no-provision`.

The dry run sends no deployment API request and cannot provision missing resources.

With placeholder resources the receipt must report `BUILD_READY`, not deployment readiness. A strict check is available after real resource configuration:

```bash
node tools/dev/cloudflare-readiness.mjs --require-configured
```

It exits non-zero until the Hyperdrive ID, model endpoint, OTLP endpoint and release label are configured. Secret bindings are reported only as declared/unverified; values are never printed.

Startup profiling is a separate acceptance check:

```bash
npm run cloudflare:startup-check
```

The first Issue #23 local profile produced about 30.3 MiB uncompressed Build Output and about 503 ms active startup time. Current Cloudflare limits are 64 MiB uncompressed and 1 second startup. This local profile is a readiness signal only, not proof of Cloudflare production startup behavior.

## Promotion boundary

Before production release, require all of the following current evidence:

1. issue-owned Neon boundary and least-privilege SQL role readback;
2. Hyperdrive created against that exact runtime role/database boundary;
3. real model/observability bindings configured without values entering Git or issue comments;
4. readiness receipt `DEPLOY_CONFIG_READY`;
5. canonical repository QA and exact-head review gates;
6. explicit current authorization for production deployment;
7. post-deploy health plus synthetic Pilot 1 receipt/Grafana/Langfuse correlation readback.

Until then the terminal state is readiness work only, not production release.
