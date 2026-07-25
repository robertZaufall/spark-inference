import * as cheerio from 'cheerio';

function clean(value = '') {
  return value.replace(/\s+/g, ' ').trim();
}

function number(value) {
  const parsed = Number.parseFloat(String(value).replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function utcDay(date) {
  return `${date.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

function parseBenchmarkDate(value, now) {
  const label = clean(value);
  if (!label) return null;

  if (/^(?:now|just now)$/i.test(label)) return utcDay(now);

  const relative = label.match(/^(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|weeks?)\s+ago$/i);
  const relativeWord = label.match(/^an?\s+(minute|hour|day|week)\s+ago$/i);
  if (relative || relativeWord) {
    const amount = relative ? Number(relative[1]) : 1;
    const unit = (relative?.[2] || relativeWord[1]).toLowerCase();
    const unitMilliseconds = unit.startsWith('m') ? 60_000
      : unit.startsWith('h') ? 3_600_000
        : unit.startsWith('d') ? 86_400_000
          : 604_800_000;
    return utcDay(new Date(now.valueOf() - amount * unitMilliseconds));
  }

  const exact = new Date(`${label} 00:00:00 UTC`);
  return Number.isNaN(exact.valueOf()) ? null : exact.toISOString();
}

function metricsFromRow($, row) {
  const metrics = {};
  $(row).find('span').each((_, element) => {
    const label = clean($(element).text()).toLowerCase();
    if (!['tok/s', 'ttft', 'prefill'].includes(label)) return;
    const values = $(element).parent().find('span').map((__, span) => clean($(span).text())).get();
    const labelIndex = values.findIndex((value) => value.toLowerCase() === label);
    if (labelIndex > 0) metrics[label] = values[labelIndex - 1];
  });
  return metrics;
}

function recipeNodeCount(slug) {
  const explicit = slug.match(/(?:^|[-_])x(\d+)(?:[-_]|$)/i)?.[1];
  if (explicit) return Number(explicit);
  if (/(?:triple|three)-spark|(?:^|-)tp3(?:-|$)/i.test(slug)) return 3;
  if (/(?:dual|two)-spark|(?:^|-)tp2(?:-|$)/i.test(slug)) return 2;
  return 1;
}

function benchmarkIdentity(href, metrics, context) {
  return [href.split('#')[0].split('/').filter(Boolean).at(-1), context || 'no-context', metrics['tok/s'] || 'no-speed']
    .join('-')
    .replace(/[^a-z0-9.-]+/gi, '-')
    .toLowerCase();
}

export function parseLatestBenchmarks(html, sourceUrl, { now = new Date() } = {}) {
  const $ = cheerio.load(html);
  const heading = $('h2').filter((_, element) => clean($(element).text()) === 'Latest benchmarks').first();
  if (!heading.length) throw new Error('Could not find the Latest benchmarks section on HowToSpark');

  const rows = heading.parent().next().children();
  const benchmarks = [];
  rows.each((_, row) => {
    const $row = $(row);
    const link = $row.is('a[href]') ? $row : $row.find('h3 a[href]').first();
    const href = link.attr('href');
    const isLegacyBenchmark = href?.startsWith('/benchmarks/');
    const isRecipeBenchmark = href?.startsWith('/recipes/') && href.includes('#benchmarks');
    if (!href || (!isLegacyBenchmark && !isRecipeBenchmark)) return;

    const metrics = metricsFromRow($, row);
    const badges = $row.find('[data-slot="badge"]').map((__, badge) => clean($(badge).text())).get();
    const contextBadge = badges.find((badge) => /^ctx\s+/i.test(badge)) || null;
    const context = contextBadge?.replace(/^ctx\s+/i, '') || null;
    const engineBadge = badges.find((badge) => !/^ctx\s+/i.test(badge)) || '';
    const method = badges.find((badge) => badge !== engineBadge && !/^ctx\s+/i.test(badge)) || null;
    const engineParts = engineBadge.split(' ').filter(Boolean);

    const headingText = clean($row.find('h3').first().text());
    const modelAndQuantization = headingText.replace(/\s+on\s+NVIDIA\s+DGX\s+Spark.*$/i, '').trim();
    const legacyQuantization = isLegacyBenchmark ? clean(link.find('span').first().text()) : '';
    const quantization = legacyQuantization
      || modelAndQuantization.match(/(NVFP4|FP4(?:-MoE)?|FP8|BF16|GGUF|AWQ(?:\s*int4)?|INT[248])/i)?.[1]
      || 'Not stated';
    const name = modelAndQuantization
      .replace(new RegExp(`(?:\\s*[—-]\\s*)?${quantization.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), '')
      .trim();

    const dateCandidates = $row.find('span').map((__, span) => clean($(span).text())).get().reverse();
    const date = dateCandidates.map((candidate) => parseBenchmarkDate(candidate, now)).find(Boolean) || null;

    const parsedHref = new URL(href, sourceUrl);
    const slug = isLegacyBenchmark
      ? parsedHref.pathname.slice('/benchmarks/'.length).split('--dgx-spark-')[0]
      : parsedHref.pathname.slice('/recipes/'.length);
    const legacyNodeMatch = href.match(/--dgx-spark-x(\d+)--/);
    const nodes = legacyNodeMatch ? Number(legacyNodeMatch[1]) : recipeNodeCount(slug);

    benchmarks.push({
      id: isLegacyBenchmark ? href.split('--').at(-1) : benchmarkIdentity(href, metrics, context),
      slug,
      name,
      url: parsedHref.toString(),
      date,
      decodeTokensPerSecond: number(metrics['tok/s']),
      timeToFirstToken: metrics.ttft || null,
      prefillTokensPerSecond: metrics.prefill || null,
      quantization,
      engine: engineParts.shift() || 'Unknown',
      engineVersion: engineParts.join(' ') || null,
      method,
      context,
      nodes
    });
  });

  if (!benchmarks.length) throw new Error('HowToSpark returned no latest benchmark rows');
  return benchmarks;
}
