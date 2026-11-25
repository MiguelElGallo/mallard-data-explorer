# Mallard data explorer

[Open Mallard on GitHub Pages](https://miguelelgallo.github.io/mallard-data-explorer/)

Explore files from your computer with DuckDB-Wasm. Drop a Parquet, CSV, TSV, JSON, JSONL, NDJSON, or DuckDB file into the browser. Use the preview to sort and filter rows, inspect column types and value distributions, or write SQL to join several files and export the results as CSV. DuckDB databases open read-only.

The public GitHub Pages edition runs the explorer and SQL console entirely in the browser. The app serves its own engine, fonts, extensions, and three synthetic flight datasets. Selected files and query history live in the current tab. Refreshing starts a new session.

## Run locally

With Node.js 20 or newer and Python 3, run these commands from the repository root.

```sh
node scripts/build-pages.mjs
python3 -m http.server 8000 --bind 127.0.0.1 --directory build/pages
```

Open [the local explorer](http://127.0.0.1:8000/). An HTTP server lets the browser load ES modules and the DuckDB worker.

## Optional ChatGPT window

The edition in `dist/` includes **Ask ChatGPT**. To try it locally, serve `dist/` with the same Python command in place of `build/pages`.

Choose the tables to describe and enter your question. Mallard copies a DuckDB prompt with the selected table names, column names, and types, and opens ChatGPT in a separate window. Paste the prompt into your own ChatGPT conversation and send it. Bring the SQL reply back to Mallard, review it, and choose **Run query**. This workflow uses the clipboard and the visitor’s ChatGPT account. It requires no API key.

## Publish on GitHub Pages

Select **GitHub Actions** under the repository’s **Settings → Pages**. Pushing to `main` runs the included workflow. It builds and publishes `build/pages/`, omitting the ChatGPT window, its JavaScript, and its stylesheet.

## Runtime and credits

Mallard bundles DuckDB **2.0.1** through `@duckdb/duckdb-wasm@1.33.1-dev124.0`. Signed Parquet and JSON extensions load from the same origin as the app. Dependency versions and original license notices are in [the vendor directory](dist/vendor/). The banner illustration is documented in [the artwork notes](ARTWORK.md).
