import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../infra/postgres/dw_ledger_v1.sql', import.meta.url), 'utf8');

test('ledger DDL uses a dedicated schema and never creates ledger tables in Mastra schema', () => {
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS dw_ledger/i);
  assert.match(sql, /dw_ledger\.proposal_records/i);
  assert.match(sql, /dw_ledger\.supersession_events/i);
  assert.doesNotMatch(sql, /CREATE TABLE[^;]*dw_issue23\./i);
});

test('ledger DDL keeps authority derived-only and references immutable proposal records', () => {
  assert.match(sql, /authority[^;]*DERIVED_ONLY/is);
  assert.match(sql, /proposal_type[^;]*(FACT|INFERENCE|HYPOTHESIS|UNKNOWN)/is);
  assert.match(sql, /superseded_record_id[^;]*REFERENCES\s+dw_ledger\.proposal_records\s*\(record_id\)/is);
  assert.match(sql, /replacement_record_id[^;]*REFERENCES\s+dw_ledger\.proposal_records\s*\(record_id\)/is);
  assert.match(sql, /CHECK\s*\(superseded_record_id\s*<>\s*replacement_record_id\)/i);
});

test('runtime ledger grants are append-only and schema-bounded', () => {
  assert.match(sql, /GRANT USAGE ON SCHEMA dw_ledger TO dw_runtime_issue23/i);
  assert.match(sql, /GRANT SELECT, INSERT ON TABLE[\s\S]*dw_runtime_issue23/i);
  assert.match(sql, /REVOKE CREATE ON SCHEMA dw_ledger FROM dw_runtime_issue23/i);
  assert.match(sql, /REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER[\s\S]*FROM dw_runtime_issue23/i);
  assert.doesNotMatch(sql, /GRANT\s+ALL/i);
  assert.doesNotMatch(sql, /GRANT[^;]*TO\s+PUBLIC/i);
});

test('ledger event ids and proposal fingerprints retain sha256 wire shape', () => {
  const shaCheckCount = (sql.match(/\^sha256:\[0-9a-f\]\{64\}\$/g) ?? []).length;
  assert.ok(shaCheckCount >= 3);
});
