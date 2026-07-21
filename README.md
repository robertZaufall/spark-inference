# Spark inference workbench

The site is a static DGX Spark model decision workbench. Its current benchmark and recipe facts are synchronized from [HowToSpark](https://howtospark.com/) by a scheduled GitHub Action.

## Data update

```sh
npm ci
npm run update:data
```

The updater reads HowToSpark's rendered home, recipe index, and recipe pages, then writes `data/howtospark-data.js`. It deliberately uses deterministic parsing and validation rather than an LLM: updates remain reproducible, require no secret, and produce reviewable diffs.

The updater refuses to overwrite the snapshot if the source exposes too few recipes, no latest benchmark rows, or data older than the configured freshness limit. The committed snapshot means a temporary source outage cannot break the deployed site.

## Transition strategy

`data-source.config.json` owns the migration boundary:

- `transition` makes HowToSpark authoritative for matching throughput, engine, context, recipe, and command fields, while retaining unmatched historical records and locally curated quality metadata.
- `howtospark-only` renders only normalized HowToSpark records and evidence.

Once the external coverage is sufficient, change `mode` to `howtospark-only` and run `npm run update:data`. No renderer or workflow change is required.

The workbench defaults to single-system inference with the `1 Spark only` hardware filter. Users can include all configurations or isolate `2+ Sparks`; multi-system results receive a distinct row highlight and an explicit hardware warning in the model detail view.

The scheduled workflow runs daily and commits only when the normalized source data changed. A successful commit triggers the existing GitHub Pages deployment.
