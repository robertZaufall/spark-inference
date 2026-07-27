import assert from 'node:assert/strict';
import {
  HttpError,
  fetchTextWithRetry,
  isTransientFetchError,
  mapWithConcurrency
} from './howtospark-fetch.mjs';

const noSleep = async () => {};

let resetAttempts = 0;
const resetResult = await fetchTextWithRetry('https://example.test/reset', {
  fetchImpl: async () => {
    resetAttempts += 1;
    if (resetAttempts < 3) {
      const error = new TypeError('fetch failed');
      error.cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
      throw error;
    }
    return new Response('recovered');
  },
  sleep: noSleep
});
assert.equal(resetResult, 'recovered');
assert.equal(resetAttempts, 3);

let serverAttempts = 0;
const serverResult = await fetchTextWithRetry('https://example.test/server', {
  fetchImpl: async () => {
    serverAttempts += 1;
    return serverAttempts === 1 ? new Response('', { status: 503 }) : new Response('available');
  },
  sleep: noSleep
});
assert.equal(serverResult, 'available');
assert.equal(serverAttempts, 2);

let permanentAttempts = 0;
await assert.rejects(
  fetchTextWithRetry('https://example.test/missing', {
    fetchImpl: async () => {
      permanentAttempts += 1;
      return new Response('', { status: 404 });
    },
    sleep: noSleep
  }),
  /returned HTTP 404/
);
assert.equal(permanentAttempts, 1);

assert.equal(isTransientFetchError(new HttpError('https://example.test', 429)), true);
assert.equal(isTransientFetchError(new HttpError('https://example.test', 502)), true);
assert.equal(isTransientFetchError(new HttpError('https://example.test', 400)), false);

let active = 0;
let maximumActive = 0;
const ordered = await mapWithConcurrency([40, 10, 30, 20], 2, async (delay, index) => {
  active += 1;
  maximumActive = Math.max(maximumActive, active);
  await new Promise((resolve) => setTimeout(resolve, delay));
  active -= 1;
  return index;
});
assert.deepEqual(ordered, [0, 1, 2, 3]);
assert.equal(maximumActive, 2);

console.log('Validated bounded HowToSpark fetch retries and concurrency.');
