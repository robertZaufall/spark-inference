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

const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
const $ = cheerio.load(html);
if (!$('script[src="data/howtospark-data.js"]').length) throw new Error('index.html does not load the generated snapshot');
if (!html.includes('data-select-model')) throw new Error('index.html does not expose per-model detail links');
$('script:not([src])').each((index, script) => {
  const source = $(script).html();
  if (source.trim()) new Function(source);
});

console.log(`Validated site: ${data.models.length} HowToSpark models and ${data.latestBenchmarkCount} latest runs.`);
