import { icon, fillIcons } from './icons.js';
import {
  CLIENT_VERSION,
  startEngine,
  importFile,
  importDatabase,
  readPage,
  profileColumn,
  runSQL,
  releaseResult,
  exportCSV,
  explorerSQL,
  identifier
} from './database.js';
import {
  escape,
  formatNumber,
  fileSize,
  fileIcon,
  blankSettings,
  errorText,
  errorBox,
  emptyState,
  dataTable,
  pagination,
  schemaMarkup,
  profileMarkup,
  filterRules,
  option
} from './view.js';

const $ = (id) => document.getElementById(id);
const samples = [
  ['flights.parquet', 'Flight operations'],
  ['airports.csv', 'Airports'],
  ['airlines.json', 'Airlines']
];
const views = {
  explorer: ['Data explorer', 'Explore and query files on your machine.'],
  sql: ['SQL console', 'Write SQL against the datasets in your workspace.'],
  history: ['Query history', 'Revisit the queries you’ve run in this tab.']
};
const sources = [];
const log = [];
const profileCache = new Map();
const settings = { source: blankSettings(), result: blankSettings() };
const ticket = { source: 0, result: 0, profile: 0 };
let active = null;
let result = null;
let tab = 'preview';
let view = 'explorer';
let profileField;
let engineVersion = '';
let running = false;
let previousDraft = '';
let searchTimer;
let toastTimer;
let importQueue = Promise.resolve();
const commandKey = /Mac|iPad|iPhone/.test(navigator.platform) ? '⌘' : 'Ctrl';
const editor = $('sql-editor');
const dialog = $('dialog');
fillIcons();
$('run-query').querySelector('kbd').textContent = commandKey + ' ↵';
$('run-query').disabled = true;
editor.value =
  'SELECT airline, COUNT(*) AS flights\nFROM flights\nGROUP BY airline\nORDER BY flights DESC;';
updateLines();
$('result-grid').innerHTML = emptyState(
  'terminal',
  'Ready for a query',
  'Run SQL to see the results here.'
);

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, 4500);
}
function showDialog(title, body) {
  $('dialog-body').innerHTML =
    '<div class="dialog-heading"><h2 id="dialog-title">' +
    escape(title) +
    '</h2><button class="icon-button" data-act="close-dialog" aria-label="Close dialog">' +
    icon('x') +
    '</button></div>' +
    body;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  if (!dialog.open) dialog.showModal();
}
function closeDialog() {
  if (dialog.open) dialog.close();
}
function closeMenu() {
  document.body.classList.remove('menu-open');
  $('scrim').hidden = true;
  document
    .querySelector('.panel-toggle')
    .setAttribute(
      'aria-expanded',
      String(matchMedia('(min-width:821px)').matches && !document.body.classList.contains('rail-hidden'))
    );
}
function toggleMenu() {
  if (matchMedia('(max-width:820px)').matches) {
    const open = document.body.classList.toggle('menu-open');
    $('scrim').hidden = !open;
    document.querySelector('.panel-toggle').setAttribute('aria-expanded', String(open));
    if (open) document.querySelector('.close-menu').focus();
  } else {
    const hidden = document.body.classList.toggle('rail-hidden');
    document.querySelector('.panel-toggle').setAttribute('aria-expanded', String(!hidden));
  }
}
matchMedia('(max-width:820px)').addEventListener('change', closeMenu);
closeMenu();

