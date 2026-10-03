import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Execute the production recovery handler with isolated provider responses.
// No account is created, no live credential is used, and no email is sent.
const source = readFileSync(new URL('../public/auth.js', import.meta.url), 'utf8');
const submitStart = source.indexOf('async function submit(event)');
const submitEnd = source.indexOf('\n async function social(', submitStart);
const errorStart = source.indexOf('function errorCopy(error)');
const errorEnd = source.indexOf('\n const redirect', errorStart);
assert.ok(submitStart >= 0 && submitEnd > submitStart && errorStart >= 0 && errorEnd > errorStart);
const submitSource = source.slice(submitStart, submitEnd);
const errorSource = source.slice(errorStart, errorEnd);

function fixture({ mode = 'forgot', providerError } = {}) {
  const calls = [], confirmations = [], errors = [], busy = [];
  let validations = 0, prevented = 0;
  const env = {
    mode, method: 'email', busy: false, cooldownUntil: 0, screen: { isConnected: true },
    location: { origin: 'https://elitebot.example.test' },
    $: selector => ({ value: selector === '#a-email' ? 'member@example.test' : '' }),
    validateAll: () => { validations++; return true; },
    setBusy: value => { env.busy = value; busy.push(value); },
    request: async (path, method, body) => {
      calls.push({ path, method, body });
      if (providerError) throw providerError;
      return {};
    },
    sendEmail: async email => { calls.push({ path: 'otp', email }); },
    showConfirmation: (...values) => { confirmations.push(values); },
    message: copy => { errors.push(copy); }
  };
  const handlers = runInNewContext('({submit:' + submitSource + ',errorCopy:' + errorSource + '})', env);
  env.errorCopy = handlers.errorCopy;
  return { submit: () => handlers.submit({ preventDefault() { prevented++; } }),
    calls, confirmations, errors, busy, validations: () => validations, prevented: () => prevented };
}
const failure = (status, code, message) => Object.assign(new Error(message), { status, code });

test('forgotten-email help cannot submit a hidden sign-in or email request', async () => {
  const f = fixture({ mode: 'emailhelp' }); await f.submit();
  assert.equal(f.prevented(), 1);
  assert.equal(f.validations(), 0);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.confirmations, []);
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.busy, []);
});

test('recovery requests keep the verified app destination and neutral confirmation', async () => {
  const f = fixture(); await f.submit();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].method, 'POST');
  assert.equal(new URL('https://provider.example.test/' + f.calls[0].path).searchParams.get('redirect_to'),
    'https://elitebot.example.test/reset-password');
  assert.equal(f.calls[0].body.email, 'member@example.test');
  assert.equal(f.confirmations.length, 1);
  assert.match(f.confirmations[0][1], /^If an account uses/);
  assert.deepEqual(f.errors, []);
});

test('an unknown recovery account retains the same neutral confirmation', async () => {
  const f = fixture({ providerError: failure(400, 'user_not_found', 'User not found') }); await f.submit();
  assert.equal(f.confirmations.length, 1);
  assert.match(f.confirmations[0][1], /^If an account uses/);
  assert.deepEqual(f.errors, []);
});

test('SMTP authentication failures never claim that a recovery email was requested', async () => {
  const f = fixture({ providerError: failure(500, 'unexpected_failure', 'Error sending recovery email') });
  await f.submit();
  assert.deepEqual(f.confirmations, []);
  assert.match(f.errors[0], /Recovery email is temporarily unavailable/);
  assert.deepEqual(f.busy, [true, false]);
});

test('an unauthorized email sender is surfaced instead of being hidden as success', async () => {
  const f = fixture({ providerError: failure(400, 'email_address_not_authorized', 'Email address not authorized') });
  await f.submit();
  assert.deepEqual(f.confirmations, []);
  assert.match(f.errors[0], /Recovery email is temporarily unavailable/);
});

test('provider email limits retain the retry countdown and never claim success', async () => {
  const error = failure(400, 'over_email_send_rate_limit', 'Email rate limit exceeded'); error.retryAfter = 60;
  const f = fixture({ providerError: error }); await f.submit();
  assert.deepEqual(f.confirmations, []);
  assert.match(f.errors[0], /^Too many attempts.*60s\.$/);
});

test('recovery timeouts give a retry message without claiming delivery', async () => {
  const f = fixture({ providerError: failure(504, 'request_timeout', 'Request timed out') }); await f.submit();
  assert.deepEqual(f.confirmations, []);
  assert.match(f.errors[0], /request took too long/);
});
