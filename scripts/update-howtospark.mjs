import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { parseLatestBenchmarks } from './howtospark-parser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'data-source.config.json');
const outputPath = path.join(root, 'data', 'howtospark-data.js');
const checkOnly = process.argv.includes('--check');

const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const sourceUrl = new URL(config.sourceUrl);

if (!['transition', 'howtospark-only'].includes(config.mode)) {
  throw new Error(`Unsupported data source mode: ${config.mode}`);
}

function clean(value = '') {
  return value.replace(/\s+/g, ' ').trim();
}

function number(value) {
  const parsed = Number.parseFloat(String(value).replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function absoluteUrl(relative) {
  return new URL(relative, sourceUrl).toString();
}

async function fetchPage(relative = '/') {
  const url = absoluteUrl(relative);
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'spark-inference-data-sync/1.0 (+https://github.com/robertzaufall/spark-inference)'
    },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

function metricFromCard($, card, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^(.+?)\\s+${escapedLabel}$`, 'i');
  let value = null;
  $(card).find('span').each((_, element) => {
    const match = clean($(element).text()).match(pattern);
    if (!value && match) value = clean(match[1]);
  });
  return value;
}

function sparkCountFromText(value) {
  const text = clean(value);
  const numeric = text.match(/\b(\d+)\s+(?:DGX\s+)?Sparks?\b/i);
  if (numeric) return Number(numeric[1]);
  const word = text.match(/\b(one|two|three|four|five|six|seven|eight)\s+(?:DGX\s+)?Sparks?\b/i)?.[1]?.toLowerCase();
  return word ? ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'].indexOf(word) + 1 : null;
}

function parseCuratedGoals(html) {
  const $ = cheerio.load(html);
  const goals = new Map();
  $('a[href^="/recipes/"]').each((_, card) => {
    const slug = $(card).attr('href').slice('/recipes/'.length);
    const goal = clean($(card).children().first().text());
    if (goal && goal.length < 40) goals.set(slug, goal);
  });
  return goals;
}

function parseRecipeCards(html) {
  const $ = cheerio.load(html);
  const recipes = [];
  const seen = new Set();
  $('a[href^="/recipes/"]').each((_, card) => {
    const $card = $(card);
    const href = $card.attr('href');
    if (!href || seen.has(href) || !$card.find('h3').length) return;
    seen.add(href);
    const fullText = clean($card.text());
    const viaMatch = fullText.match(/via\s+(.+)$/i);
    recipes.push({
      slug: href.slice('/recipes/'.length),
      url: absoluteUrl(href),
      title: clean($card.find('h3').first().text()),
      description: clean($card.find('p').first().text()),
      context: metricFromCard($, card, 'ctx'),
      speed: number(metricFromCard($, card, 'tok/s')),
      nodes: number(metricFromCard($, card, 'Sparks'))
        || number(metricFromCard($, card, 'Spark'))
        || sparkCountFromText(fullText)
        || 1,
      via: viaMatch ? clean(viaMatch[1]) : null
    });
  });
  return recipes;
}

function selectServeCommand(html) {
  const $ = cheerio.load(html);
  const commands = $('pre').map((_, pre) => $(pre).text().replace(/bash\s*$/, '').trim()).get();
  const scored = commands.map((command, index) => {
    let score = 0;
    const hasServeCommand = command.split('\n').some((line) =>
      /\bvllm\s+serve\b|\bllama-server\b|sglang\.launch_server/i.test(line)
      && !/\b(?:pgrep|pkill|grep)\b/i.test(line)
    );
    if (hasServeCommand) score += 100;
    if (/\.\/start\.sh\b|start-ray-cluster\.sh|\brun-[\w.-]+\.sh\b/i.test(command)) score += 90;
    if (/\bdocker\s+run\b|\bpython\s+-m\b/i.test(command)) score += 40;
    return { command, index, score };
  }).sort((a, b) => b.score - a.score || b.command.length - a.command.length || a.index - b.index);
  return scored[0]?.score > 0 ? scored[0].command : commands[0] || '';
}

function recipeMatchesBenchmark(recipeSlug, benchmarkSlug) {
  return recipeSlug === benchmarkSlug || recipeSlug.startsWith(`${benchmarkSlug}-`) || benchmarkSlug.startsWith(`${recipeSlug}-`);
}

function architecture(description, title) {
  return /\bMoE\b|\bexperts?\b|\b\d+(?:\.\d+)?B-A\d/i.test(`${title} ${description}`) ? 'MoE' : 'Dense';
}

function parameterSizes(description, title) {
  const text = `${title} ${description}`;
  const total = text.match(/\b(\d+(?:\.\d+)?)B(?:\s+MoE|\/|\b)/i)?.[1];
  const active = text.match(/-A(\d+(?:\.\d+)?)B\b/i)?.[1]
    || text.match(/\b\d+(?:\.\d+)?B\s*\/\s*(\d+(?:\.\d+)?)B\b/i)?.[1]
    || text.match(/\b(?:~\s*)?(\d+(?:\.\d+)?)B\s+active\b/i)?.[1];
  return {
    totalParams: total ? `${total}B` : 'Not stated',
    activeParams: active ? `${active}B active` : 'Not stated'
  };
}

function displayName(recipe, matchingBenchmarks) {
  if (matchingBenchmarks[0]?.name) return matchingBenchmarks[0].name;
  return recipe.title.split(/\s+—\s+/)[0].replace(/\s+\(75% expert prune\)$/i, '');
}

function sourceKey(slug) {
  return `howtospark_${slug.replace(/[^a-z0-9]+/gi, '_')}`;
}

function modelFromRecipe(recipe, matchingBenchmarks, goal, rank, command) {
  const speeds = matchingBenchmarks.map((item) => item.decodeTokensPerSecond).filter(Number.isFinite);
  if (Number.isFinite(recipe.speed)) speeds.push(recipe.speed);
  const speedMax = speeds.length ? Math.max(...speeds) : 0;
  const runSpeeds = matchingBenchmarks.map((item) => item.decodeTokensPerSecond).filter(Number.isFinite);
  const minRun = runSpeeds.length ? Math.min(...runSpeeds) : null;
  const maxRun = runSpeeds.length ? Math.max(...runSpeeds) : null;
  const newestRun = matchingBenchmarks.find((item) => item.date) || null;
  const latestEngine = matchingBenchmarks[0];
  const params = parameterSizes(recipe.description, recipe.title);
  const kind = architecture(recipe.description, recipe.title);
  const coding = /coding|agentic|\bcode\b/i.test(`${goal || ''} ${recipe.description}`);
  const multimodal = /multimodal|vision|image/i.test(recipe.description);
  const sparkLabel = `${recipe.nodes} Spark${recipe.nodes === 1 ? '' : 's'}`;
  const quantization = latestEngine?.quantization || (recipe.title.match(/\b(?:NVFP4|FP8|BF16|GGUF|AWQ)\b/i)?.[0] ?? 'recipe quantization');
  const engine = latestEngine
    ? `${latestEngine.engine}${latestEngine.engineVersion ? ` ${latestEngine.engineVersion}` : ''} / ${quantization}${latestEngine.method ? ` / ${latestEngine.method}` : ''} / ${sparkLabel}`
    : `${quantization} / ${sparkLabel}`;
  const range = runSpeeds.length > 1
    ? `${minRun}–${maxRun} tok/s across ${runSpeeds.length} latest runs${newestRun ? `; ${newestRun.date.slice(0, 10)}` : ''}`
    : speedMax > 0 ? `${speedMax} tok/s recipe result` : 'No throughput result published';
  const recommendation = goal === 'Daily driver' ? 'Highest'
    : goal ? `High — ${goal.toLowerCase()}`
      : speedMax > 0 ? 'Medium — measured recipe' : 'Evidence gap';
  const quality = goal === 'Daily driver' ? 5 : goal === 'Coding' || goal === 'Most capable' ? 4.5 : goal ? 4 : 3;
  const key = sourceKey(recipe.slug);

  return {
    source: {
      key,
      value: {
        title: `HowToSpark recipe: ${recipe.title}`,
        url: recipe.url,
        date: newestRun?.date ? `Latest run ${newestRun.date.slice(0, 10)}` : 'Current recipe snapshot',
        claim: speedMax > 0 ? `${recipe.description} Latest normalized throughput: ${range}.` : recipe.description
      }
    },
    model: {
      id: `howtospark-${recipe.slug}`,
      sourceSlug: recipe.slug,
      rank,
      name: displayName(recipe, matchingBenchmarks),
      official: recipe.via || 'See HowToSpark recipe',
      howToSparkModelUrl: config.howToSparkModelPaths?.[recipe.slug]
        ? absoluteUrl(config.howToSparkModelPaths[recipe.slug]) : null,
      nvidiaModelCardUrl: config.nvidiaModelCards?.[recipe.slug] || null,
      type: kind,
      totalParams: params.totalParams,
      activeParams: params.activeParams,
      context: recipe.context || latestEngine?.context || 'Not stated',
      speedMax,
      speedTypical: speedMax > 0 ? `${speedMax} tok/s` : 'Evidence gap',
      speedRange: range,
      engine,
      quality,
      qualityLabel: goal ? `HowToSpark: ${goal}` : 'HowToSpark measured recipe',
      recommendation,
      nodes: recipe.nodes,
      measured: speedMax > 0,
      multimodal,
      coding,
      strengths: [
        ...(goal ? [`HowToSpark ${goal.toLowerCase()} pick`] : []),
        ...(speedMax > 0 ? ['Measured on DGX Spark hardware'] : []),
        ...(recipe.context ? [`${recipe.context} context recipe`] : [])
      ],
      weaknesses: [
        'Task quality should be validated against your workload',
        ...(recipe.nodes > 1 ? [`Requires ${recipe.nodes} DGX Sparks`] : [])
      ],
      sources: [key],
      command: command || `# See the reproducible recipe:\n# ${recipe.url}`,
      verdict: recipe.description
    }
  };
}

