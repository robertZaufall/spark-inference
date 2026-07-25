import assert from 'node:assert/strict';
import { parseLatestBenchmarks } from './howtospark-parser.mjs';

const sourceUrl = new URL('https://howtospark.com/');

const currentMarkup = `
  <section>
    <div><h2>Latest benchmarks</h2><span>1 run</span></div>
    <div>
      <a href="/recipes/laguna-s-2-1-nvfp4-single-spark#benchmarks">
        <div>
          <div><span>32.0</span><span>tok/s</span></div>
          <div><span>61.72s</span><span>ttft</span></div>
          <div><span>2.1k</span><span>prefill</span></div>
        </div>
        <div>
          <h3>Laguna-S 2.1 (poolside) — NVFP4 <span>on</span> NVIDIA DGX Spark</h3>
          <span data-slot="badge">vLLM 0.25.1</span>
          <span data-slot="badge">ctx 131,072</span>
          <div class="mt-2"><span>@Fogle</span><span>·</span><span>6h ago</span></div>
        </div>
      </a>
    </div>
  </section>`;

const current = parseLatestBenchmarks(currentMarkup, sourceUrl, {
  now: new Date('2026-07-25T12:00:00.000Z')
});
assert.equal(current.length, 1);
assert.deepEqual(current[0], {
  id: 'laguna-s-2-1-nvfp4-single-spark-131-072-32.0',
  slug: 'laguna-s-2-1-nvfp4-single-spark',
  name: 'Laguna-S 2.1 (poolside)',
  url: 'https://howtospark.com/recipes/laguna-s-2-1-nvfp4-single-spark#benchmarks',
  date: '2026-07-25T00:00:00.000Z',
  decodeTokensPerSecond: 32,
  timeToFirstToken: '61.72s',
  prefillTokensPerSecond: '2.1k',
  quantization: 'NVFP4',
  engine: 'vLLM',
  engineVersion: '0.25.1',
  method: null,
  context: '131,072',
  nodes: 1
});

const legacyMarkup = `
  <section>
    <div><h2>Latest benchmarks</h2></div>
    <div>
      <div>
        <div>
          <div><span>64.2</span><span>tok/s</span></div>
          <div><span>1.2s</span><span>ttft</span></div>
          <div><span>4.8k</span><span>prefill</span></div>
        </div>
        <h3><a href="/benchmarks/qwen3-6-35b-a3b--dgx-spark-x2--run-42">Qwen3.6 35B-A3B <span>NVFP4</span></a></h3>
        <span data-slot="badge">vLLM 0.24.0</span>
        <span data-slot="badge">spec-decoding</span>
        <span data-slot="badge">ctx 32,768</span>
        <div class="mt-2"><span>Jul 23, 2026</span></div>
      </div>
    </div>
  </section>`;

const legacy = parseLatestBenchmarks(legacyMarkup, sourceUrl);
assert.equal(legacy.length, 1);
assert.equal(legacy[0].slug, 'qwen3-6-35b-a3b');
assert.equal(legacy[0].name, 'Qwen3.6 35B-A3B');
assert.equal(legacy[0].quantization, 'NVFP4');
assert.equal(legacy[0].method, 'spec-decoding');
assert.equal(legacy[0].nodes, 2);
assert.equal(legacy[0].date, '2026-07-23T00:00:00.000Z');

assert.throws(
  () => parseLatestBenchmarks('<main><h2>Latest benchmarks</h2><div></div></main>', sourceUrl),
  /no latest benchmark rows/i
);
assert.throws(
  () => parseLatestBenchmarks('<main><h2>Benchmarks</h2></main>', sourceUrl),
  /Could not find the Latest benchmarks section/
);

console.log('Validated HowToSpark benchmark parser for current and legacy markup.');
