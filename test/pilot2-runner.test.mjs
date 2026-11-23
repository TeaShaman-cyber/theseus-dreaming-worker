import test from 'node:test';
import assert from 'node:assert/strict';

import { runPilot2 } from '../src/dreaming/pilot2-runner.ts';

const packet = {
  schema: 'theseus-evidence-packet-v1',
  packetId: 'fixture-pilot2-001',
  acceptedNewEvidence: true,
  coverage: { state: 'PARTIAL', currentness: 'UNKNOWN' },
  evidence: [
    {
      sourceRef: 'fixture:message:1',
      evidenceHash: 'sha256:fixture-message-1',
      text: 'Synthetic evidence: a provider route changed behavior.',
    },
  ],
};

const request = {
  scope: 'SYNTHETIC_FIXTURE',
  task: 'Produce two independent bounded perspectives.',
  packet,
};

function factOutput(claim) {
  return JSON.stringify({
    schema: 'theseus.dreaming-worker.proposals.v1',
    proposals: [
      {
        type: 'FACT',
        claim,
        source_refs: [
          {
            source_ref: 'fixture:message:1',
            evidence_hash: 'sha256:fixture-message-1',
          },
        ],
      },
    ],
  });
}

function route({
  id,
  provider,
  model,
  modelFamily,
  infer,
}) {
  return { id, provider, model, modelFamily, infer };
}

const qwenRoute = infer =>
  route({
    id: 'groq-qwen',
    provider: 'groq',
    model: 'qwen/qwen3.8-27b',
    modelFamily: 'qwen',
    infer,
  });

const mistralRoute = infer =>
  route({
    id: 'openrouter-mistral',
    provider: 'openrouter',
    model: 'mistralai/mistral-small-3.2-24b-instruct',
    modelFamily: 'mistral',
    infer,
  });

test('Pilot 2 short-circuits NO_DATA before either model pass', async () => {
  let calls = 0;

  const result = await runPilot2(
    {
      ...request,
      packet: { ...packet, acceptedNewEvidence: false, evidence: [] },
    },
    [
      qwenRoute(async () => {
        calls += 1;
        throw new Error('must not run');
      }),
      mistralRoute(async () => {
        calls += 1;
        throw new Error('must not run');
      }),
    ],
  );

  assert.equal(calls, 0);
  assert.equal(result.outcome, 'NO_DATA');
  assert.deepEqual(result.passes, []);
  assert.equal(result.receipt.confirmedExternalModelCalls, 0);
  assert.equal(result.receipt.validPasses, 0);
  assert.equal(result.receipt.failedPasses, 0);
  assert.equal(result.receipt.independence, 'NOT_EVALUATED');
});

test('Pilot 2 gives both blind first passes the same request and evidence fingerprints', async () => {
  const seen = [];

  const result = await runPilot2(request, [
    qwenRoute(async (_input, correlation) => {
      seen.push({ route: 'qwen', correlation });
      return {
        text: factOutput('The route changed behavior.'),
        provider: 'groq',
        model: 'qwen/qwen3.8-27b',
        toolCalls: [],
      };
    }),
    mistralRoute(async (_input, correlation) => {
      seen.push({ route: 'mistral', correlation });
      return {
        text: factOutput('The route changed behavior.'),
        provider: 'openrouter',
        model: 'mistralai/mistral-small-3.2-24b-instruct',
        toolCalls: [],
      };
    }),
  ]);

  assert.equal(result.outcome, 'COMPLETE');
  assert.equal(seen.length, 2);
  assert.equal(
    seen[0].correlation.requestFingerprint,
    seen[1].correlation.requestFingerprint,
  );
  assert.equal(
    seen[0].correlation.evidenceFingerprint,
    seen[1].correlation.evidenceFingerprint,
  );
  assert.equal(result.receipt.confirmedExternalModelCalls, 2);
  assert.equal(result.receipt.validPasses, 2);
  assert.equal(result.receipt.failedPasses, 0);
  assert.equal(result.receipt.independence, 'CONFIGURED_DISTINCT');
});

