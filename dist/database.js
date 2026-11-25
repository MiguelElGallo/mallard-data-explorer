import { AsyncDuckDB, VoidLogger, DuckDBDataProtocol } from './vendor/duckdb.mjs';

export const CLIENT_VERSION = '1.33.1-dev124.0';
export const fileTypes = {
  parquet: 'parquet',
  pq: 'parquet',
  csv: 'csv',
  tsv: 'tsv',
  json: 'json',
  jsonl: 'json',
  ndjson: 'json'
};
let database;
let connection;
let fileSerial = 0;
let resultSerial = 0;
let exportSerial = 0;
const tableNames = new Set();

export const identifier = (name) => '"' + String(name).replaceAll('"', '""') + '"';
const literal = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const localURL = (path) => new URL(path, import.meta.url).href;
const tableRef = (source) =>
  (source.temporary ? 'temp.main.' : 'memory.main.') + identifier(source.name);
const rows = (table) => table.toArray().map((row) => row.toJSON());

export async function startEngine() {
  const response = await fetch(localURL('./vendor/duckdb-2.0.1.wasm.gz'));
  const worker = new Worker(localURL('./vendor/worker.js'));
  let moduleURL;
  try {
    if (!response.ok) throw new Error('The database engine could not be downloaded.');
    const packed = new Uint8Array(await response.arrayBuffer());
    let binary = packed;
    if (packed[0] === 0x1f && packed[1] === 0x8b) {
      const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'));
      binary = await new Response(stream).arrayBuffer();
    }
    moduleURL = URL.createObjectURL(new Blob([binary], { type: 'application/wasm' }));
    database = new AsyncDuckDB(new VoidLogger(), worker);
    await database.instantiate(moduleURL);
    await database.open({ extensionRepository: localURL('./extensions'), maximumThreads: 1 });
    connection = await database.connect();
    const version = await connection.query('SELECT version() AS version');
    return version.get(0).version;
  } catch (error) {
    worker.terminate();
    throw error;
  } finally {
    if (moduleURL) URL.revokeObjectURL(moduleURL);
  }
}

async function inspect(source) {
  const ref = tableRef(source);
  const schema = rows(await connection.query('DESCRIBE SELECT * FROM ' + ref));
  const count = await connection.query('SELECT count(*) AS n FROM ' + ref);
  return {
    ...source,
    columns: schema.map((c) => ({
      name: c.column_name,
      type: c.column_type,
      nullable: c.null === 'YES'
    })),
    count: Number(count.get(0).n)
  };
}

export function supportsFile(name) {
  return Object.hasOwn(fileTypes, name.toLowerCase().split('.').pop());
}

function reserveName(stem) {
  const base =
    stem
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}_]+/gu, '_')
      .replace(/^_+|_+$/g, '') || 'dataset';
  let name = base;
  for (let n = 2; tableNames.has(name); n++) name = base + '_' + n;
  tableNames.add(name);
  return name;
}

export async function importDatabase(file) {
  const id = ++fileSerial;
  const path = 'mallard-input-' + id + '.duckdb';
  const catalog = 'local_database_' + id;
  const aliases = [];
  let attached = false;
  await database.registerFileHandle(path, file, DuckDBDataProtocol.BROWSER_FILEREADER, true);
  try {
    await connection.query(
      'ATTACH ' + literal(path) + ' AS ' + identifier(catalog) + ' (TYPE DUCKDB, READ_ONLY)'
    );
    attached = true;
    const catalogTables = rows(
      await connection.query(
        'SELECT table_schema, table_name FROM information_schema.tables WHERE table_catalog = ' +
          literal(catalog) +
          " AND table_type = 'BASE TABLE' ORDER BY table_schema, table_name"
      )
    );
    if (!catalogTables.length) throw new Error('This database contains no stored tables.');
    const datasets = [];
    for (const { table_schema, table_name } of catalogTables) {
      const label = (table_schema === 'main' ? '' : table_schema + '.') + table_name;
      const name = reserveName(label);
      const source = {
        name,
        filename: file.name,
        label,
        title: label,
        bytes: file.size,
        kind: 'duckdb',
        sample: false,
        temporary: false
      };
      aliases.push(source);
      const ref = [catalog, table_schema, table_name].map(identifier).join('.');
      await connection.query('CREATE VIEW ' + tableRef(source) + ' AS SELECT * FROM ' + ref);
      datasets.push(await inspect(source));
    }
    return datasets;
  } catch (error) {
    for (const source of aliases) {
      await connection.query('DROP VIEW IF EXISTS ' + tableRef(source)).catch(() => {});
      tableNames.delete(source.name);
    }
    if (attached) await connection.query('DETACH ' + identifier(catalog)).catch(() => {});
    await database.dropFile(path).catch(() => {});
    throw error;
  }
}

export async function importFile(file, sampleTitle) {
  const extension = file.name.toLowerCase().split('.').pop();
  if (!supportsFile(file.name))
    throw new Error('Choose a CSV, TSV, Parquet, JSON, newline-delimited JSON, or DuckDB file.');
  if (!file.size) throw new Error('This file is empty.');
  const fileKind = fileTypes[extension];
  const stem = file.name.replace(/\.[^.]*$/, '');
  const name = reserveName(stem);
  const path = 'mallard-input-' + ++fileSerial + '.' + extension;
  const src = literal(path);
  const reader =
    fileKind === 'parquet'
      ? 'read_parquet(' + src + ')'
      : fileKind === 'json'
        ? 'read_json_auto(' + src + ')'
        : 'read_csv_auto(' + src + (fileKind === 'tsv' ? ', delim = ' + literal('\t') : '') + ')';
  const title = sampleTitle || stem || file.name;
  const source = {
    name,
    filename: file.name,
    title,
    bytes: file.size,
    kind: fileKind,
    sample: Boolean(sampleTitle),
    temporary: false
  };
  let registered = false;
  let created = false;
  try {
    await database.registerFileHandle(path, file, DuckDBDataProtocol.BROWSER_FILEREADER, true);
    registered = true;
    await connection.query('CREATE VIEW ' + tableRef(source) + ' AS SELECT * FROM ' + reader);
    created = true;
    return await inspect(source);
  } catch (error) {
    if (created) await connection.query('DROP VIEW ' + tableRef(source)).catch(() => {});
    if (registered) await database.dropFile(path).catch(() => {});
    tableNames.delete(name);
    throw error;
  }
}

