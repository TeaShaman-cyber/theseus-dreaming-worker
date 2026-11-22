import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createPilot1Agent } from '../src/runtime/pilot1-agent.ts';

const config = JSON.parse(
  readFileSync('config/agents/dreaming-worker-pilot1.json', 'utf8'),
);

test('production Pilot 1 agent is constructed from Git desired config without Editor state', async () => {
  const model = 'test/provider-model';
  const agent = createPilot1Agent(config, model);

  assert.equal(agent.id, config.id);
  assert.equal(agent.name, config.desired.name);
  assert.equal(agent.model, model);
  assert.equal(await agent.getInstructions(), config.desired.instructions);
  assert.equal(agent.getDescription(), config.desired.description);
  assert.deepEqual(await agent.getMetadata(), config.desired.metadata);
  assert.equal(await agent.getMemory(), undefined);
  assert.deepEqual(await agent.getToolsForExecution({ requestContext: undefined }), {});
});

test('production Pilot 1 agent rejects Git config that enables memory', () => {
  const changed = structuredClone(config);
  changed.desired.memory = { enabled: true };

  assert.throws(
    () => createPilot1Agent(changed, 'test/provider-model'),
    /PILOT1_STATIC_AGENT_INVALID: memory must remain disabled/,
  );
});

test('production Pilot 1 agent rejects Git config that enables tools', () => {
  const changed = structuredClone(config);
  changed.desired.tools = { unexpectedTool: {} };

  assert.throws(
    () => createPilot1Agent(changed, 'test/provider-model'),
    /PILOT1_STATIC_AGENT_INVALID: tools must remain disabled/,
  );
});
