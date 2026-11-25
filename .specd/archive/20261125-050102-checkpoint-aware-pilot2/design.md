# Design: checkpoint-aware-pilot2

## Non-goals

No live reader, external model call in tests, scheduling, storage or concurrency lease. No changes to existing ledger PR51 or serializer PR59.

## Affected areas

- `src/dreaming/checkpoint-pilot2.ts` — strict input admission, deterministic work identity and bounded composition with existing Pilot 2.
- `test/checkpoint-pilot2.test.mjs` — deterministic no-call and candidate lifecycle regression.
- `README.md` — describe candidate vs durable commit.
- `tools/ci/mutation-test`, `scripts/mutation-shards.mjs`, `test/mutation-shards.test.mjs`, `.github/workflows/mutation.yml` — add a dedicated hosted checkpoint shard to keep existing long-running shards bounded.

## Approach

Validate the envelope and packet strictly with existing Zod, reject duplicate source refs, clone and freeze admitted input. Use ordered canonical identity fields and existing SHA256 helper; omit packet ID only from work identity. Checkpoint read is available with committed record/null, or unavailable. Unknown/partial empty intake stays explicit. Delegate new work to existing runPilot2 exactly once without retries. Emit a checkpoint candidate only for COMPLETE with both successful passes reporting stop; bind the actual receipt request and result fingerprint. Report no persisted checkpoint. Caller owns actual read authority, atomic storage and duplicate-run exclusion across concurrent processes.

## Key decisions

No additional model stage. Do not infer durable checkpoint from success alone or model output. Coverage changes and analysis revision changes are different work identities.

## Testing

Use synthetic fixture and spy adapters: duplicate/new identity, no-data/unknown checkpoint, malformed/duplicate evidence, full/partial/failed/unknown finish. No external calls or storage. Run existing canonical QA.

## Spec impact

Refines the existing intake contract; no new egress authorization or source identity.