test('Pilot 2 rejects same-family routes before inference', async () => {
  let calls = 0;

  const result = await runPilot2(request, [
    qwenRoute(async () => {
      calls += 1;
      throw new Error('must not run');
    }),
    route({
      id: 'openrouter-qwen',
      provider: 'openrouter',
      model: 'qwen/qwen3.8-27b',
      modelFamily: 'qwen',
      infer: async () => {
        calls += 1;
        throw new Error('must not run');
      },
    }),
  ]);

  assert.equal(calls, 0);
  assert.equal(result.outcome, 'FAIL_CLOSED');
  assert.equal(result.terminalFailure.code, 'INDEPENDENCE_NOT_ESTABLISHED');
  assert.equal(result.receipt.confirmedExternalModelCalls, 0);
  assert.equal(result.receipt.independence, 'REJECTED_SAME_FAMILY');
});

test('Pilot 2 returns PARTIAL when exactly one pass succeeds', async () => {
  const result = await runPilot2(request, [
    qwenRoute(async () => ({
      text: factOutput('Qwen produced a valid perspective.'),
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      toolCalls: [],
    })),
    mistralRoute(async () => {
      throw new Error('provider timeout after 30s');
    }),
  ]);

  assert.equal(result.outcome, 'PARTIAL');
  assert.equal(result.receipt.validPasses, 1);
  assert.equal(result.receipt.failedPasses, 1);
  assert.equal(result.receipt.confirmedExternalModelCalls, 1);
  assert.equal(result.receipt.unresolvedExternalCallAttempts, 1);
  assert.equal(result.passes[0].status, 'SUCCESS');
  assert.equal(result.passes[1].status, 'FAILED');
  assert.equal(result.passes[1].failure.code, 'TIMEOUT_UNKNOWN_PROVIDER_STATE');
  assert.equal(result.passes[0].proposalSet.proposals[0].claim, 'Qwen produced a valid perspective.');
});

test('Pilot 2 returns FAIL_CLOSED rather than NO_DATA when both accepted-evidence passes fail', async () => {
  const result = await runPilot2(request, [
    qwenRoute(async () => {
      throw new Error('provider timeout');
    }),
    mistralRoute(async () => ({
      text: '   ',
      provider: 'openrouter',
      model: 'mistralai/mistral-small-3.2-24b-instruct',
      finishReason: 'length',
      toolCalls: [],
    })),
  ]);

  assert.equal(result.outcome, 'FAIL_CLOSED');
  assert.equal(result.receipt.validPasses, 0);
  assert.equal(result.receipt.failedPasses, 2);
  assert.equal(result.receipt.confirmedExternalModelCalls, 0);
  assert.equal(result.receipt.unresolvedExternalCallAttempts, 2);
  assert.equal(result.passes[0].failure.code, 'TIMEOUT_UNKNOWN_PROVIDER_STATE');
  assert.equal(result.passes[1].failure.code, 'OUTPUT_BUDGET_EXHAUSTED');
  assert.equal(result.terminalFailure.code, 'NO_VALID_PERSPECTIVES');
  assert.ok(result.terminalFailure.message.length > 0);
});

test('Pilot 2 normalizes invalid JSON as a typed pass failure without discarding the valid perspective', async () => {
  const result = await runPilot2(request, [
    qwenRoute(async () => ({
      text: factOutput('The valid perspective survives.'),
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      toolCalls: [],
    })),
    mistralRoute(async () => ({
      text: 'not-json',
      provider: 'openrouter',
      model: 'mistralai/mistral-small-3.2-24b-instruct',
      toolCalls: [],
    })),
  ]);

  assert.equal(result.outcome, 'PARTIAL');
  assert.equal(result.passes[1].status, 'FAILED');
  assert.equal(result.passes[1].failure.code, 'INVALID_JSON');
  assert.equal(result.passes[0].status, 'SUCCESS');
});

