---
name: mastra-builder-usage
description: "Use when working on Theseus Dreaming Worker or developing, configuring, testing, debugging, evaluating, or inspecting agents, prompts, model routes, workflows, memory or traces in our Mastra Agent Builder laboratory. Trigger also on Russian references to Мастра, Мастер in agent-development context, Дриминг and воркер. Prefer the existing Mastra Builder MCP for live laboratory operations; use Git for source and contracts."
---

# Mastra Builder — Theseus development router

Read and obey Theseus Project Contract first. This skill routes work; it does not grant permissions or redefine the project.

## Choose the actual task

- Agent configuration, available models, stored agent versions, workflow runs, memory and traces: discover current Mastra Builder MCP tools, then use the existing connected App directly. Start with the narrow read-only list/get operation. Do not recreate its server, add a gateway, or use a shell merely to repeat the same supported operation.
- Dreaming Worker source, architecture, tests, deployment configuration or IaC: read the current repository contract and relevant specification. Use the governed exe.dev route for repository-native work and QA. Where a change affects agent behavior, inspect the current Builder configuration or relevant run as well; do not infer runtime state from Git.
- Historical reconstruction: Session Search, not Builder memory. Production evidence intake: the selected Session Search native integration, not this development MCP.

Do not invoke Mastra for unrelated agent systems just because the word "agent" appears. Use the named tool or runtime that owns the actual task. No inference or mutation is necessary merely to discover the route.

## Existing authoritative documentation

Repository: TeaShaman-cyber/theseus-dreaming-worker.
Read only the relevant current sections:

- README.md — Development surface and model providers.
- contracts/dreaming-worker.yaml and AGENTS.md — goal, boundaries and SpecD workflow.
- docs/exe-dev-remote-mcp.md — existing OAuth gate and Mastra MCP deployment.
- docs/observability.md — local traces, Grafana/Langfuse and evidence scope.
- .agents/skills/mastra/SKILL.md and references/mastra-api.md — vendor CLI/API mechanics.
- tools/agent/sync-pilot1.mjs — existing Git-to-Builder configuration synchronization.

The existing App connects to Mastra on the governed exe.dev VM through mcp-gate. Do not copy credentials or bypass OAuth. If MCP lacks a needed operation, use the documented Mastra API/CLI on the verified existing instance, under exe-dev-core-router. If blocked, report the observed failure before a finite fallback. No new Factory instance is implied.

## Verify and preserve modularity

Builder/Studio is the development laboratory, not production or canonical state. Git owns code/contracts; live reads own runtime configuration; deterministic QA owns test results. Keep Dreaming Core portable and keep provider/storage/runtime adapters outside it. Do not turn a laboratory workflow into a second production implementation.

Before changing a stored agent, inspect the current config, model availability and existing sync path. Preserve tools, memory, scope, model budgets and version constraints unless an authorized change requires otherwise. Apply the smallest change, independently read back the stored version and compare with Git intent. Use the existing deterministic sync/check and QA where relevant. Do not silently publish drafts, enable private evidence, expand privileges or run paid inference.

For experiments, use authorized synthetic/publication-safe fixtures, bounded calls and observed model/provider receipts. Inspect trace summaries first, then the exact needed spans; avoid exporting private bodies. Separate a missing trace from a failed run. Do not treat a model's judgment as QA or as truth.

For the explicit probe MASTRA_BUILDER_SKILL_PROBE, return MB_OK_V1 only after reading this installed skill. A probe proves skill loading, not implicit invocation or server connectivity; verify the latter separately with list_agents.
