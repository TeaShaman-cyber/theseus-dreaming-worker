BEGIN;

CREATE SCHEMA IF NOT EXISTS dw_ledger AUTHORIZATION dreaming_issue23_owner;
REVOKE ALL ON SCHEMA dw_ledger FROM PUBLIC;

CREATE SEQUENCE IF NOT EXISTS dw_ledger.event_seq;

CREATE TABLE IF NOT EXISTS dw_ledger.proposal_records (
  event_seq bigint NOT NULL DEFAULT nextval('dw_ledger.event_seq') UNIQUE,
  record_id text PRIMARY KEY
    CHECK (record_id ~ '^sha256:[0-9a-f]{64}$'),
  schema_name text NOT NULL DEFAULT 'theseus.dreaming-worker.proposal-ledger-record.v1'
    CHECK (schema_name = 'theseus.dreaming-worker.proposal-ledger-record.v1'),
  authority text NOT NULL DEFAULT 'DERIVED_ONLY'
    CHECK (authority = 'DERIVED_ONLY'),
  proposal_fingerprint text NOT NULL
    CHECK (proposal_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  packet_id text NOT NULL CHECK (btrim(packet_id) <> ''),
  evidence_fingerprint text NOT NULL CHECK (btrim(evidence_fingerprint) <> ''),
  request_fingerprint text NOT NULL CHECK (btrim(request_fingerprint) <> ''),
  perspective_id text NOT NULL CHECK (btrim(perspective_id) <> ''),
  route_id text NOT NULL CHECK (btrim(route_id) <> ''),
  route_provider text NOT NULL CHECK (btrim(route_provider) <> ''),
  route_model text NOT NULL CHECK (btrim(route_model) <> ''),
  route_model_family text NOT NULL CHECK (btrim(route_model_family) <> ''),
  proposal_type text NOT NULL
    CHECK (proposal_type IN ('FACT', 'INFERENCE', 'HYPOTHESIS', 'UNKNOWN')),
  proposal jsonb NOT NULL CHECK (jsonb_typeof(proposal) = 'object'),
  inserted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS dw_ledger_proposal_records_packet_idx
  ON dw_ledger.proposal_records (packet_id);
CREATE INDEX IF NOT EXISTS dw_ledger_proposal_records_evidence_idx
  ON dw_ledger.proposal_records (evidence_fingerprint);
CREATE INDEX IF NOT EXISTS dw_ledger_proposal_records_proposal_idx
  ON dw_ledger.proposal_records (proposal_fingerprint);
CREATE INDEX IF NOT EXISTS dw_ledger_proposal_records_type_idx
  ON dw_ledger.proposal_records (proposal_type);

CREATE TABLE IF NOT EXISTS dw_ledger.supersession_events (
  event_seq bigint NOT NULL DEFAULT nextval('dw_ledger.event_seq') UNIQUE,
  event_id text PRIMARY KEY
    CHECK (event_id ~ '^sha256:[0-9a-f]{64}$'),
  schema_name text NOT NULL DEFAULT 'theseus.dreaming-worker.proposal-ledger-supersession.v1'
    CHECK (schema_name = 'theseus.dreaming-worker.proposal-ledger-supersession.v1'),
  authority text NOT NULL DEFAULT 'DERIVED_ONLY'
    CHECK (authority = 'DERIVED_ONLY'),
  superseded_record_id text NOT NULL
    REFERENCES dw_ledger.proposal_records(record_id) ON DELETE RESTRICT,
  replacement_record_id text NOT NULL
    REFERENCES dw_ledger.proposal_records(record_id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  inserted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (superseded_record_id <> replacement_record_id)
);

CREATE INDEX IF NOT EXISTS dw_ledger_supersession_source_idx
  ON dw_ledger.supersession_events (superseded_record_id);
CREATE INDEX IF NOT EXISTS dw_ledger_supersession_replacement_idx
  ON dw_ledger.supersession_events (replacement_record_id);

CREATE TABLE IF NOT EXISTS dw_ledger.work_reservations (
  work_fingerprint text PRIMARY KEY CHECK (work_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  owner_token uuid NOT NULL UNIQUE,
  UNIQUE (work_fingerprint, owner_token)
);

CREATE TABLE IF NOT EXISTS dw_ledger.work_completions (
  work_fingerprint text PRIMARY KEY,
  owner_token uuid NOT NULL,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  result_fingerprint text NOT NULL CHECK (result_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  projection_fingerprint text NOT NULL CHECK (projection_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  observed jsonb NOT NULL CHECK (jsonb_typeof(observed) = 'array'),
  FOREIGN KEY (work_fingerprint, owner_token)
    REFERENCES dw_ledger.work_reservations(work_fingerprint, owner_token)
);

CREATE TABLE IF NOT EXISTS dw_ledger.work_membership (
  work_fingerprint text NOT NULL REFERENCES dw_ledger.work_completions(work_fingerprint),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  record_id text NOT NULL REFERENCES dw_ledger.proposal_records(record_id),
  PRIMARY KEY (work_fingerprint, ordinal),
  UNIQUE (work_fingerprint, record_id)
);

-- One explicit root and one successor per source/analysis chain.
CREATE TABLE IF NOT EXISTS dw_ledger.source_checkpoints (
  chain_id text NOT NULL CHECK (chain_id ~ '^sha256:[0-9a-f]{64}$'),
  checkpoint_fingerprint text NOT NULL CHECK (checkpoint_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  previous_checkpoint text,
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  PRIMARY KEY (chain_id, checkpoint_fingerprint),
  UNIQUE NULLS NOT DISTINCT (chain_id, previous_checkpoint),
  FOREIGN KEY (chain_id, previous_checkpoint)
    REFERENCES dw_ledger.source_checkpoints(chain_id, checkpoint_fingerprint),
  CHECK (previous_checkpoint IS DISTINCT FROM checkpoint_fingerprint)
);

-- Pending metadata witnesses: separate from acknowledged source progress.
CREATE TABLE IF NOT EXISTS dw_ledger.source_plans (
  chain_id text NOT NULL,
  previous_checkpoint text NOT NULL,
  plan_fingerprint text NOT NULL CHECK (plan_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
  PRIMARY KEY (chain_id, previous_checkpoint, plan_fingerprint),
  FOREIGN KEY (chain_id, previous_checkpoint)
    REFERENCES dw_ledger.source_checkpoints(chain_id, checkpoint_fingerprint)
);

-- Runtime access is intentionally append-only for ledger data.
GRANT USAGE ON SCHEMA dw_ledger TO dw_runtime_issue23;
REVOKE CREATE ON SCHEMA dw_ledger FROM dw_runtime_issue23;

GRANT SELECT, INSERT ON TABLE
  dw_ledger.proposal_records,
  dw_ledger.supersession_events,
  dw_ledger.work_reservations,
  dw_ledger.work_completions,
  dw_ledger.work_membership,
  dw_ledger.source_checkpoints,
  dw_ledger.source_plans
TO dw_runtime_issue23;

REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  dw_ledger.proposal_records,
  dw_ledger.supersession_events,
  dw_ledger.work_reservations,
  dw_ledger.work_completions,
  dw_ledger.work_membership,
  dw_ledger.source_checkpoints,
  dw_ledger.source_plans
FROM dw_runtime_issue23;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA dw_ledger TO dw_runtime_issue23;
REVOKE ALL ON ALL TABLES IN SCHEMA dw_ledger FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA dw_ledger FROM PUBLIC;

COMMIT;