function drawSources() {
  const seen = new Set();
  const repeated = new Set();
  for (const s of sources) {
    if (seen.has(s.filename)) repeated.add(s.filename);
    seen.add(s.filename);
  }
  $('sources').innerHTML = sources
    .map((s, i) => {
      const hint = s.kind === 'duckdb' ? s.filename : repeated.has(s.filename) ? 'as ' + s.name : '';
      const name =
        '<span class="source-copy"><span class="source-name">' +
        escape(s.label || s.filename) +
        '</span>' +
        (hint ? '<small>' + escape(hint) + '</small>' : '') +
        '</span>';
      return (
        '<button class="dataset-item' +
        (s === active ? ' selected' : '') +
        '" data-source="' +
        i +
        '" data-kind="' +
        s.kind +
        '" aria-pressed="' +
        (s === active) +
        '" title="' +
        escape(s.filename + ' · SQL table ' + s.name) +
        '"><span class="file-glyph">' +
        icon(fileIcon(s.kind)) +
        '</span>' +
        name +
        '</button>'
      );
    })
    .join('');
}
function setView(next) {
  if (!Object.hasOwn(views, next)) return;
  view = next;
  const [title, subtitle] = views[view];
  $('page-title').textContent = title;
  $('page-description').textContent = subtitle;
  $('crumb').textContent = title;
  document.title = title + ' · Mallard';
  for (const btn of document.querySelectorAll('[data-nav]')) {
    const selected = btn.dataset.nav === view;
    btn.classList.toggle('active', selected);
    if (selected) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
  for (const key of Object.keys(views))
    $(key + '-view').hidden = key !== view || (key === 'explorer' && !active);
  $('startup').hidden = view !== 'explorer' || Boolean(active);
  if (view === 'history') drawHistory();
  closeMenu();
}
function selectDataset(source, navigate = true) {
  active = source;
  clearTimeout(searchTimer);
  settings.source = blankSettings();
  $('row-search').value = '';
  $('dataset-title').textContent = source.title;
  $('dataset-title').title = source.title;
  $('hero-filename').innerHTML = icon(fileIcon(source.kind)) + escape(source.filename);
  $('hero-source').textContent = source.sample
    ? 'Sample data'
    : source.kind === 'duckdb'
      ? 'Database table'
      : 'Local file';
  $('row-count').textContent = formatNumber(source.count);
  $('column-count').textContent = formatNumber(source.columns.length);
  $('file-size').textContent = fileSize(source.bytes);
  profileField = source.sample && source.name === 'flights' ? 'status' : source.columns[0]?.name;
  $('source-grid').innerHTML = '<div class="grid-loading">Reading rows…</div>';
  $('source-pager').innerHTML = '';
  drawFilter();
  drawSources();
  if (navigate) setView('explorer');
  else setView(view);
  selectTab('preview');
}
function selectTab(next) {
  tab = next;
  for (const btn of document.querySelectorAll('[data-tab]')) {
    const selected = btn.dataset.tab === next;
    btn.setAttribute('aria-selected', String(selected));
    btn.tabIndex = selected ? 0 : -1;
    $(btn.dataset.tab + '-panel').hidden = !selected;
  }
  $('tab-panel').setAttribute('aria-labelledby', 'tab-' + next);
  if (!active) return;
  if (tab === 'preview') refreshGrid('source');
  if (tab === 'schema') $('schema-panel').innerHTML = schemaMarkup(active);
  if (tab === 'profile') {
    const options = active.columns.map((c) => option(c.name, c.name, profileField)).join('');
    $('profile-panel').innerHTML =
      '<div class="profile-wrap"><div class="profile-head"><label for="profile-field">Profile a column</label><select id="profile-field">' +
      options +
      '</select></div><div id="profile-values" aria-live="polite"></div></div>';
    refreshProfile();
  }
}
async function refreshGrid(pane) {
  const source = pane === 'source' ? active : result;
  if (!source) return;
  const request = ++ticket[pane];
  const grid = $(pane + '-grid');
  const pager = $(pane + '-pager');
  const slice = { ...settings[pane] };
  grid.setAttribute('aria-busy', 'true');
  try {
    const data = await readPage(source, slice);
    if (request !== ticket[pane]) return;
    settings[pane].page = data.page;
    grid.innerHTML = dataTable(source, data, slice, pane);
    pager.innerHTML = pagination(data, pane);
  } catch (error) {
    if (request !== ticket[pane]) return;
    grid.innerHTML = errorBox('Couldn’t read these rows', error);
    pager.replaceChildren();
  } finally {
    if (request === ticket[pane]) grid.setAttribute('aria-busy', 'false');
  }
}
async function refreshProfile() {
  const field = profileField;
  const source = active;
  const request = ++ticket.profile;
  const area = $('profile-values');
  if (!area) return;
  area.innerHTML = '<div class="grid-loading">Profiling column…</div>';
  const key = JSON.stringify([source.name, field]);
  try {
    if (!profileCache.has(key)) profileCache.set(key, await profileColumn(source, field));
    if (request === ticket.profile) area.innerHTML = profileMarkup(source, field, profileCache.get(key));
  } catch (error) {
    if (request === ticket.profile) area.innerHTML = errorBox('Couldn’t profile this column', error);
  }
}
function drawFilter() {
  const filter = settings.source.filter;
  $('filter-strip').hidden = !filter;
  if (filter) {
    const label =
      filter.field +
      ' ' +
      filterRules[filter.rule] +
      (['null', 'present'].includes(filter.rule) ? '' : ' ' + filter.value);
    $('filter-strip').innerHTML =
      '<button data-act="clear-filter" class="filter-chip" aria-label="Clear filter: ' +
      escape(label) +
      '">' +
      escape(label) +
      icon('x') +
      '</button>';
  }
}
function showFilter() {
  if (!active) return;
  const filter = settings.source.filter || {
    field: active.columns[0].name,
    rule: 'contains',
    value: ''
  };
  const fields = active.columns.map((c) => option(c.name, c.name, filter.field)).join('');
  const rules = Object.entries(filterRules)
    .map(([value, label]) => option(value, label[0].toUpperCase() + label.slice(1), filter.rule))
    .join('');
  showDialog(
    'Filter rows',
    '<form id="filter-form"><div class="dialog-form"><label>Column<select id="filter-field">' +
      fields +
      '</select></label><label>Condition<select id="filter-rule">' +
      rules +
      '</select></label><label id="filter-value-label">Value<input id="filter-value" value="' +
      escape(filter.value) +
      '" autocomplete="off"></label></div><div class="button-row"><button type="button" class="button subtle" data-act="close-dialog">Cancel</button><button class="button primary" type="submit">Apply filter</button></div></form>'
  );
  updateFilterField();
}
function updateFilterField() {
  const needsValue = !['null', 'present'].includes($('filter-rule').value);
  $('filter-value-label').hidden = !needsValue;
  $('filter-value').required = needsValue;
}
function showImport() {
  showDialog(
    'Import local files',
    '<p>Open one or more files as SQL tables. A DuckDB database opens each of its stored tables read-only.</p><button class="dialog-drop" data-act="browse">' +
      icon('folder-in') +
      '<strong>Choose files or drop them here</strong><small>DuckDB, Parquet, CSV, TSV, JSON, JSONL, NDJSON</small></button><span class="dialog-note">' +
      icon('shield') +
      'File contents stay in this browser tab.</span>'
  );
}
function enqueueFiles(list) {
  const files = [...list];
  if (!files.length) return;
  importQueue = importQueue
    .then(() => addFiles(files))
    .catch((error) => {
      showDialog('Import failed', errorBox('Couldn’t import files', error));
    });
}
async function addFiles(files) {
  closeDialog();
  toast('Opening ' + (files.length === 1 ? files[0].name : files.length + ' files') + '…');
  await initialization;
  if (!engineVersion) {
    showDialog(
      'Database unavailable',
      '<p>The engine could not start. Reload the workspace to try again.</p><div class="button-row"><button class="button primary" data-act="reload">Reload workspace</button></div>'
    );
    return;
  }
  const added = [];
  const errors = [];
  let openedFiles = 0;
  for (const file of files) {
    try {
      const tables = /\.duckdb$/i.test(file.name)
        ? await importDatabase(file)
        : [await importFile(file)];
      sources.push(...tables);
      added.push(...tables);
      openedFiles++;
    } catch (error) {
      errors.push([file.name, errorText(error)]);
    }
  }
  if (added.length) {
    selectDataset(added[0]);
    toast('Opened ' + (added.length === 1 ? added[0].filename : added.length + ' tables') + '.');
  }
  if (errors.length) {
    $('toast').hidden = true;
    const items = errors
      .map(([name, why]) => '<li><strong>' + escape(name) + '</strong> — ' + escape(why) + '</li>')
      .join('');
    showDialog(
      'Import details',
      '<p>' +
        openedFiles +
        ' of ' +
        files.length +
        ' files opened.</p><ul class="import-log">' +
        items +
        '</ul><div class="button-row"><button class="button subtle" data-act="import">Choose more files</button><button class="button primary" data-act="close-dialog">Done</button></div>'
    );
  }
}
function openInSQL() {
  if (!active) return;
  setEditor(explorerSQL(active, settings.source));
  setView('sql');
  editor.focus();
}
function setEditor(sql) {
  previousDraft = '';
  $('restore-sql').hidden = true;
  editor.value = sql;
  updateLines();
  $('run-query').disabled = running || !engineVersion || !sql.trim();
}

export function getSQLContext() {
  return { sources, active, version: engineVersion || '2.0.1' };
}

export function reviewSQLDraft(sql) {
  const original = editor.value;
  setEditor(sql);
  if (original.trim() && original !== sql) {
    previousDraft = original;
    $('restore-sql').hidden = false;
  }
  setView('sql');
  editor.focus();
}
function updateLines() {
  const n = editor.value.split('\n').length;
  $('line-numbers').textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
  $('line-numbers').scrollTop = editor.scrollTop;
}
function showTables() {
  const buttons = sources
    .map(
      (source, i) =>
        '<button class="table-choice" data-insert="' +
        i +
        '">' +
        icon(fileIcon(source.kind)) +
        '<code>' +
        escape(source.name) +
        '</code><small>' +
        formatNumber(source.count) +
        ' rows</small></button>'
    )
    .join('');
  showDialog('Workspace tables', '<p>Select a table to insert its name at the cursor.</p>' + buttons);
}
async function execute() {
  const sql = editor.value.trim();
  if (!sql || running || !engineVersion) return;
  running = true;
  $('run-query').disabled = true;
  $('run-label').textContent = 'Running…';
  const before = performance.now();
  const entry = { sql, at: new Date(), ok: false };
  $('result-grid').setAttribute('aria-busy', 'true');
  const old = result;
  ++ticket.result;
  $('result-grid').innerHTML = '<div class="grid-loading">Running query…</div>';
  $('result-pager').replaceChildren();
  $('result-timing').textContent = '';
  $('export-result').hidden = true;
  try {
    const next = await runSQL(sql);
    result = next;
    settings.result = blankSettings();
    entry.duration = Math.max(1, Math.round(performance.now() - before));
    entry.rows = next.count;
    entry.ok = true;
    $('result-timing').textContent = entry.duration.toLocaleString() + ' ms';
    $('export-result').hidden = false;
    await refreshGrid('result');
  } catch (error) {
    result = null;
    entry.duration = Math.max(1, Math.round(performance.now() - before));
    entry.error = errorText(error);
    $('result-grid').innerHTML = errorBox('Query failed', error);
  } finally {
    if (old) await releaseResult(old).catch(() => {});
    log.unshift(entry);
    if (view === 'history') drawHistory();
    running = false;
    $('result-grid').setAttribute('aria-busy', 'false');
    $('run-query').disabled = !editor.value.trim();
    $('run-label').textContent = 'Run query';
  }
}
function drawHistory() {
  const header =
    '<div class="card-header"><h2>' +
    icon('history') +
    'This session</h2><span class="muted">' +
    formatNumber(log.length) +
    (log.length === 1 ? ' query' : ' queries') +
    '</span></div>';
  if (!log.length) {
    $('history-view').innerHTML =
      header +
      emptyState(
        'history',
        'No queries yet',
        'Run a query in the SQL console to see it here.',
        '<button class="button subtle" data-nav="sql">Open SQL console</button>'
      );
    return;
  }
  const items = log
    .map((item, i) => {
      const details =
        item.at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) +
        ' · ' +
        item.duration.toLocaleString() +
        ' ms · ' +
        (item.ok ? formatNumber(item.rows) + ' rows' : 'Query failed');
      return (
        '<li class="history-item"><span class="history-flag' +
        (item.ok ? '' : ' error') +
        '">' +
        icon(item.ok ? 'check' : 'alert') +
        '</span><div class="history-text"><code>' +
        escape(item.sql) +
        '</code><div class="history-meta">' +
        escape(details) +
        '</div></div><button class="button subtle" data-restore="' +
        i +
        '">Open in SQL</button></li>'
      );
    })
    .join('');
  $('history-view').innerHTML = header + '<ol class="history-list">' + items + '</ol>';
}
async function download(pane, button) {
  const source = pane === 'source' ? active : result;
  if (!source) return;
  button.disabled = true;
  try {
    const blob = await exportCSV(source, { ...settings[pane] });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = (pane === 'source' ? source.name : 'query-results') + '.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 30000);
    toast('CSV export ready.');
  } catch (error) {
    showDialog('Export failed', errorBox('Couldn’t export these rows', error));
  } finally {
    button.disabled = false;
  }
}
function showHelp() {
  const keys = [
    ['Import files', commandKey + ' O'],
    ['Search rows', '/'],
    ['Run query', commandKey + ' Enter'],
    ['Workspace help', '?']
  ];
  showDialog(
    'Workspace help',
    '<p>Import local files, inspect their columns, or join tables in the SQL console. Each tab has its own session. Reopen your files after a refresh.</p><div class="help-list">' +
      keys.map(([a, b]) => '<div><span>' + a + '</span><kbd>' + b + '</kbd></div>').join('') +
      '</div><p class="help-detail">The three sample datasets contain synthetic flight records. Mallard runs DuckDB ' +
      escape(engineVersion || '2.0.1') +
      ' in your browser with Wasm client ' +
      escape(CLIENT_VERSION) +
      '.</p><div class="credits-links"><a href="./vendor/versions.txt" target="_blank" rel="noopener">Runtime details</a><a href="./assets/artwork.txt" target="_blank" rel="noopener">Illustration credits</a></div>'
  );
}

