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
