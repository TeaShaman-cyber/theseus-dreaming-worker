# Theseus Dreaming Worker

Public implementation workspace for a bounded background dreaming/hypothesis worker. The repository is intentionally public so ordinary GitHub-hosted Actions runners can be used without consuming private-repository compute allowance. Private conversation data, provider credentials, secrets, and generated private evidence must never be committed here.

The durable purpose and authority boundary live in [`contracts/dreaming-worker.yaml`](contracts/dreaming-worker.yaml). Read that contract before changing workflow semantics, provider routing, storage, or authority.

Architecture coordination: `TeaShaman-cyber/theseus-research#127`. Bootstrap implementation: issue #1 in this repository.

## Development surface

Mastra Agent Builder runs in development mode on the existing governed exe.dev VM `theseus-exe-shell-probe`.

- Mastra Studio / Agent Builder runs internally on port 8001 under `theseus-dreaming-builder.service`.
- Built-in Mastra MCP is `/api/mcp` internally.
- ChatGPT reaches the Builder through exe.dev's official `mcp-gate` on port 8000 at `https://theseus-exe-shell-probe.exe.xyz/mcp`; the gate supplies OAuth and forwards `/mcp` to Mastra `/api/mcp`.
- Setup, verification, security boundary, and troubleshooting: [`docs/exe-dev-remote-mcp.md`](docs/exe-dev-remote-mcp.md).
- Local Builder state: ignored LibSQL files and `.mastra/` workspace; Git remains code/contract authority.
- Cloudflare Workers is the selected target runtime. The current Cloudflare state is pre-operational acceptance only: a technical version/deployment may exist, but Dreaming Worker has not been introduced into operation and is not a production service.

Start on the governed VM with Node >=22.13:

```sh
npm run dev
```

Deterministic checks:

```sh
npm run check
```

## Model providers

`src/mastra/gateways/exe-gateway.ts` exposes attached exe.dev OpenAI-compatible provider integrations through one custom Mastra gateway:

- `exe/nvidia/...` -> NVIDIA NIM (`nvidi-nim` exe.dev integration)
- `exe/openrouter/...` -> OpenRouter
- `exe/groq/...` -> Groq
- `exe/bothub/...` -> BotHub

Model lists are discovered from each provider's read-only `/models` endpoint. Provider credentials remain in exe.dev integration state; this repository stores no provider API keys.

The Builder's own model is selected by `BUILDER_MODEL`; the current development default is `exe/nvidia/moonshotai/kimi-k3.1-pro`. Changing this is routing, not a change to the worker's goal contract.

## Safety boundary

This repository is public by design. Public code is allowed; private evidence is not. Runtime credentials remain in exe.dev/provider integration state, and any future Session Search evidence must stay outside Git unless it is explicitly synthetic or intentionally sanitized for publication.

Bootstrap verification performs model discovery only. It does not send Session Search evidence, make inference calls, promote hypotheses to truth, or write canonical memory/user preferences.

## Pilot 0 dry run

Before any external model is allowed to analyze evidence, the repository has a deterministic dry-run gate.

In plain terms: it checks that each evidence item has a source identity, records exactly what packet was seen, refuses absence claims when coverage/currentness is incomplete, and proves that the dry run made zero external model calls.

Run the synthetic fixture:

```bash
npm run pilot0 -- fixtures/pilot0-partial.json
```

Expected properties of the result:

- `FACT` only describes what the accepted packet itself proves;
- `UNKNOWN` is emitted when incomplete coverage makes stronger claims unsafe;
- `receipt.inputFingerprint` uniquely fingerprints the input packet;
- `receipt.externalModelCalls` is `0`.

Implementation: `src/dreaming/dry-run.ts`.
Tests: `test/dry-run.test.mjs`.


## Pilot 2 bounded live execution

Pilot 2 composes two explicitly configured, model-family-distinct OpenAI-compatible routes over the same synthetic or publication-safe evidence packet. The portable core does not depend on exe.dev, Cloudflare, or another host; provider base URLs and optional runtime credentials are supplied by the caller.

Run the repo-owned CLI with an explicit request fixture and route configuration:

```bash
npm run --silent pilot2 -- fixtures/pilot2-timeout.json /path/to/routes.json
```

The route file supplies `id`, `provider`, `model`, `modelFamily`, `baseURL`, `timeoutMs`, and `maxOutputTokens`; it may also request `responseFormat: "json_object"` and name an `apiKeyEnv` environment variable. Secrets are resolved at runtime and are not emitted in the result.

A bounded two-family acceptance run has reached `COMPLETE` with strict Proposal v1/provenance validation and preserved model divergence. The publication-safe full artifact is stored at `artifacts/acceptance/pilot2-first-complete.json`.

Implementation: `src/dreaming/pilot2-live-composition.ts`.
CLI: `tools/agent/run-pilot2.mjs`.


## Pilot 2 bounded live critique

The critique layer runs exactly one bounded model call over frozen Pilot 2 perspectives. It receives only deterministic `CritiqueInput`, returns a `DERIVED_ONLY` artifact, and cannot add retrieval, tools, memory, canonical writes, or publication authority.

The first synthetic acceptance sequence preserved failure semantics before success:

- attempt 1: the model echoed the JSON Schema itself; deterministic validation returned `CRITIQUE_SCHEMA_INVALID`;
- attempt 2: the provider responded but the body exceeded the explicit deadline; result stayed `TIMEOUT_UNKNOWN_PROVIDER_STATE`;
- attempt 3: Qwen 3.8 27B returned a valid `DERIVED_ONLY` critique with `AGREEMENT` and `UNRESOLVED` relations, accepted only after frozen proposal/evidence reference validation.

Publication-safe receipts are stored at:

- `artifacts/acceptance/pilot2-live-critique-attempt-1-schema-echo.json`;
- `artifacts/acceptance/pilot2-live-critique-attempt-2-timeout.json`;
- `artifacts/acceptance/pilot2-first-live-critique.json`.

Implementation: `src/dreaming/pilot2-critique-live.ts`.
Contract: `specs/pilot2/live-critique/`.

## Checkpoint-aware Pilot 2 (portable synthetic boundary)

`runCheckpointedPilot2` in `src/dreaming/checkpoint-pilot2.ts` composes the
existing bounded runner with deterministic admission. It takes an explicitly
available committed checkpoint (or null), an accepted-source fingerprint and
an analysis version. Stable work identity binds the ordered evidence payload,
coverage, scope and task, not the temporary packet ID. An unavailable checkpoint,
unchanged work or no accepted new evidence causes zero adapter calls.
Incomplete/unknown empty intake remains distinct from NO_DATA.

Both independent passes must succeed with observed normal finish before a
checkpoint candidate is returned. This is not a persisted checkpoint or a
lease: no storage, scheduler, automatic retry, actual Session Search reader
or new data/model authority is introduced. A caller must independently verify
the accepted-source identity, budget, checkpoint read and atomic commit with
single-writer exclusion before using this composition in unattended execution.

## License

Project code is licensed under [Apache License 2.0](LICENSE) (SPDX: Apache-2.0). Third-party components retain their applicable licenses and notices.