document.addEventListener('click', (event) => {
  const btn = event.target.closest('button');
  if (!btn || btn.disabled) return;
  if (btn.hasAttribute('data-source')) {
    selectDataset(sources[Number(btn.dataset.source)]);
    return;
  }
  if (btn.hasAttribute('data-nav')) {
    setView(btn.dataset.nav);
    return;
  }
  if (btn.hasAttribute('data-tab')) {
    selectTab(btn.dataset.tab);
    return;
  }
  if (btn.hasAttribute('data-restore')) {
    setEditor(log[Number(btn.dataset.restore)].sql);
    setView('sql');
    editor.focus();
    return;
  }
  if (btn.hasAttribute('data-insert')) {
    editor.setRangeText(
      identifier(sources[Number(btn.dataset.insert)].name),
      editor.selectionStart,
      editor.selectionEnd,
      'end'
    );
    closeDialog();
    editor.focus();
    updateLines();
    $('run-query').disabled = running || !engineVersion;
    return;
  }
  const act = btn.dataset.act;
  const pane = btn.dataset.pane;
  if (act === 'toggle-menu') toggleMenu();
  else if (act === 'import') showImport();
  else if (act === 'browse') $('file-input').click();
  else if (act === 'filter') showFilter();
  else if (act === 'clear-filter') {
    settings.source.filter = null;
    settings.source.page = 0;
    drawFilter();
    refreshGrid('source');
  } else if (act === 'open-sql') openInSQL();
  else if (act === 'restore-sql') {
    setEditor(previousDraft);
    editor.focus();
  } else if (act === 'run') execute();
  else if (act === 'tables') showTables();
  else if (act === 'close-dialog') closeDialog();
  else if (act === 'help') showHelp();
  else if (act === 'reload') location.reload();
  else if (act === 'export-source' || act === 'export-result') download(act.slice(7), btn);
  else if (act === 'page') {
    settings[pane].page = Math.max(0, settings[pane].page + Number(btn.dataset.dir));
    refreshGrid(pane);
  } else if (act === 'sort') {
    const field = (pane === 'source' ? active : result).columns[Number(btn.dataset.col)].name;
    const previous = settings[pane].sort;
    settings[pane].sort =
      previous?.field !== field
        ? { field, direction: 'asc' }
        : previous.direction === 'asc'
          ? { field, direction: 'desc' }
          : null;
    settings[pane].page = 0;
    refreshGrid(pane);
  }
});
document.addEventListener('change', (event) => {
  const input = event.target;
  if (input.id === 'file-input') {
    enqueueFiles(input.files);
    input.value = '';
  }
  if (input.id === 'profile-field') {
    profileField = input.value;
    refreshProfile();
  }
  if (input.id === 'filter-rule') updateFilterField();
  if (input.hasAttribute('data-size')) {
    const pane = input.dataset.size;
    settings[pane].size = Number(input.value);
    settings[pane].page = 0;
    refreshGrid(pane);
  }
});
document.addEventListener('submit', (event) => {
  if (event.target.id !== 'filter-form') return;
  event.preventDefault();
  settings.source.filter = {
    field: $('filter-field').value,
    rule: $('filter-rule').value,
    value: $('filter-value').value
  };
  settings.source.page = 0;
  closeDialog();
  drawFilter();
  refreshGrid('source');
});
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) closeDialog();
});
$('row-search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  settings.source.search = $('row-search').value;
  settings.source.page = 0;
  searchTimer = setTimeout(() => refreshGrid('source'), 150);
});
editor.addEventListener('input', () => {
  previousDraft = '';
  $('restore-sql').hidden = true;
  updateLines();
  $('run-query').disabled = running || !engineVersion || !editor.value.trim();
});
editor.addEventListener('scroll', () => {
  $('line-numbers').scrollTop = editor.scrollTop;
});
document.addEventListener('keydown', (event) => {
  if (event.isComposing || document.querySelector('dialog[open]')) return;
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && view === 'sql') {
    event.preventDefault();
    execute();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    $('file-input').click();
    return;
  }
  if (event.key === 'Escape' && document.body.classList.contains('menu-open')) {
    closeMenu();
    document.querySelector('.panel-toggle').focus();
    return;
  }
  if (
    event.target.closest('input,select,textarea,[contenteditable]') ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  )
    return;
  if (
    event.target.closest('[role="tab"]') &&
    ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
  ) {
    event.preventDefault();
    const list = ['preview', 'schema', 'profile'];
    const next =
      event.key === 'Home'
        ? list[0]
        : event.key === 'End'
          ? list[2]
          : list[(list.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
    selectTab(next);
    $('tab-' + next).focus();
    return;
  }
  if (event.key === '/' && view === 'explorer' && active) {
    event.preventDefault();
    selectTab('preview');
    $('row-search').focus();
  }
  if (event.key === '?') {
    event.preventDefault();
    showHelp();
  }
});
let dragDepth = 0;
const fileDrag = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (event) => {
  if (fileDrag(event)) {
    event.preventDefault();
    dragDepth++;
    $('drag-overlay').hidden = false;
  }
});
window.addEventListener('dragover', (event) => {
  if (fileDrag(event)) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }
});
window.addEventListener('dragleave', (event) => {
  if (fileDrag(event)) {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $('drag-overlay').hidden = true;
  }
});
window.addEventListener('drop', (event) => {
  if (!fileDrag(event)) return;
  event.preventDefault();
  dragDepth = 0;
  $('drag-overlay').hidden = true;
  enqueueFiles(event.dataTransfer.files);
});