test('Pilot 2 normalizes provenance rejection as a typed pass failure', async () => {
  const badProvenance = JSON.stringify({
    schema: 'theseus.dreaming-worker.proposals.v1',
    proposals: [
      {
        type: 'FACT',
        claim: 'This proposal invents its source.',
        source_refs: [
          {
            source_ref: 'fixture:invented',
            evidence_hash: 'sha256:not-accepted',
          },
        ],
      },
    ],
  });

  const result = await runPilot2(request, [
    qwenRoute(async () => ({
      text: factOutput('The valid perspective survives.'),
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      toolCalls: [],
    })),
    mistralRoute(async () => ({
      text: badProvenance,
      provider: 'openrouter',
      model: 'mistralai/mistral-small-3.2-24b-instruct',
      toolCalls: [],
    })),
  ]);

  assert.equal(result.outcome, 'PARTIAL');
  assert.equal(result.passes[1].failure.code, 'PROVENANCE_REJECTED');
});

test('Pilot 2 comparison is deterministic and preserves exact agreement plus pass-specific proposals', async () => {
  const shared = {
    type: 'FACT',
    claim: 'Both passes saw the same accepted evidence.',
    source_refs: [
      {
        source_ref: 'fixture:message:1',
        evidence_hash: 'sha256:fixture-message-1',
      },
    ],
  };

  const outputA = JSON.stringify({
    schema: 'theseus.dreaming-worker.proposals.v1',
    proposals: [
      shared,
      {
        type: 'HYPOTHESIS',
        claim: 'Route A suspects a cache regression.',
        why_plausible: 'The synthetic evidence reports changed behavior.',
        source_refs: shared.source_refs,
        falsifier: 'Cache telemetry remains unchanged.',
        required_evidence: ['Cache-hit telemetry.'],
        competing_explanations: ['Provider routing changed.'],
        uncertainty: 'HIGH',
      },
    ],
  });

  const outputB = JSON.stringify({
    schema: 'theseus.dreaming-worker.proposals.v1',
    proposals: [
      shared,
      {
        type: 'HYPOTHESIS',
        claim: 'Route B suspects provider routing.',
        why_plausible: 'The synthetic evidence reports changed behavior.',
        source_refs: shared.source_refs,
        falsifier: 'Provider route is unchanged.',
        required_evidence: ['Provider routing metadata.'],
        competing_explanations: ['Cache behavior changed.'],
        uncertainty: 'HIGH',
      },
    ],
  });

  const result = await runPilot2(request, [
    qwenRoute(async () => ({
      text: outputA,
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      toolCalls: [],
    })),
    mistralRoute(async () => ({
      text: outputB,
      provider: 'openrouter',
      model: 'mistralai/mistral-small-3.2-24b-instruct',
      toolCalls: [],
    })),
  ]);

  assert.equal(result.outcome, 'COMPLETE');
  assert.equal(result.comparison.mode, 'EXACT_STRUCTURED_MATCH_V1');
  assert.equal(result.comparison.sharedProposalFingerprints.length, 1);
  assert.equal(result.comparison.passAOnlyProposalFingerprints.length, 1);
  assert.equal(result.comparison.passBOnlyProposalFingerprints.length, 1);
  assert.equal(result.comparison.semanticRelation, 'UNRESOLVED_WITHOUT_CRITIQUE');
  for (const fingerprint of [
    ...result.comparison.sharedProposalFingerprints,
    ...result.comparison.passAOnlyProposalFingerprints,
    ...result.comparison.passBOnlyProposalFingerprints,
  ]) {
    assert.match(fingerprint, /^sha256:[a-f0-9]{64}$/);
  }
});


