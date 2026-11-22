import test from 'node:test';
import assert from 'node:assert/strict';

import { exportSchemas } from '@mastra/pg';
import { CLOUDFLARE_STORAGE_SCHEMA } from '../src/runtime/cloudflare-runtime.ts';

test('issue-owned Cloudflare Postgres schema exports valid Mastra DDL within PostgreSQL identifier limits', () => {
  const ddl = exportSchemas(CLOUDFLARE_STORAGE_SCHEMA);

  assert.equal(CLOUDFLARE_STORAGE_SCHEMA, 'dw_issue23');
  assert.match(ddl, /dw_issue23/i);
  assert.match(ddl, /mastra_ai_spans/i);
  assert.equal(/public\./i.test(ddl), false);
  assert.ok(Buffer.byteLength(ddl) > 1_000);
});
