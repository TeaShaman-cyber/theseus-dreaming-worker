// Research receipt verification: replay every available final artifact, including
// negative controls. No inference or repair. Transport evidence remains recorded,
// not independently authenticated by this offline checker.
import assert from 'node:assert/strict';
import { parseStrictModelJson } from '../../src/dreaming/strict-model-json.ts';

export function verifyExtraction(rows, cases, fixtureSha, goldSha, evaluate) {
  const [catalog] = rows;
  assert.equal(catalog?.kind, 'catalog');
  assert.equal(catalog.fixtureSha, fixtureSha);
  assert.equal(catalog.goldSha, goldSha);
  const end = rows.at(-1);
  assert.equal(end?.kind, 'end');
  assert.equal(typeof end.stopped, 'boolean');
  let cursor = 1, attempts = 0, skipped = false;
  for (const c of cases) {
    const attempt = rows[cursor];
    if (attempt?.kind === 'case' && attempt.status === 'NOT_ATTEMPTED') {
      assert.equal(attempt.id, c.id);
      assert.ok(attempts > 0 && end.stopped);
      assert.equal(Object.keys(attempt).length, 3);
      skipped = true;
      cursor++;
      continue;
    }
    assert.ok(!skipped, 'attempt after skipped case');
    assert.equal(attempt?.kind, 'attempt');
    assert.equal(attempt.id, c.id);
    assert.match(attempt.wireSha, /^[0-9a-f]{64}$/);
    attempts++;
    const receipt = rows[++cursor];
    cursor++;
    assert.equal(receipt?.kind, 'case');
    assert.equal(receipt.id, c.id);
    assert.ok(['VALIDATED', 'FAILED'].includes(receipt.status));
    if (receipt.status === 'VALIDATED') {
      assert.equal(receipt.transport.status, 200);
      assert.equal(receipt.transport.model, catalog.model);
      assert.equal(receipt.transport.finish, 'stop');
      assert.equal(typeof receipt.rawFinal, 'string');
      assert.deepEqual(evaluate(parseStrictModelJson(receipt.rawFinal), c), receipt.evaluation);
    } else if (typeof receipt.rawFinal === 'string') {
      // The existing negative artifact is a structural failure after a valid
      // transport. Fail closed on new failure classes until their replay exists.
      assert.equal(receipt.transport.status, 200);
      assert.equal(receipt.transport.model, catalog.model);
      assert.equal(receipt.transport.finish, 'stop');
      assert.equal(receipt.code, 'ERR_ASSERTION');
      assert.throws(() => evaluate(parseStrictModelJson(receipt.rawFinal), c), error =>
        error.code === receipt.code && String(error.message).slice(0, 500) === receipt.error);
    } else {
      assert.equal(receipt.rawFinal, null);
      // No model artifact exists for this known recorded transport refusal.
      assert.equal(receipt.code, 'RATE_LIMITED');
      assert.equal(receipt.providerState, 'RESPONDED');
      assert.equal(receipt.transport.status, 429);
      assert.equal(receipt.usage, null);
      assert.ok(end.stopped);
      assert.ok(c === cases.at(-1) || rows[cursor]?.status === 'NOT_ATTEMPTED');
    }
  }
  assert.equal(cursor, rows.length - 1, 'unexpected or missing receipt');
  assert.equal(attempts, end.attempts);
}