test('Pilot 2 normalizes provider JSON validation failure as a typed pass failure', async () => {
  const result = await runPilot2(request, [
    qwenRoute(async () => ({
      text: factOutput('The valid perspective survives.'),
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      toolCalls: [],
    })),
    mistralRoute(async () => {
      throw new Error('json_validate_failed: max completion tokens reached before generating a valid document');
    }),
  ]);

  assert.equal(result.outcome, 'PARTIAL');
  assert.equal(result.passes[1].failure.code, 'JSON_VALIDATE_FAILED');
});


test('Pilot 2 rejects an unapproved evidence scope before any pass', async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      runPilot2(
        { ...request, scope: 'PRIVATE_EVIDENCE' },
        [
          qwenRoute(async () => {
            calls += 1;
            throw new Error('must not run');
          }),
          mistralRoute(async () => {
            calls += 1;
            throw new Error('must not run');
          }),
        ],
      ),
    /PILOT2_SCOPE_REJECTED/,
  );

  assert.equal(calls, 0);
});

test('Pilot 2 rejects an empty task before any pass', async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      runPilot2(
        { ...request, task: '   ' },
        [
          qwenRoute(async () => {
            calls += 1;
            throw new Error('must not run');
          }),
          mistralRoute(async () => {
            calls += 1;
            throw new Error('must not run');
          }),
        ],
      ),
    /PILOT2_TASK_REQUIRED/,
  );

  assert.equal(calls, 0);
});

test('Pilot 2 fails closed when route count is not exactly two', async () => {
  let calls = 0;
  const result = await runPilot2(request, [
    qwenRoute(async () => {
      calls += 1;
      throw new Error('must not run');
    }),
  ]);

  assert.equal(calls, 0);
  assert.equal(result.outcome, 'FAIL_CLOSED');
  assert.equal(result.terminalFailure.code, 'ROUTE_PLAN_INVALID');
  assert.deepEqual(result.passes, []);
  assert.ok(result.terminalFailure.message.length > 0);
  assert.equal(result.receipt.attemptedPasses, 0);
  assert.equal(result.receipt.confirmedExternalModelCalls, 0);
  assert.equal(result.receipt.unresolvedExternalCallAttempts, 0);
});

test('Pilot 2 fails closed on incomplete route identity', async () => {
  let calls = 0;
  const result = await runPilot2(request, [
    qwenRoute(async () => {
      calls += 1;
      throw new Error('must not run');
    }),
    route({
      id: 'broken-route',
      provider: 'openrouter',
      model: 'mistralai/mistral-small-3.2-24b-instruct',
      modelFamily: '   ',
      infer: async () => {
        calls += 1;
        throw new Error('must not run');
      },
    }),
  ]);

  assert.equal(calls, 0);
  assert.equal(result.outcome, 'FAIL_CLOSED');
  assert.equal(result.terminalFailure.code, 'ROUTE_PLAN_INVALID');
  assert.deepEqual(result.passes, []);
  assert.ok(result.terminalFailure.message.length > 0);
});

test('Pilot 2 normalizes model family identity before independence comparison', async () => {
  let calls = 0;
  const result = await runPilot2(request, [
    qwenRoute(async () => {
      calls += 1;
      throw new Error('must not run');
    }),
    route({
      id: 'other-qwen-route',
      provider: 'openrouter',
      model: 'qwen/qwen3.8-27b',
      modelFamily: '  QWEN  ',
      infer: async () => {
        calls += 1;
        throw new Error('must not run');
      },
    }),
  ]);

  assert.equal(calls, 0);
  assert.equal(result.outcome, 'FAIL_CLOSED');
  assert.equal(result.terminalFailure.code, 'INDEPENDENCE_NOT_ESTABLISHED');
  assert.deepEqual(result.passes, []);
  assert.ok(result.terminalFailure.message.length > 0);
});

