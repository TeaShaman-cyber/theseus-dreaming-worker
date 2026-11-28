# Proposal: hyperdrive-canary-build-pin

## Motivation

Issue #23, PR #119: exact review found the synthetic preview build depended on an undeclared esbuild binary and fixture paging could accept an unknown cursor.

## Current behaviour

The lockfile already contains esbuild 0.28.2 transitively, but clean pnpm installs need a direct declaration. An unknown cursor could return page zero.

## Proposed solution

Pin the existing tool version without unrelated upgrades and reject unknown cursors, documenting the tested preview configuration.

## Specs affected

### New specs

None.

### Modified specs

- `default:ledger/postgres-storage`: QA layers unchanged; reproducible witness strengthened.
  - Depends on (added): none

## Impact

QA-only build and synthetic fixture transport. No production, model, storage or authority change.
