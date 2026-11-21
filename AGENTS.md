# Agent instructions

Before changing architecture, workflow semantics, storage, provider routing, or authority boundaries, read `contracts/dreaming-worker.yaml`.

Do not silently broaden the worker beyond that contract. If a requested change conflicts with it, surface the conflict and update the contract through the normal Issue/PR path before implementation.

Session Search is an evidence/currentness dependency, never hypothesis authority. Mastra/Studio/Agent Builder are development interfaces, not canonical state or production authority.