test('Pilot 2 normalizes schema rejection as a typed pass failure', async () => {
  const invalidSchema = JSON.stringify({
    schema: 'theseus.dreaming-worker.proposals.v1',
    proposals: [{ type: 'FACT', claim: 'Missing source refs.' }],
  });

  const result = await runPilot2(request, [
    qwenRoute(async () => ({
      text: factOutput('The valid perspective survives.'),
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      toolCalls: [],
    })),
    mistralRoute(async () => ({
      text: invalidSchema,
      provider: 'openrouter',
      model: 'mistralai/mistral-small-3.2-24b-instruct',
      toolCalls: [],
    })),
  ]);

  assert.equal(result.outcome, 'PARTIAL');
  assert.equal(result.passes[1].failure.code, 'INVALID_SCHEMA');
});

test('Pilot 2 normalizes Pilot 1 policy violation as a typed pass failure', async () => {
  const result = await runPilot2(request, [
    qwenRoute(async () => ({
      text: factOutput('The valid perspective survives.'),
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      toolCalls: [],
    })),
    mistralRoute(async () => ({
      text: factOutput('This pass used a forbidden tool.'),
      provider: 'openrouter',
      model: 'mistralai/mistral-small-3.2-24b-instruct',
      toolCalls: [{ toolName: 'forbidden' }],
    })),
  ]);

  assert.equal(result.outcome, 'PARTIAL');
  assert.equal(result.passes[1].failure.code, 'POLICY_VIOLATION');
});

test('Pilot 2 distinguishes empty final content from output-budget exhaustion', async () => {
  const result = await runPilot2(request, [
    qwenRoute(async () => ({
      text: factOutput('The valid perspective survives.'),
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      toolCalls: [],
    })),
    mistralRoute(async () => ({
      text: '',
      provider: 'openrouter',
      model: 'mistralai/mistral-small-3.2-24b-instruct',
      finishReason: 'stop',
      toolCalls: [],
    })),
  ]);

  assert.equal(result.outcome, 'PARTIAL');
  assert.equal(result.passes[1].failure.code, 'EMPTY_FINAL_CONTENT');
});

test('Pilot 2 preserves generic inference failure as typed failure', async () => {
  const result = await runPilot2(request, [
    qwenRoute(async () => ({
      text: factOutput('The valid perspective survives.'),
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      toolCalls: [],
    })),
    mistralRoute(async () => {
      throw new Error('provider connection reset');
    }),
  ]);

  assert.equal(result.outcome, 'PARTIAL');
  assert.equal(result.passes[1].failure.code, 'INFERENCE_FAILED');
});

test('Pilot 2 receipt keeps configured route and observed provider metadata separate', async () => {
  const result = await runPilot2(request, [
    qwenRoute(async () => ({
      text: factOutput('Perspective A.'),
      provider: 'groq-transport',
      model: 'qwen/qwen3.8-27b',
      toolCalls: [],
    })),
    mistralRoute(async () => ({
      text: factOutput('Perspective B.'),
      provider: 'venice',
      model: 'mistralai/mistral-small-3.2-24b-instruct',
      toolCalls: [],
    })),
  ]);

  assert.equal(result.outcome, 'COMPLETE');
  assert.equal(result.passes[0].route.provider, 'groq');
  assert.equal(result.passes[0].receipt.provider, 'groq-transport');
  assert.equal(result.passes[1].route.provider, 'openrouter');
  assert.equal(result.passes[1].receipt.provider, 'venice');
  assert.equal(result.receipt.attemptedPasses, 2);
  assert.equal(result.receipt.confirmedExternalModelCalls, 2);
  assert.equal(result.receipt.unresolvedExternalCallAttempts, 0);
});


