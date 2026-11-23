# Dreaming Worker ledger on Neon

## Plain mechanism

Session Search remains the evidence/search system. Dreaming Worker consumes bounded evidence, produces `DERIVED_ONLY` proposals, and stores only those derived records in its own Neon ledger.

```text
Session Search shards
      | bounded evidence + shard/generation provenance
      v
Dreaming Worker
      | validated proposal / supersession event
      v
existing Hyperdrive -> dreaming_issue23.dw_ledger
```

The ledger is not another Session Search shard and is not copied into the shard corpus.

Future ChatGPT access should use the Session Search surface without sharing database credentials:

```text
ChatGPT
  -> Session Search App/tool (future session_hypotheses)
  -> bounded Dreaming Worker ledger reader
  -> dw_ledger (read only)
```

This keeps source retrieval and model-derived hypotheses visibly separate while allowing one user-facing retrieval surface.

## Existing cloud boundary

The intended host is the already-created Dreaming Worker Neon project `theseus-ss-dreaming-issue23`, database `dreaming_issue23`. Mastra uses schema `dw_issue23`; the ledger gets its own `dw_ledger` schema.

The existing Hyperdrive/runtime role is reused for the Worker write path. Ledger grants are stricter than Mastra grants: `SELECT + INSERT` only. Session Search does not reuse that runtime credential.

## Not performed by this design

The checked-in SQL is not applied by this change. There is no automatic write path, no ledger reader endpoint, no Session Search tool change, and no production deployment.
