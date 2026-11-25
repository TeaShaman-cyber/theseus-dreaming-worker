\set ON_ERROR_STOP on

DO $$
DECLARE
  runtime_role constant text := 'dw_runtime_issue23';
  proposal_table constant text := 'dw_ledger.proposal_records';
  supersession_table constant text := 'dw_ledger.supersession_events';
  fk_count integer;
  proposal_seq_default text;
  supersession_seq_default text;
BEGIN
  IF to_regclass(proposal_table) IS NULL OR to_regclass(supersession_table) IS NULL THEN
    RAISE EXCEPTION 'DW_LEDGER_TABLE_MISSING';
  END IF;

  IF NOT has_schema_privilege(runtime_role, 'dw_ledger', 'USAGE') THEN
    RAISE EXCEPTION 'DW_LEDGER_RUNTIME_USAGE_MISSING';
  END IF;
  IF has_schema_privilege(runtime_role, 'dw_ledger', 'CREATE') THEN
    RAISE EXCEPTION 'DW_LEDGER_RUNTIME_CREATE_FORBIDDEN';
  END IF;

  IF NOT has_table_privilege(runtime_role, proposal_table, 'SELECT')
     OR NOT has_table_privilege(runtime_role, proposal_table, 'INSERT')
     OR NOT has_table_privilege(runtime_role, supersession_table, 'SELECT')
     OR NOT has_table_privilege(runtime_role, supersession_table, 'INSERT') THEN
    RAISE EXCEPTION 'DW_LEDGER_RUNTIME_APPEND_PRIVILEGES_MISSING';
  END IF;

  IF has_table_privilege(runtime_role, proposal_table, 'UPDATE')
     OR has_table_privilege(runtime_role, proposal_table, 'DELETE')
     OR has_table_privilege(runtime_role, proposal_table, 'TRUNCATE')
     OR has_table_privilege(runtime_role, supersession_table, 'UPDATE')
     OR has_table_privilege(runtime_role, supersession_table, 'DELETE')
     OR has_table_privilege(runtime_role, supersession_table, 'TRUNCATE') THEN
    RAISE EXCEPTION 'DW_LEDGER_RUNTIME_MUTATION_PRIVILEGE_FORBIDDEN';
  END IF;

  SELECT count(*)
  INTO fk_count
  FROM pg_constraint
  WHERE conrelid = 'dw_ledger.supersession_events'::regclass
    AND contype = 'f';

  IF fk_count <> 2 THEN
    RAISE EXCEPTION 'DW_LEDGER_SUPERSESSION_FK_COUNT_INVALID: %', fk_count;
  END IF;

  IF to_regclass('dw_ledger.event_seq') IS NULL THEN
    RAISE EXCEPTION 'DW_LEDGER_EVENT_SEQUENCE_MISSING';
  END IF;

  SELECT pg_get_expr(d.adbin, d.adrelid)
  INTO proposal_seq_default
  FROM pg_attrdef d
  JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
  WHERE d.adrelid = 'dw_ledger.proposal_records'::regclass
    AND a.attname = 'event_seq';

  SELECT pg_get_expr(d.adbin, d.adrelid)
  INTO supersession_seq_default
  FROM pg_attrdef d
  JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
  WHERE d.adrelid = 'dw_ledger.supersession_events'::regclass
    AND a.attname = 'event_seq';

  IF proposal_seq_default IS NULL
     OR supersession_seq_default IS NULL
     OR proposal_seq_default NOT LIKE '%dw_ledger.event_seq%'
     OR supersession_seq_default NOT LIKE '%dw_ledger.event_seq%' THEN
    RAISE EXCEPTION 'DW_LEDGER_SHARED_EVENT_SEQUENCE_INVALID';
  END IF;

  IF NOT has_sequence_privilege(runtime_role, 'dw_ledger.event_seq', 'USAGE') THEN
    RAISE EXCEPTION 'DW_LEDGER_RUNTIME_SEQUENCE_USAGE_MISSING';
  END IF;

  IF has_schema_privilege('public', 'dw_ledger', 'USAGE')
     OR has_schema_privilege('public', 'dw_ledger', 'CREATE') THEN
    RAISE EXCEPTION 'DW_LEDGER_PUBLIC_SCHEMA_PRIVILEGE_FORBIDDEN';
  END IF;
END
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_reservations','work_completions','work_membership','source_checkpoints','source_plans','source_work_origins'] LOOP
    IF to_regclass('dw_ledger.' || t) IS NULL
      OR NOT has_table_privilege('dw_runtime_issue23', 'dw_ledger.' || t, 'SELECT')
      OR NOT has_table_privilege('dw_runtime_issue23', 'dw_ledger.' || t, 'INSERT')
      OR has_table_privilege('dw_runtime_issue23', 'dw_ledger.' || t, 'UPDATE')
      OR has_table_privilege('dw_runtime_issue23', 'dw_ledger.' || t, 'DELETE')
      OR has_table_privilege('dw_runtime_issue23', 'dw_ledger.' || t, 'TRUNCATE')
    THEN RAISE EXCEPTION 'WORK_TABLE_GRANTS_INVALID: %', t;
    END IF;
  END LOOP;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index
    WHERE indrelid='dw_ledger.source_checkpoints'::regclass
      AND indisunique AND indnullsnotdistinct
      AND pg_get_indexdef(indexrelid) LIKE '%(chain_id, previous_checkpoint)%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='dw_ledger.source_checkpoints'::regclass AND contype='f'
      AND confrelid=conrelid
      AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (chain_id, previous_checkpoint)%'
  ) THEN RAISE EXCEPTION 'SOURCE_CHECKPOINT_CHAIN_CONSTRAINT_INVALID';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='dw_ledger.source_plans'::regclass AND contype='f'
      AND confrelid='dw_ledger.source_checkpoints'::regclass
      AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (chain_id, previous_checkpoint)%'
  ) THEN RAISE EXCEPTION 'SOURCE_PLAN_PARENT_CONSTRAINT_INVALID';
  END IF;
END
$$;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_constraint
      WHERE conrelid='dw_ledger.source_work_origins'::regclass AND contype='f'
      AND confrelid IN ('dw_ledger.source_plans'::regclass,'dw_ledger.work_reservations'::regclass)) <> 2
  THEN RAISE EXCEPTION 'SOURCE_WORK_ORIGIN_CONSTRAINT_INVALID';
  END IF;
END
$$;