test('Pilot 2 preserves observed provider metadata when returned output later fails validation', async () => {
  const result = await runPilot2(request, [
    qwenRoute(async () => ({
      text: factOutput('The valid perspective survives.'),
      provider: 'groq-transport',
      model: 'qwen/qwen3.8-27b',
      toolCalls: [],
    })),
    mistralRoute(async () => ({
      text: 'not-json',
      provider: 'venice',
      model: 'mistralai/mistral-small-3.2-24b-instruct',
      finishReason: 'stop',
      toolCalls: [],
    })),
  ]);

  assert.equal(result.outcome, 'PARTIAL');
  assert.equal(result.passes[1].status, 'FAILED');
  assert.equal(result.passes[1].route.provider, 'openrouter');
  assert.equal(result.passes[1].failure.code, 'INVALID_JSON');
  assert.equal(result.passes[1].observed.provider, 'venice');
  assert.equal(
    result.passes[1].observed.model,
    'mistralai/mistral-small-3.2-24b-instruct',
  );
  assert.equal(result.passes[1].observed.finishReason, 'stop');
  assert.equal(result.receipt.confirmedExternalModelCalls, 1);
  assert.equal(result.receipt.unresolvedExternalCallAttempts, 1);
});


test('Pilot 2 accepts PUBLICATION_SAFE scope for both independent passes', async () => {
  let calls = 0;
  const result = await runPilot2(
    { ...request, scope: 'PUBLICATION_SAFE' },
    [
      qwenRoute(async () => {
        calls += 1;
        return {
          text: factOutput('Publication-safe perspective A.'),
          provider: 'groq',
          model: 'qwen/qwen3.8-27b',
          toolCalls: [],
        };
      }),
      mistralRoute(async () => {
        calls += 1;
        return {
          text: factOutput('Publication-safe perspective B.'),
          provider: 'openrouter',
          model: 'mistralai/mistral-small-3.2-24b-instruct',
          toolCalls: [],
        };
      }),
    ],
  );

  assert.equal(calls, 2);
  assert.equal(result.outcome, 'COMPLETE');
  assert.equal(result.receipt.scope, 'PUBLICATION_SAFE');
});

test('Pilot 2 reports a missing task as its typed policy error', async () => {
  const { task: _task, ...withoutTask } = request;

  await assert.rejects(
    () =>
      runPilot2(withoutTask, [
        qwenRoute(async () => {
          throw new Error('must not run');
        }),
        mistralRoute(async () => {
          throw new Error('must not run');
        }),
      ]),
    /PILOT2_TASK_REQUIRED/,
  );
});

test('Pilot 2 rejects whitespace-only and missing values for every route identity field', async () => {
  for (const field of ['id', 'provider', 'model', 'modelFamily']) {
    for (const invalid of ['   ', undefined]) {
      let calls = 0;
      const broken = {
        id: 'openrouter-mistral',
        provider: 'openrouter',
        model: 'mistralai/mistral-small-3.2-24b-instruct',
        modelFamily: 'mistral',
        infer: async () => {
          calls += 1;
          throw new Error('must not run');
        },
      };
      broken[field] = invalid;

      const result = await runPilot2(request, [
        qwenRoute(async () => {
          calls += 1;
          throw new Error('must not run');
        }),
        broken,
      ]);

      assert.equal(calls, 0, field + ' must fail before inference');
      assert.equal(result.outcome, 'FAIL_CLOSED');
      assert.equal(result.terminalFailure.code, 'ROUTE_PLAN_INVALID');
      assert.ok(result.terminalFailure.message.length > 0);
      assert.equal(result.receipt.independence, 'NOT_EVALUATED');
    }
  }
});

test('Pilot 2 route-count failure keeps a non-empty diagnostic and no independence claim', async () => {
  const result = await runPilot2(request, [
    qwenRoute(async () => {
      throw new Error('must not run');
    }),
  ]);

  assert.equal(result.outcome, 'FAIL_CLOSED');
  assert.equal(result.terminalFailure.code, 'ROUTE_PLAN_INVALID');
  assert.ok(result.terminalFailure.message.length > 0);
  assert.equal(result.receipt.independence, 'NOT_EVALUATED');
});

