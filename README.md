# Mallard data explorer

[Open the local explorer on GitHub Pages](https://miguelelgallo.github.io/mallard-data-explorer/) · [Open Mallard with Copilot](https://neoquack.fastapicloud.dev/mallard/)

Explore files from your computer with DuckDB-Wasm. Drop a Parquet, CSV, TSV, JSON, JSONL, NDJSON, or DuckDB file into the browser. Use the preview to sort and filter rows, inspect column types and value distributions, or write SQL to join several files and export the results as CSV. DuckDB databases open read-only.

The public GitHub Pages edition runs the explorer and SQL console entirely in the browser. The app serves its own engine, fonts, extensions, and three synthetic flight datasets. Selected files and query history live in the current tab. Refreshing starts a new session.

## Run locally

With Node.js 20 or newer and Python 3, run these commands from the repository root.

```sh
node scripts/build-pages.mjs
python3 -m http.server 8000 --bind 127.0.0.1 --directory build/pages
```

Open [the local explorer](http://127.0.0.1:8000/). An HTTP server lets the browser load ES modules and the DuckDB worker.

## GitHub Copilot

In the hosted workspace, choose **Ask Copilot**, then **Sign in with GitHub**. Select the table schemas to share, enter a question and choose **Draft SQL**. Review the suggestion in the editor and choose **Run query** when ready. GitHub applies its Copilot eligibility, organization policies and usage limits to the signed-in visitor. [GitHub Copilot SDK authentication](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth)

The browser sends your question and the chosen table names, column names and types. Imported files, row values and query results stay in your tab. The app uses encrypted, HTTP-only, path-scoped cookies that expire within one hour. The Pages button opens the hosted workspace in a new tab. Import files in the workspace where you plan to query them.

To host the assistant, install this repository as a Python package and mount `mallard_cloud.app.create_app()` at `/mallard` in FastAPI. Set `MALLARD_PUBLIC_URL` to the full public address ending in `/mallard` and register `MALLARD_PUBLIC_URL/auth/github/callback` as the GitHub user authorization callback. Set `MALLARD_GITHUB_CLIENT_ID`, `MALLARD_GITHUB_CLIENT_SECRET`, and `MALLARD_SESSION_KEY` in your host’s environment. Generate the session key with `cryptography.fernet.Fernet.generate_key()`. Keep the client secret and session key in the host’s secret store. The SDK downloads its pinned runtime on first use.

The Sites edition includes **Ask ChatGPT**. Choose the tables to include, copy the prepared prompt into your own ChatGPT window, and bring the SQL draft back to the editor for review. To run that edition locally, serve `dist/` in place of `build/pages`.

## Publish on GitHub Pages

Select **GitHub Actions** under the repository’s **Settings → Pages**. Pushing to `main` runs the included workflow and publishes the static explorer from `build/pages/`.

## Runtime and credits

Mallard bundles DuckDB **2.0.1** through `@duckdb/duckdb-wasm@1.33.1-dev124.0`. Signed Parquet and JSON extensions load from the same origin as the app. Dependency versions and original license notices are in [the vendor directory](dist/vendor/). The banner illustration is documented in [the artwork notes](ARTWORK.md).
