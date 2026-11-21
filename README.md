# Theseus Dreaming Worker

Private implementation workspace for a bounded background dreaming/hypothesis worker.

The durable purpose and authority boundary live in [`contracts/dreaming-worker.yaml`](contracts/dreaming-worker.yaml). Read that contract before changing workflow semantics, provider routing, storage, or authority.

Architecture coordination: `TeaShaman-cyber/theseus-research#127`. Bootstrap implementation: issue #1 in this repository.

## Development surface

Mastra Agent Builder runs in development mode on the existing governed exe.dev VM `theseus-exe-shell-probe`.

- Studio / Agent Builder: private exe.dev HTTPS proxy on port 8000.
- Built-in Mastra MCP: `/api/mcp`.
- Local Builder state: ignored LibSQL files and `.mastra/` workspace; Git remains code/contract authority.
- Production runtime is deliberately undecided and separate from this development surface.

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

Bootstrap verification performs model discovery only. It does not send Session Search evidence, make inference calls, promote hypotheses to truth, or write canonical memory/user preferences.