test('Pilot 2 same-family failure keeps a non-empty diagnostic', async () => {
  const result = await runPilot2(request, [
    qwenRoute(async () => {
      throw new Error('must not run');
    }),
    route({
      id: 'other-qwen',
      provider: 'openrouter',
      model: 'qwen/qwen3.8-27b',
      modelFamily: 'QWEN',
      infer: async () => {
        throw new Error('must not run');
      },
    }),
  ]);

  assert.equal(result.outcome, 'FAIL_CLOSED');
  assert.equal(result.terminalFailure.code, 'INDEPENDENCE_NOT_ESTABLISHED');
  assert.ok(result.terminalFailure.message.length > 0);
});

test('Pilot 2 treats missing final text as EMPTY_FINAL_CONTENT instead of crashing', async () => {
  const result = await runPilot2(request, [
    qwenRoute(async () => ({
      text: factOutput('The valid perspective survives.'),
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      toolCalls: [],
    })),
    mistralRoute(async () => ({
      text: undefined,
      provider: 'openrouter',
      model: 'mistralai/mistral-small-3.2-24b-instruct',
      finishReason: 'stop',
      toolCalls: [],
    })),
  ]);

  assert.equal(result.outcome, 'PARTIAL');
  assert.equal(result.passes[1].failure.code, 'EMPTY_FINAL_CONTENT');
});

test('Pilot 2 exact comparison puts one identical proposal only in the shared set', async () => {
  const shared = factOutput('Exactly the same structured proposal.');

  const result = await runPilot2(request, [
    qwenRoute(async () => ({
      text: shared,
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      toolCalls: [],
    })),
    mistralRoute(async () => ({
      text: shared,
      provider: 'openrouter',
      model: 'mistralai/mistral-small-3.2-24b-instruct',
      toolCalls: [],
    })),
  ]);

  assert.equal(result.outcome, 'COMPLETE');
  assert.equal(result.comparison.sharedProposalFingerprints.length, 1);
  assert.equal(result.comparison.passAOnlyProposalFingerprints.length, 0);
  assert.equal(result.comparison.passBOnlyProposalFingerprints.length, 0);
  assert.match(result.comparison.sharedProposalFingerprints[0], /^sha256:[a-f0-9]{64}$/);
});

test('Pilot 2 records two attempted passes and a non-empty terminal diagnostic when both fail', async () => {
  const result = await runPilot2(request, [
    qwenRoute(async () => {
      throw new Error('provider timeout');
    }),
    mistralRoute(async () => {
      throw new Error('provider connection reset');
    }),
  ]);

  assert.equal(result.outcome, 'FAIL_CLOSED');
  assert.equal(result.receipt.attemptedPasses, 2);
  assert.ok(result.terminalFailure.message.length > 0);
});

test('Pilot 2 preserves non-empty length-truncated output as TRUNCATED_OUTPUT', async () => {
  const result = await runPilot2(request, [
    qwenRoute(async () => ({
      text: factOutput('The valid perspective survives.'),
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      toolCalls: [],
    })),
    mistralRoute(async () => ({
      text: '{"schema":"theseus.dreaming-worker.proposals.v1","proposals":[',
      provider: 'openrouter',
      model: 'mistralai/mistral-small-3.2-24b-instruct',
      finishReason: 'length',
      toolCalls: [],
    })),
  ]);

  assert.equal(result.outcome, 'PARTIAL');
  assert.equal(result.passes[1].status, 'FAILED');
  assert.equal(result.passes[1].failure.code, 'TRUNCATED_OUTPUT');
  assert.equal(result.passes[1].observed.finishReason, 'length');
});