async function initialize() {
  try {
    engineVersion = await startEngine();
    $('engine-version').textContent = engineVersion + ' · Connected';
    $('engine-light').className = 'status-dot';
    $('engine-light').title = 'Engine connected';
    const downloads = await Promise.allSettled(
      samples.map(async ([filename, title]) => {
        const response = await fetch(new URL('./samples/' + filename, import.meta.url));
        if (!response.ok) throw new Error('Couldn’t read ' + filename);
        return [new File([await response.blob()], filename), title];
      })
    );
    const failures = [];
    for (const [i, item] of downloads.entries()) {
      try {
        if (item.status === 'rejected') throw item.reason;
        sources.push(await importFile(...item.value));
      } catch (error) {
        failures.push(samples[i][0] + ': ' + errorText(error));
      }
    }
    if (sources.length) selectDataset(sources[0], false);
    else {
      $('startup').innerHTML = emptyState(
        'folder-in',
        'Open a dataset',
        'Choose a local file to start exploring.',
        '<button class="button primary" data-act="import">Import files</button>'
      );
      drawSources();
      setView(view);
    }
    if (failures.length) {
      console.error('Sample files:', failures);
      toast('Some sample files could not be opened.');
    }
    $('run-query').disabled = !editor.value.trim();
  } catch (error) {
    $('engine-light').className = 'status-dot failed';
    $('engine-light').title = 'Engine unavailable';
    $('engine-version').textContent = 'Unavailable';
    $('startup').innerHTML =
      errorBox('Couldn’t start DuckDB', error) +
      '<div class="button-row"><button class="button subtle" data-act="reload">Try again</button></div>';
    drawSources();
  }
}
export const initialization = initialize();
