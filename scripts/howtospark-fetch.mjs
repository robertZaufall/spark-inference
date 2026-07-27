const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429]);
const TRANSIENT_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET'
]);

export class HttpError extends Error {
  constructor(url, status) {
    super(`${url} returned HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function isTransientFetchError(error) {
  if (error instanceof HttpError) {
    return TRANSIENT_HTTP_STATUSES.has(error.status) || error.status >= 500;
  }

  const code = error?.code || error?.cause?.code;
  return error?.name === 'AbortError'
    || error?.name === 'TimeoutError'
    || TRANSIENT_ERROR_CODES.has(code);
}

export async function fetchTextWithRetry(url, {
  attempts = 4,
  delaysMs = [1_000, 3_000, 7_000],
  fetchImpl = globalThis.fetch,
  onRetry = () => {},
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  timeoutMs = 30_000
} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error('attempts must be a positive integer');

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'spark-inference-data-sync/1.0 (+https://github.com/robertzaufall/spark-inference)'
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) throw new HttpError(url, response.status);
      return await response.text();
    } catch (error) {
      if (attempt === attempts || !isTransientFetchError(error)) throw error;
      const delayMs = delaysMs[Math.min(attempt - 1, delaysMs.length - 1)] ?? 0;
      onRetry({ attempt, attempts, delayMs, error, url });
      await sleep(delayMs);
    }
  }

  throw new Error(`Unreachable retry state for ${url}`);
}

export async function mapWithConcurrency(values, concurrency, mapper) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be a positive integer');
  }

  const results = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }

  const workerCount = Math.min(concurrency, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
