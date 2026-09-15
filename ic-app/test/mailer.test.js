// server/mailer.js — Microsoft Graph mail. sendMail() itself needs a configured Graph
// mailbox to exercise end to end (no test env has MS_GRAPH_* set, matching every other
// mailer-dependent route in this codebase, which is tested only through its
// not-configured degrade path — see e.g. test/maturity.test.js's invite-family suite).
// toRecipients() is the one piece of sendMail's logic that's a pure function, so it's
// unit-tested directly: it used to always wrap `to` as a single Graph recipient
// (`toRecipients: [{ emailAddress: { address: to } }]`), which silently produced an
// invalid payload (`address` as an array, not a string) whenever a caller passed multiple
// recipients — as server/maturity.js's and server/risk.js's /report/email routes do.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { toRecipients } = require('../server/mailer');

describe('mailer.toRecipients', () => {
  test('a single address string becomes one recipient', () => {
    assert.deepEqual(toRecipients('a@example.com'), [{ emailAddress: { address: 'a@example.com' } }]);
  });
  test('an array of addresses becomes one recipient per address, in order', () => {
    assert.deepEqual(toRecipients(['a@example.com', 'b@example.com']), [
      { emailAddress: { address: 'a@example.com' } },
      { emailAddress: { address: 'b@example.com' } },
    ]);
  });
  test('falsy entries in an array are dropped, not sent as empty recipients', () => {
    assert.deepEqual(toRecipients(['a@example.com', '', null, undefined, 'b@example.com']), [
      { emailAddress: { address: 'a@example.com' } },
      { emailAddress: { address: 'b@example.com' } },
    ]);
  });
  test('an empty array yields no recipients', () => {
    assert.deepEqual(toRecipients([]), []);
  });
});