function modelFromBenchmarkGroup(slug, matchingBenchmarks, rank) {
  const first = matchingBenchmarks[0];
  const bestRun = [...matchingBenchmarks].sort((a, b) => b.decodeTokensPerSecond - a.decodeTokensPerSecond)[0];
  const speeds = matchingBenchmarks.map((item) => item.decodeTokensPerSecond).filter(Number.isFinite);
  const speedMax = Math.max(...speeds);
  const min = Math.min(...speeds);
  const key = sourceKey(`benchmark_${slug}`);
  const range = `${min}–${speedMax} tok/s across ${speeds.length} latest runs; ${first.date.slice(0, 10)}`;
  return {
    source: {
      key,
      value: {
        title: `HowToSpark latest benchmarks: ${first.name}`,
        url: first.url,
        date: `Latest run ${first.date.slice(0, 10)}`,
        claim: `Latest HowToSpark feed reports ${range}.`
      }
    },
    model: {
      id: `howtospark-${slug}`,
      sourceSlug: slug,
      rank,
      name: first.name,
      official: 'See HowToSpark benchmark',
      howToSparkModelUrl: config.howToSparkModelPaths?.[slug]
        ? absoluteUrl(config.howToSparkModelPaths[slug]) : null,
      nvidiaModelCardUrl: config.nvidiaModelCards?.[slug] || null,
      type: 'Unknown',
      totalParams: 'Not stated',
      activeParams: 'Not stated',
      context: first.context || 'Not stated',
      speedMax,
      speedTypical: `${speedMax} tok/s`,
      speedRange: range,
      engine: `${bestRun.engine}${bestRun.engineVersion ? ` ${bestRun.engineVersion}` : ''} / ${bestRun.quantization} / ${bestRun.nodes} Spark${bestRun.nodes === 1 ? '' : 's'}`,
      quality: 3,
      qualityLabel: 'Latest HowToSpark benchmark',
      recommendation: 'Measured result',
      nodes: bestRun.nodes,
      measured: true,
      multimodal: false,
      coding: false,
      strengths: ['Measured on DGX Spark hardware', 'Present in the latest benchmark feed'],
      weaknesses: [
        'No HowToSpark recipe metadata is available yet',
        'Task quality should be validated against your workload',
        ...(bestRun.nodes > 1 ? [`Requires ${bestRun.nodes} DGX Sparks`] : [])
      ],
      sources: [key],
      command: `# No recipe is published yet. Inspect the benchmark:\n# ${first.url}`,
      verdict: `Latest HowToSpark runs report ${range}.`
    }
  };
}

