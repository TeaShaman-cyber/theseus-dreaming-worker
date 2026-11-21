import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('mcp-gate patch adds opt-in /mcp upstream rewrite and is idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-gate-patch-'));
  const gate = join(dir, 'mcp-gate.py');
  writeFileSync(
    gate,
    [
      'import os',
      'PORT = int(os.environ.get("PORT") or 8000)',
      'async def proxy(request):',
      '    url = UPSTREAM + request.url.path + (f"?{request.url.query}" if request.url.query else "")',
      '',
    ].join('\n'),
  );

  const patcher = join(process.cwd(), 'tools', 'patch_mcp_gate_path.py');
  execFileSync('python3', [patcher, gate]);
  const once = readFileSync(gate, 'utf8');

  assert.match(once, /MCP_UPSTREAM_PATH = os\.environ\.get\("MCP_UPSTREAM_PATH", ""\)\.strip\(\)/);
  assert.match(once, /request\.url\.path\.rstrip\("\/"\) == "\/mcp"/);
  assert.match(once, /url = UPSTREAM \+ upstream_path/);

  execFileSync('python3', [patcher, gate]);
  const twice = readFileSync(gate, 'utf8');
  assert.equal(twice, once);
});
