# Pilot 2 — Bounded Critique Contract

## Purpose

This layer analyzes already-frozen Pilot 2 perspectives. It does not choose a winner and does not redefine source evidence.

The critique artifact is a derived interpretation only. Original Pilot 2 proposal sets, failures, provenance, and receipts remain authoritative records of what the first passes actually produced.

## Input Contract

Critique input may be built only from a Pilot 2 `COMPLETE` or `PARTIAL` result with at least one valid perspective.

The input must preserve:

- Pilot 2 packet/request fingerprints;
- configured perspective identity;
- each validated proposal unchanged;
- a stable fingerprint for each proposal;
- original source references and evidence hashes;
- failed perspective information when Pilot 2 was `PARTIAL`.

`NO_DATA` and `FAIL_CLOSED` results do not create critique work.

## Critique Artifact

A critique artifact uses schema `theseus.dreaming-worker.critique.v1` and authority `DERIVED_ONLY`.

It may classify a relation as:

- `AGREEMENT` — two or more distinct perspectives support a materially aligned interpretation;
- `DISAGREEMENT` — two or more distinct perspectives materially diverge;
- `UNRESOLVED` — available frozen proposals are insufficient to classify the relation honestly.

Every relation must reference existing frozen proposal fingerprints and evidence references. Invented proposal or evidence references are rejected deterministically.

`AGREEMENT` and `DISAGREEMENT` require proposal references from at least two perspectives. `DISAGREEMENT` and `UNRESOLVED` must state what additional evidence could reduce the uncertainty.

## Authority Boundary

Critique must never:

- rewrite or delete a frozen first-pass proposal;
- promote agreement, majority vote, or model confidence into truth;
- change original FACT / INFERENCE / HYPOTHESIS / UNKNOWN classifications;
- alter permissions or runtime authority;
- write canonical memory or user preferences;
- publish externally;
- fetch new evidence on its own.

## First Increment Boundary

The first increment implements only deterministic critique-input construction and critique-artifact validation.

It does not yet perform a live critique model call, select a critique model, add routing heuristics, schedule work, persist a durable ledger, or consume private Session Search evidence.

## Spec Dependencies

- `default:pilot2/independent-perspectives`
- `default:worker/core-contract`