test('Pilot 2 preserves complete invalid JSON as a bounded serializer candidate', async () => {
  const raw = 'The model answered in prose instead of JSON.';
  const result = await runPilot2(request, [
    qwenRoute(async () => ({
      text: factOutput('The valid perspective survives.'),
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      toolCalls: [],
    })),
    mistralRoute(async () => ({
      text: raw,
      provider: 'openrouter',
      model: 'mistralai/mistral-small-3.2-24b-instruct',
      finishReason: 'stop',
      toolCalls: [],
    })),
  ]);

  const failed = result.passes[1];
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.failure.code, 'INVALID_JSON');
  assert.equal(failed.recovery.classification, 'UNSTRUCTURED_COMPLETE');
  assert.equal(failed.recovery.serializerEligible, true);
  assert.equal(failed.recovery.rawModelOutput, raw);
  assert.match(failed.recovery.rawOutputFingerprint, /^sha256:[a-f0-9]{64}$/);
});

test('Pilot 2 preserves valid JSON with the wrong schema as a serializer candidate', async () => {
  const raw = JSON.stringify({
    schema: 'theseus.dreaming-worker.proposals.v1',
    proposals: [{ type: 'FACT', claim: 'Missing source refs.' }],
  });
  const result = await runPilot2(request, [
    qwenRoute(async () => ({
      text: factOutput('The valid perspective survives.'),
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      toolCalls: [],
    })),
    mistralRoute(async () => ({
      text: raw,
      provider: 'openrouter',
      model: 'mistralai/mistral-small-3.2-24b-instruct',
      finishReason: 'stop',
      toolCalls: [],
    })),
  ]);

  const failed = result.passes[1];
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.failure.code, 'INVALID_SCHEMA');
  assert.equal(failed.recovery.classification, 'SCHEMA_MISMATCH_COMPLETE');
  assert.equal(failed.recovery.serializerEligible, true);
  assert.equal(failed.recovery.rawModelOutput, raw);
});

test('Pilot 2 never offers provenance-invalid output to a serializer', async () => {
  const raw = JSON.stringify({
    schema: 'theseus.dreaming-worker.proposals.v1',
    proposals: [{
      type: 'FACT',
      claim: 'Invented evidence.',
      source_refs: [{
        source_ref: 'fixture:invented',
        evidence_hash: 'sha256:not-accepted',
      }],
    }],
  });
  const result = await runPilot2(request, [
    qwenRoute(async () => ({
      text: factOutput('The valid perspective survives.'),
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      toolCalls: [],
    })),
    mistralRoute(async () => ({
      text: raw,
      provider: 'openrouter',
      model: 'mistralai/mistral-small-3.2-24b-instruct',
      finishReason: 'stop',
      toolCalls: [],
    })),
  ]);

  const failed = result.passes[1];
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.failure.code, 'PROVENANCE_REJECTED');
  assert.equal(failed.recovery.classification, 'SEMANTIC_INVALID');
  assert.equal(failed.recovery.serializerEligible, false);
  assert.equal(failed.recovery.rawModelOutput, null);
  assert.match(failed.recovery.rawOutputFingerprint, /^sha256:[a-f0-9]{64}$/);
});

test('Pilot 2 never exposes truncated output as a serializer candidate', async () => {
  const raw = '{"schema":"theseus.dreaming-worker.proposals.v1","proposals":[';
  const result = await runPilot2(request, [
    qwenRoute(async () => ({
      text: factOutput('The valid perspective survives.'),
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      toolCalls: [],
    })),
    mistralRoute(async () => ({
      text: raw,
      provider: 'openrouter',
      model: 'mistralai/mistral-small-3.2-24b-instruct',
      finishReason: 'length',
      toolCalls: [],
    })),
  ]);

  const failed = result.passes[1];
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.failure.code, 'TRUNCATED_OUTPUT');
  assert.equal(failed.recovery.classification, 'TRUNCATED_OUTPUT');
  assert.equal(failed.recovery.serializerEligible, false);
  assert.equal(failed.recovery.rawModelOutput, null);
  assert.match(failed.recovery.rawOutputFingerprint, /^sha256:[a-f0-9]{64}$/);
});
