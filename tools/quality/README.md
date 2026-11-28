# Deterministic code quality report (#128)

This advisory tool measures existing TypeScript code using c8 and
crap-typescript-core. It does not change the runtime or acceptance gates.

Install the isolated, locked tools:
    npm ci --prefix tools/quality --ignore-scripts --no-audit --no-fund
    node tools/quality/calibrate.mjs

On a clean checkout:
    tools/quality/run unit

For the combined report, use a fresh disposable loopback PostgreSQL fixture
as required by tools/ci/heavy-postgres, and run tools/quality/run combined.
Do not use a persistent database. The existing heavy-postgres version check
and runtime fixture apply. The unit and combined reports are not interchangeable.

The runner creates a new reports/quality directory for each measurement.
The report builder accepts an existing coverage JSON, and is intended for
the runner, not arbitrary historical coverage files. Do not assign a source
commit to coverage collected on a different checkout. The report includes
both coverage metrics, attribution status and unknown reasons. CRAP >30 is a
navigation aid, not an acceptance threshold. Statement coverage does not
prove branch coverage; V8 branch counts can change between suites.

The existing mutation matrix measures a different property. For main
62b5fe07, 12 exact-source mutation receipts were successful (1405 killed,
3 timed out, 991 compile errors, 0 survived, 0 uncovered). Only
runPooledSourceBatch among the five highest-CRAP methods is directly in that
matrix (source-batch-pooled); the other four require scope review.
A shard result is not a per-function mutation result. See #128.
