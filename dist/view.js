import { icon } from './icons.js';

export const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
export const formatNumber = (value) => new Intl.NumberFormat('en-US').format(value);
export function fileSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(Math.max(1, bytes)) / Math.log(1000)), units.length - 1);
  return (
    new Intl.NumberFormat('en-US', { maximumFractionDigits: index ? 1 : 0 }).format(
      bytes / 1000 ** index
    ) +
    ' ' +
    units[index]
  );
}
export const fileIcon = (kind) =>
  ({ parquet: 'layers', csv: 'table', tsv: 'table', json: 'braces', duckdb: 'database' })[kind] ||
  'file';
export const blankSettings = () => ({ page: 0, size: 10, sort: null, filter: null, search: '' });
export const errorText = (error) =>
  String(error?.message || error)
    .replace(/^Error:\s*/i, '')
    .slice(0, 3000);
export const errorBox = (title, error) =>
  '<div class="inline-error" role="alert"><strong>' +
  escape(title) +
  '</strong><pre>' +
  escape(errorText(error)) +
  '</pre></div>';
export function emptyState(glyph, title, description, action = '') {
  return (
    '<div class="empty-state"><span class="empty-icon">' +
    icon(glyph) +
    '</span><h3>' +
    escape(title) +
    '</h3><p>' +
    escape(description) +
    '</p>' +
    action +
    '</div>'
  );
}
function isNumeric(type) {
  return (
    /^(U?(TINY|SMALL|BIG|HUGE)?INT(EGER)?|FLOAT|DOUBLE|DECIMAL|REAL|NUMERIC)(\b|\()/.test(type) &&
    !type.endsWith('[]')
  );
}
function fieldIcon(type) {
  if (isNumeric(type)) return '#';
  if (/^(DATE|TIMESTAMP|TIME)/.test(type)) return icon('calendar');
  if (/^(STRUCT|MAP|JSON|LIST)/.test(type) || type.includes('[')) return '{}';
  return 'Aa';
}
function cell(value, column, source) {
  if (value === null || value === undefined) return '<td class="null-value">NULL</td>';
  if (source.sample && source.name === 'flights' && column.name === 'status') {
    const style = { 'On time': 'on-time', Delayed: 'delayed', Early: 'early' }[value];
    if (style) return '<td><span class="badge ' + style + '">' + escape(value) + '</span></td>';
  }
  let text = value;
  if (source.sample && source.name === 'flights' && column.name === 'delay_min' && Number(value) > 0)
    text = '+' + value;
  const style = isNumeric(column.type)
    ? 'numeric'
    : source.sample && /^(airline|airport_name|city|full_name)$/.test(column.name)
      ? 'label-value'
      : '';
  return '<td class="' + style + '" title="' + escape(value) + '">' + escape(text) + '</td>';
}
export function dataTable(source, data, settings, pane) {
  const columns = source.columns
    .map((c, i) => {
      const direction = settings.sort?.field === c.name ? settings.sort.direction : '';
      const sortAria = direction
        ? ' aria-sort="' + (direction === 'asc' ? 'ascending' : 'descending') + '"'
        : '';
      return (
        '<th scope="col"' +
        sortAria +
        '><button data-act="sort" data-pane="' +
        pane +
        '" data-col="' +
        i +
        '" aria-label="Sort by ' +
        escape(c.name) +
        '" title="' +
        escape(c.type) +
        '"><span class="header-name"><span class="type-symbol" aria-hidden="true">' +
        fieldIcon(c.type) +
        '</span>' +
        escape(c.name) +
        '</span><span class="sort-mark">' +
        icon(direction === 'asc' ? 'up' : direction === 'desc' ? 'down' : 'sort') +
        '</span></button></th>'
      );
    })
    .join('');
  const lines = data.values
    .map(
      (row, index) =>
        '<tr><td class="row-index">' +
        (index + data.page * data.size + 1) +
        '</td>' +
        row.map((v, i) => cell(v, source.columns[i], source)).join('') +
        '</tr>'
    )
    .join('');
  const message = data.total
    ? ''
    : emptyState(
        'search',
        'No rows found',
        settings.search || settings.filter
          ? 'Try another search or clear the filter.'
          : 'This dataset contains zero rows.'
      );
  return (
    '<table class="data-table" aria-label="' +
    (pane === 'source' ? 'Data preview' : 'SQL results') +
    '"><thead><tr><th scope="col" class="row-index" aria-label="Row number">#</th>' +
    columns +
    '</tr></thead><tbody>' +
    lines +
    '</tbody></table>' +
    message
  );
}
export function pagination(data, pane) {
  const start = data.total ? data.size * data.page + 1 : 0;
  const end = Math.min(data.size * (data.page + 1), data.total);
  const options = [10, 25, 50, 100]
    .map((n) => '<option' + (n === data.size ? ' selected' : '') + '>' + n + '</option>')
    .join('');
  const button = (dir, disabled) =>
    '<button class="icon-button" data-act="page" data-pane="' +
    pane +
    '" data-dir="' +
    dir +
    '" aria-label="' +
    (dir === 1 ? 'Next' : 'Previous') +
    ' page" ' +
    (disabled ? 'disabled' : '') +
    '>' +
    icon(dir === 1 ? 'chevron-right' : 'chevron-left') +
    '</button>';
  return (
    '<div class="pager"><span>' +
    formatNumber(start) +
    '–' +
    formatNumber(end) +
    ' of ' +
    formatNumber(data.total) +
    ' rows</span><div class="pager-actions"><label class="pager-size"><span>Rows per page</span><select aria-label="Rows per page" data-size="' +
    pane +
    '">' +
    options +
    '</select></label>' +
    button(-1, data.page === 0) +
    button(1, end >= data.total) +
    '</div></div>'
  );
}
export function schemaMarkup(source) {
  const items = source.columns
    .map(
      (c, i) =>
        '<tr><td class="row-index">' +
        (i + 1) +
        '</td><td>' +
        escape(c.name) +
        '</td><td><span class="schema-type">' +
        escape(c.type) +
        '</span></td><td class="nullable">' +
        (c.nullable ? 'Yes' : 'No') +
        '</td></tr>'
    )
    .join('');
  return (
    '<div class="meta-heading"><h3>Column definitions</h3><small>' +
    source.columns.length +
    ' columns</small></div><div class="table-region"><table class="data-table" aria-label="Schema"><thead><tr><th class="row-index">#</th><th class="plain-head">Column</th><th class="plain-head">Data type</th><th class="plain-head">Nullable</th></tr></thead><tbody>' +
    items +
    '</tbody></table></div>'
  );
}
export function profileMarkup(source, field, profile) {
  const peak = Number(profile.distribution[0]?.n || 1);
  const bars = profile.distribution
    .map(
      (row) =>
        '<div class="bar-row"><span class="bar-name" title="' +
        escape(row.label ?? 'NULL') +
        '">' +
        escape(row.label ?? 'NULL') +
        '</span><div class="bar-track"><span style="width:' +
        (Number(row.n) / peak) * 100 +
        '%"></span></div><span>' +
        formatNumber(row.n) +
        '</span></div>'
    )
    .join('');
  const stats = profile.summary;
  const facts = [
    ['Type', source.columns.find((c) => c.name === field).type],
    ['Distinct values', formatNumber(stats.distinct_values)],
    ['Missing values', formatNumber(stats.missing)],
    ['Minimum', stats.minimum ?? 'NULL'],
    ['Maximum', stats.maximum ?? 'NULL']
  ];
  return (
    '<div class="profile-split"><section><h3>Most frequent values</h3>' +
    (bars || '<p class="muted">No values</p>') +
    '</section><section class="profile-summary"><h3>Column statistics</h3><dl>' +
    facts.map(([k, v]) => '<div><dt>' + escape(k) + '</dt><dd>' + escape(v) + '</dd></div>').join('') +
    '</dl></section></div>'
  );
}
export const filterRules = {
  contains: 'contains',
  equals: 'equals',
  gt: 'is greater than',
  lt: 'is less than',
  null: 'is null',
  present: 'is not null'
};
export function option(value, text, selected) {
  return (
    '<option value="' +
    escape(value) +
    '"' +
    (value === selected ? ' selected' : '') +
    '>' +
    escape(text) +
    '</option>'
  );
}
