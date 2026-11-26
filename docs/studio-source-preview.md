# Studio source-batch preview

Studio is the development surface, not the source or ledger authority.
The registered workflow `dreaming-source-preview` executes the existing
portable core with the checked-in synthetic source-reader fixture. Start it
from **Workflows** with `{"fixture":"source-reader"}`.

| Studio node | Existing implementation | Inspectable output |
| --- | --- | --- |
| verify-source | `decodeSourceHandoff` | Scope and selected count |
| prepare-plan | `prepareSourceBatchExecution` (verified pages, checkpoint admission) | Plan and work fingerprints |
| analyze-selected | `runDurablePilot2` (two independent passes, validation and readback) | Synthetic completion records, simulated call count |
| verify-receipt | `prepareSourceBatchReceipt` | Verified v1 receipt candidate and work count |

The workflow has a fresh in-memory test store per run, two deterministic
synthetic adapters, and no network/model provider or database route. Mastra
workflow step history can contain only the synthetic fixture results. It
does not stage a real source plan, acknowledge a source checkpoint or prove
durability. `IN_MEMORY_PREVIEW` and `checkpointAdvanced: false` are explicit
in the result. Optional live critique is not part of this source path.

The actual durable source path uses the same kernel but
`createPostgresSourceBatchStore.initialize → stage → runSelected → acknowledge`,
with original-plan linkage and independent readback in the existing ledger.
See [ledger contract](ledger-neon.md) and the hosted PostgreSQL contract.
The #79 experiments exercised that path on PostgreSQL 16; the canonical
hosted gate is PostgreSQL 18 and the configured Neon project is PostgreSQL 17.
Those substrates are not interchangeable acceptance evidence.

The registered graph and per-step schemas are visible through
`GET /api/workflows/dreaming-source-preview`. The canonical Node test suite
checks registration, graph order, successful synthetic execution and scope
rejection. Keep this projection and its regression test aligned when
changing the selected-work or receipt interfaces; do not introduce parallel
worker business logic for visualization. The development service must run
from the repository root (the fixture is read from its fixed checked-in
path). This graph is not registered in the Cloudflare worker entrypoint.

No change to the Pilot 1 stored agent, model configuration, external
observability policy or production deployment is required.
