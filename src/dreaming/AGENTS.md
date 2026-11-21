# Code Review Context for Dreaming Worker Core

When reviewing changes under `src/dreaming/`, use persisted SpecD links as repository context when they apply.

If a changed file or named symbol appears in `specs/**/spec-lock.json` under `implementation`:

1. Read the corresponding `spec.md` and `verify.md` before judging semantic correctness.
2. Treat those artifacts as the intended behavior and verification contract for that linked implementation.
3. Do not treat the existence of a link, passing mutation score, passing CI, or runtime trace as proof that the implementation satisfies the full human requirement.
4. If the link is missing, stale, ambiguous, or does not cover the changed behavior, say that the SpecD context is insufficient instead of inferring compliance.
5. Keep deterministic QA, runtime readback, semantic conformance, and repository authority as separate claims.

Do not duplicate linked requirement text here; the canonical requirement text remains in the SpecD artifacts.