const [homeHtml, recipesHtml] = await Promise.all([fetchPage('/'), fetchPage('/recipes')]);
const benchmarks = parseLatestBenchmarks(homeHtml, sourceUrl);
const goals = parseCuratedGoals(homeHtml);
const recipes = parseRecipeCards(recipesHtml);

if (recipes.length < config.minimumModels) {
  throw new Error(`HowToSpark returned ${recipes.length} recipes; refusing to replace data below minimumModels=${config.minimumModels}`);
}
for (const recipe of recipes) {
  if (!Number.isInteger(recipe.nodes) || recipe.nodes < 1 || recipe.nodes > 8) {
    throw new Error(`Implausible node count for ${recipe.slug}: ${recipe.nodes}`);
  }
  if (recipe.speed !== null && (recipe.speed <= 0 || recipe.speed > 1_000)) {
    throw new Error(`Implausible throughput for ${recipe.slug}: ${recipe.speed}`);
  }
}
for (const benchmark of benchmarks) {
  if (!benchmark.decodeTokensPerSecond || benchmark.decodeTokensPerSecond > 1_000) {
    throw new Error(`Implausible benchmark throughput at ${benchmark.url}: ${benchmark.decodeTokensPerSecond}`);
  }
}

const newestBenchmarkAt = benchmarks.map((item) => item.date).filter(Boolean).sort().at(-1);
if (!newestBenchmarkAt) throw new Error('HowToSpark benchmark dates could not be parsed');
const ageDays = (Date.now() - new Date(newestBenchmarkAt).valueOf()) / 86_400_000;
if (ageDays > config.maximumAgeDays) {
  throw new Error(`Newest HowToSpark benchmark is ${ageDays.toFixed(1)} days old; maximumAgeDays=${config.maximumAgeDays}`);
}

