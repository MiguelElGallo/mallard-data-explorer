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

## Draft SQL with GitHub Copilot

On GitHub Pages, choose **Ask Copilot**, enter a question, and select the tables Copilot should know about. **Preview prompt** shows the exact text, including table names, column names, and types. File contents and result rows stay in Mallard.

Choose **Copy prompt & open Copilot**. In the new window, paste the prompt and send it from your own GitHub account with Copilot access. Back in Mallard, choose **Paste SQL**, paste the reply, and select **Use in SQL editor**. Review the draft and choose **Run query** to execute it locally. Exploring files and writing SQL yourself works without a GitHub account. [Chatting with GitHub Copilot](https://docs.github.com/en/copilot/how-tos/copilot-on-github/chat-with-copilot/chat-in-github)

The Sites edition offers the same workflow with **Ask ChatGPT**. To run that edition locally, serve `dist/` in place of `build/pages`. Both editions open the visitor’s own chat and require no application API key.

## Publish on GitHub Pages

Select **GitHub Actions** under the repository’s **Settings → Pages**. Pushing to `main` runs the included workflow, which builds the Copilot edition and publishes `build/pages/`.

## Runtime and credits

Mallard bundles DuckDB **2.0.1** through `@duckdb/duckdb-wasm@1.33.1-dev124.0`. Signed Parquet and JSON extensions load from the same origin as the app. Dependency versions and original license notices are in [the vendor directory](dist/vendor/). The banner illustration is documented in [the artwork notes](ARTWORK.md).
