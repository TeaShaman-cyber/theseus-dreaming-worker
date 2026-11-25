\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'dreaming_worker_contract' THEN
    RAISE EXCEPTION 'WORK_PROBE_REQUIRES_DISPOSABLE_CONTRACT_DATABASE';
  END IF;
END
$$;

-- Research fixture, deliberately not the runtime migration.
CREATE SCHEMA dw_work_probe;
REVOKE ALL ON SCHEMA dw_work_probe FROM PUBLIC;
CREATE TABLE dw_work_probe.reservations (
  work_fingerprint text PRIMARY KEY CHECK (work_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  owner_token uuid NOT NULL UNIQUE,
  UNIQUE (work_fingerprint, owner_token)
);
CREATE TABLE dw_work_probe.completions (
  work_fingerprint text PRIMARY KEY,
  owner_token uuid NOT NULL,
  result_fingerprint text NOT NULL CHECK (result_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  FOREIGN KEY (work_fingerprint, owner_token)
    REFERENCES dw_work_probe.reservations(work_fingerprint, owner_token)
);
CREATE TABLE dw_work_probe.membership (
  work_fingerprint text NOT NULL REFERENCES dw_work_probe.completions(work_fingerprint),
  record_id text NOT NULL REFERENCES dw_ledger.proposal_records(record_id),
  PRIMARY KEY (work_fingerprint, record_id)
);
-- Disposable fixture only. A source checkpoint has one successor per scope;
-- the root is explicitly seeded, not inferred from an empty query.
CREATE TABLE dw_work_probe.source_checkpoints (
  scope text NOT NULL,
  checkpoint_fingerprint text NOT NULL CHECK (checkpoint_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  previous_checkpoint text,
  receipt jsonb NOT NULL,
  PRIMARY KEY (scope, checkpoint_fingerprint),
  UNIQUE NULLS NOT DISTINCT (scope, previous_checkpoint),
  FOREIGN KEY (scope, previous_checkpoint)
    REFERENCES dw_work_probe.source_checkpoints(scope, checkpoint_fingerprint)
);
GRANT USAGE ON SCHEMA dw_work_probe TO dw_runtime_issue23;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA dw_work_probe TO dw_runtime_issue23;
REVOKE ALL ON ALL TABLES IN SCHEMA dw_work_probe FROM PUBLIC;
COMMIT;
