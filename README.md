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

This repository is public by design. Public code is allowed; private evidence is not. Runtime credentials remain in the selected runtime/provider secret boundary rather than Git; the current exe.dev integration is one development/acceptance implementation, not an architectural dependency. Any future Session Search evidence must stay outside Git unless it is explicitly synthetic or intentionally sanitized for publication.

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


## Pilot 2 bounded two-family run

Pilot 2 composes two explicit model-family routes through the repo-owned OpenAI-compatible adapter. Route configuration supplies `baseURL`, provider/model identity, model family, timeout, output-token bound, and optionally an environment-variable name for a bearer key; the execution path does not require exe.dev.

Run a synthetic/publication-safe request with:

    npm run pilot2 -- <request.json> <routes.json>

The runner preserves each validated perspective independently and reports `COMPLETE`, `PARTIAL`, `FAIL_CLOSED`, or `NO_DATA`; provider transport success alone never upgrades an invalid analytical artifact into success.

Implementation: `src/dreaming/pilot2-e2e.ts`, `src/dreaming/pilot2-runner.ts`.
Acceptance fixture: `fixtures/pilot2-timeout.json`.
