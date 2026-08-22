const DAY_MS = 86_400_000;

function timestamp(value, label) {
  if (!value) return null;
  const parsed = new Date(value).valueOf();
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}: ${value}`);
  return parsed;
}

export function snapshotGeneratedAt(source = '') {
  return source.match(/"generatedAt"\s*:\s*"([^"]+)"/)?.[1] || null;
}

export function assessBenchmarkFreshness({
  newestBenchmarkAt,
  previousBenchmarkAt = null,
  staleAfterDays,
  now = new Date()
}) {
  const newestTimestamp = timestamp(newestBenchmarkAt, 'newest benchmark date');
  const previousTimestamp = timestamp(previousBenchmarkAt, 'committed benchmark date');
  const nowTimestamp = timestamp(now, 'current date');

  if (previousTimestamp !== null && newestTimestamp < previousTimestamp) {
    throw new Error(
      `HowToSpark benchmark date regressed from ${previousBenchmarkAt} to ${newestBenchmarkAt}`
    );
  }

  const ageDays = (nowTimestamp - newestTimestamp) / DAY_MS;
  return {
    ageDays,
    stale: Number.isFinite(staleAfterDays) && ageDays > staleAfterDays
  };
}
