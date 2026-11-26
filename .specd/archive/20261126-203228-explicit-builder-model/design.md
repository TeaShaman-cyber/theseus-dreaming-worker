# Design: explicit-builder-model

## Non-goals

No replacement model, new provider, production change or paid calls.

## Affected areas

- `src/mastra/index.ts` — conditionally register Builder and enable its editor feature.
- `.env.example` — blank explicit model setting.
- `README.md` — document disabled default.
- `tools/ci/studio-smoke.mjs` — assert no implicit agent and explicit config enables it.

## Approach

Use the existing trimmed environment accessor. Empty or absent selection disables model-backed Builder; preserve storage, Editor and workflows. Explicit nonblank selection enables the same existing Builder. Verify actual bundled HTTP API in both modes without invoking inference.

## Testing

RED on existing fallback, then GREEN on unset, whitespace and explicit selection. Canonical QA including bundled workflow smoke.

## Spec impact

Preserve core contract; strengthen development configuration verification.
