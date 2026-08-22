import assert from 'node:assert/strict';
import {
  assessBenchmarkFreshness,
  snapshotGeneratedAt
} from './howtospark-freshness.mjs';

assert.equal(
  snapshotGeneratedAt('window.HOWTOSPARK_DATA = { "generatedAt": "2026-08-07T00:00:00.000Z" };'),
  '2026-08-07T00:00:00.000Z'
);
assert.equal(snapshotGeneratedAt('window.HOWTOSPARK_DATA = {};'), null);

const stale = assessBenchmarkFreshness({
  newestBenchmarkAt: '2026-08-07T00:00:00.000Z',
  previousBenchmarkAt: '2026-08-07T00:00:00.000Z',
  staleAfterDays: 14,
  now: new Date('2026-08-23T12:00:00.000Z')
});
assert.equal(stale.stale, true);
assert.equal(stale.ageDays, 16.5);

const fresh = assessBenchmarkFreshness({
  newestBenchmarkAt: '2026-08-22T00:00:00.000Z',
  previousBenchmarkAt: '2026-08-07T00:00:00.000Z',
  staleAfterDays: 14,
  now: new Date('2026-08-23T12:00:00.000Z')
});
assert.equal(fresh.stale, false);

assert.throws(
  () => assessBenchmarkFreshness({
    newestBenchmarkAt: '2026-08-06T00:00:00.000Z',
    previousBenchmarkAt: '2026-08-07T00:00:00.000Z',
    staleAfterDays: 14,
    now: new Date('2026-08-23T12:00:00.000Z')
  }),
  /benchmark date regressed/i
);

console.log('Validated non-blocking stale data and benchmark date regression checks.');