const recipeOrder = [...recipes].sort((a, b) => {
  const goalA = [...goals.keys()].indexOf(a.slug);
  const goalB = [...goals.keys()].indexOf(b.slug);
  return (goalA < 0 ? Number.MAX_SAFE_INTEGER : goalA) - (goalB < 0 ? Number.MAX_SAFE_INTEGER : goalB)
    || recipes.indexOf(a) - recipes.indexOf(b);
});

const detailPages = await Promise.all(recipeOrder.map((recipe) => fetchPage(new URL(recipe.url).pathname)));
const normalized = [];
const coveredBenchmarkSlugs = new Set();
recipeOrder.forEach((recipe, index) => {
  const matching = benchmarks.filter((benchmark) => recipeMatchesBenchmark(recipe.slug, benchmark.slug));
  matching.forEach((benchmark) => coveredBenchmarkSlugs.add(benchmark.slug));
  normalized.push(modelFromRecipe(recipe, matching, goals.get(recipe.slug), index + 1, selectServeCommand(detailPages[index])));
});

const remainingGroups = new Map();
for (const benchmark of benchmarks.filter((item) => !coveredBenchmarkSlugs.has(item.slug))) {
  const group = remainingGroups.get(benchmark.slug) || [];
  group.push(benchmark);
  remainingGroups.set(benchmark.slug, group);
}
for (const [slug, matching] of remainingGroups) {
  normalized.push(modelFromBenchmarkGroup(slug, matching, normalized.length + 1));
}

const sourceData = {
  schemaVersion: 1,
  mode: config.mode,
  sourceUrl: sourceUrl.toString(),
  generatedAt: newestBenchmarkAt,
  latestBenchmarkCount: benchmarks.length,
  latestBenchmarkDate: newestBenchmarkAt.slice(0, 10),
  hardwareEvidence: ['howtospark_hardware'],
  sources: {
    howtospark_hardware: {
      title: 'HowToSpark: NVIDIA DGX Spark hardware summary',
      url: sourceUrl.toString(),
      date: `Snapshot ${newestBenchmarkAt.slice(0, 10)}`,
      claim: 'HowToSpark identifies the benchmark hardware as NVIDIA DGX Spark with 128 GB unified LPDDR5x and 273 GB/s bandwidth.'
    },
    ...Object.fromEntries(normalized.map((entry) => [entry.source.key, entry.source.value]))
  },
  models: normalized.map((entry) => entry.model)
};

const output = `// Generated by scripts/update-howtospark.mjs. Do not edit by hand.\nwindow.HOWTOSPARK_DATA = ${JSON.stringify(sourceData, null, 2)};\n`;
let current = null;
try { current = await fs.readFile(outputPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }

if (checkOnly) {
  if (current !== output) {
    console.error('HowToSpark data is not current. Run npm run update:data.');
    process.exitCode = 1;
  } else {
    console.log(`HowToSpark data is current: ${sourceData.models.length} models, ${benchmarks.length} latest runs.`);
  }
} else if (current === output) {
  console.log(`No data changes: ${sourceData.models.length} models, ${benchmarks.length} latest runs.`);
} else {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, output);
  console.log(`Updated ${path.relative(root, outputPath)}: ${sourceData.models.length} models, ${benchmarks.length} latest runs.`);
}
