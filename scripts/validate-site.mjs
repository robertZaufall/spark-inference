import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataSource = await fs.readFile(path.join(root, 'data', 'howtospark-data.js'), 'utf8');
const context = { window: {} };
vm.runInNewContext(dataSource, context, { filename: 'data/howtospark-data.js' });
const data = context.window.HOWTOSPARK_DATA;

if (!data || data.schemaVersion !== 1) throw new Error('Missing or unsupported HowToSpark data schema');
if (!['transition', 'howtospark-only'].includes(data.mode)) throw new Error(`Invalid source mode: ${data.mode}`);
if (!Array.isArray(data.models) || data.models.length < 3) throw new Error('Too few normalized models');
if (!Number.isInteger(data.latestBenchmarkCount) || data.latestBenchmarkCount < 1) throw new Error('Missing benchmark count');

const ids = new Set();
data.models.forEach((model, index) => {
  if (!model.id || ids.has(model.id)) throw new Error(`Duplicate or missing model id: ${model.id}`);
  ids.add(model.id);
  if (model.rank !== index + 1) throw new Error(`Non-sequential rank for ${model.id}`);
  if (!Number.isFinite(model.speedMax) || model.speedMax < 0 || model.speedMax > 1_000) throw new Error(`Invalid speed for ${model.id}`);
  if (!Number.isInteger(model.nodes) || model.nodes < 1 || model.nodes > 8) {
    throw new Error(`Invalid DGX Spark count for ${model.id}: ${model.nodes}`);
  }
  if (!Array.isArray(model.sources) || !model.sources.every((source) => data.sources[source])) {
    throw new Error(`Missing evidence source for ${model.id}`);
  }
  if (!model.command || !model.verdict) throw new Error(`Incomplete recipe data for ${model.id}`);
  if (model.nvidiaModelCardUrl && !/^https:\/\/build\.nvidia\.com\/.+\/modelcard$/.test(model.nvidiaModelCardUrl)) {
    throw new Error(`Invalid NVIDIA model-card URL for ${model.id}`);
  }
  if (model.howToSparkModelUrl && !/^https:\/\/howtospark\.com\/models\/.+/.test(model.howToSparkModelUrl)) {
    throw new Error(`Invalid HowToSpark model URL for ${model.id}`);
  }
});
if (!data.models.some((model) => model.nodes === 1)) throw new Error('Snapshot has no single-Spark models');
if (!data.models.some((model) => model.nodes > 1)) throw new Error('Snapshot has no multi-Spark models');

const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
const $ = cheerio.load(html);
if (!$('script[src="data/howtospark-data.js"]').length) throw new Error('index.html does not load the generated snapshot');
if (!html.includes('data-select-model')) throw new Error('index.html does not expose per-model detail links');
if (!html.includes("return m.howToSparkModelUrl || 'https://howtospark.com/models'")) {
  throw new Error('index.html does not guarantee a HowToSpark link on every model row');
}
if (!$('#sparkCountFilter option[value="single"][selected]').length) {
  throw new Error('Single-Spark inference is not the default hardware filter');
}
if (!$('#multiSparkNotice[role="alert"]').length) throw new Error('Missing multi-Spark warning region');
if (!html.includes("m.nodes > 1 ? 'multi-spark'")) throw new Error('Multi-Spark rows are not highlighted');
if (!$('a[href="https://github.com/MiaAI-Lab"]').length) throw new Error('Missing MiaAI-Lab information link');
$('script:not([src])').each((index, script) => {
  const source = $(script).html();
  if (source.trim()) new Function(source);
});

console.log(`Validated site: ${data.models.length} HowToSpark models and ${data.latestBenchmarkCount} latest runs.`);