function modifiers(source, settings) {
  const fields = source.columns.map((c) => c.name);
  const column = (name) => 'src.' + identifier(name);
  const terms = [];
  const search = settings.search?.trim();
  if (search) {
    const needle = 'lower(' + literal(search) + ')';
    terms.push(
      '(' +
        fields
          .map((name) => 'contains(lower(CAST(' + column(name) + ' AS VARCHAR)), ' + needle + ')')
          .join(' OR ') +
        ')'
    );
  }
  const filter = settings.filter;
  if (filter && fields.includes(filter.field)) {
    const ref = column(filter.field);
    const value = literal(filter.value);
    const op = { equals: '=', gt: '>', lt: '<' }[filter.rule];
    if (filter.rule === 'null') terms.push(ref + ' IS NULL');
    else if (filter.rule === 'present') terms.push(ref + ' IS NOT NULL');
    else if (filter.rule === 'contains')
      terms.push('contains(lower(CAST(' + ref + ' AS VARCHAR)),lower(' + value + '))');
    else if (op) terms.push(ref + ' ' + op + ' ' + value);
  }
  const where = terms.length ? ' WHERE ' + terms.join(' AND ') : '';
  const sort = settings.sort;
  const order =
    sort && fields.includes(sort.field)
      ? ' ORDER BY ' +
        column(sort.field) +
        (sort.direction === 'desc' ? ' DESC' : ' ASC') +
        ' NULLS LAST'
      : '';
  return { where, order };
}

export function explorerSQL(source, settings) {
  const { where, order } = modifiers(source, settings);
  if (!where && !order) return 'SELECT *\nFROM ' + identifier(source.name) + '\nLIMIT 100;';
  return [
    'SELECT src.*',
    'FROM ' + identifier(source.name) + ' AS src',
    where.trim(),
    order.trim(),
    'LIMIT 100;'
  ]
    .filter(Boolean)
    .join('\n');
}

export async function readPage(source, settings) {
  const { where, order } = modifiers(source, settings);
  const from = ' FROM ' + tableRef(source) + ' AS src' + where;
  const total = where
    ? Number((await connection.query('SELECT count(*) AS n' + from)).get(0).n)
    : source.count;
  const size = settings.size;
  const page = Math.min(settings.page, Math.max(0, Math.ceil(total / size) - 1));
  const fields = source.columns.map(
    (c) => 'CAST(src.' + identifier(c.name) + ' AS VARCHAR) AS ' + identifier(c.name)
  );
  const batch = await connection.query(
    'SELECT ' + fields.join(', ') + from + order + ' LIMIT ' + size + ' OFFSET ' + page * size
  );
  // Positional access preserves arbitrary file headers, including "get", "toJSON", and "__proto__".
  const vectors = fields.map((_, i) => batch.getChildAt(i));
  const values = Array.from({ length: batch.numRows }, (_, i) => vectors.map((v) => v.get(i)));
  return { values, total, page, size };
}

export async function profileColumn(source, field) {
  const ref = tableRef(source);
  const col = identifier(field);
  const summary = await connection.query(
    'SELECT count(*) - count(' +
      col +
      ') AS missing, count(DISTINCT ' +
      col +
      ') AS distinct_values, CAST(min(' +
      col +
      ') AS VARCHAR) AS minimum, CAST(max(' +
      col +
      ') AS VARCHAR) AS maximum FROM ' +
      ref
  );
  const distribution = await connection.query(
    'SELECT CAST(' +
      col +
      ' AS VARCHAR) AS label, count(*) AS n FROM ' +
      ref +
      ' GROUP BY ' +
      col +
      ' ORDER BY n DESC, label ASC NULLS LAST LIMIT 8'
  );
  return { summary: summary.get(0).toJSON(), distribution: rows(distribution) };
}

export async function runSQL(sql) {
  const source = { name: '__mallard_result_' + ++resultSerial, temporary: true };
  // DuckDB's query() parses exactly one read query, including CTEs and DESCRIBE.
  await connection.query(
    'CREATE TEMP TABLE ' + identifier(source.name) + ' AS SELECT * FROM query(' + literal(sql) + ')'
  );
  try {
    return await inspect(source);
  } catch (error) {
    await releaseResult(source);
    throw error;
  }
}
export async function releaseResult(source) {
  if (source?.temporary) await connection.query('DROP TABLE IF EXISTS ' + tableRef(source));
}
export async function exportCSV(source, settings) {
  const { where, order } = modifiers(source, settings);
  const path = 'mallard-export-' + ++exportSerial + '.csv';
  try {
    await connection.query(
      'COPY (SELECT src.* FROM ' +
        tableRef(source) +
        ' AS src' +
        where +
        order +
        ') TO ' +
        literal(path) +
        ' (FORMAT CSV, HEADER)'
    );
    return new Blob([await database.copyFileToBuffer(path)], { type: 'text/csv;charset=utf-8' });
  } finally {
    await database.dropFile(path).catch(() => {});
  }
}
