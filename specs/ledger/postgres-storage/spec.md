# PostgreSQL Ledger Storage Adapter

## Purpose

Persist validated append-only proposal-ledger events through the existing Cloudflare Hyperdrive/PostgreSQL boundary while preserving the in-memory ledger contract.

The current Cloudflare/Neon resource set is a development/test environment. Cloudflare CLI `production` mode names a technical deploy mode only and is not evidence of a real production deployment.

## Connection boundary

The adapter receives the existing Hyperdrive PostgreSQL connection string. It does not receive a Neon control-plane API key and does not create database resources.

A fresh `pg.Client` is created for each adapter operation. Hyperdrive owns connection pooling.

## Append behavior

Before insert, append acquires one transaction-scoped advisory lock, reads and revalidates persisted ledger history, and applies the existing `appendLedgerEvent` contract to the candidate event.

Only after validation succeeds does the adapter issue a parameterized `INSERT`. There is no UPDATE or DELETE method.

On any validation or database error the transaction is rolled back and the client is closed.

## Read behavior

Proposal and supersession rows share one global database event sequence. Reads combine both tables ordered by that sequence and revalidate each reconstructed event through the existing append-only ledger contract before returning it.

Persisted rows therefore do not gain authority merely by being stored in PostgreSQL.

## QA layers

Fast unit tests use a small client fake for SQL mapping, rollback, cleanup and validation boundaries.

Hosted Heavy PostgreSQL starts the PostgreSQL 18 service already present on the current GitHub runner, replays the migration twice, verifies grants/FKs/shared sequence, and exercises the real adapter.

Neon schema-only preview remains a separate provider-specific compatibility check.

## Non-scope

No automatic Dreaming Worker invocation, scheduler, Session Search read tool, external API route, real production deployment, or application of `dw_ledger` to the long-lived cloud development/test database is part of this increment.
