import { getSQLContext, initialization, reviewSQLDraft } from '../app.js';

const $ = id => document.getElementById(id);
const dialog = $('sql-assistant');
const question = $('cloud-question');
let login = null;
let busy = false;
let sessionCheck = 0;
let selected = null;

function updateSubmit() {
  $('cloud-generate').disabled = busy || !login || !question.value.trim();
  $('cloud-signout').disabled = busy;
}

async function refreshSession() {
  const check = ++sessionCheck;
  try {
    const response = await fetch('./api/session', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const session = await response.json();
    if (check !== sessionCheck) return;
    login = session.login;
    $('cloud-account').textContent = login ? `Signed in as ${login}` : session.available
      ? 'Sign in with your own GitHub account to draft SQL here.' : 'GitHub sign-in is awaiting configuration.';
    $('cloud-signin').hidden = !!login || !session.available;
  } catch {
    if (check !== sessionCheck) return;
    login = null;
    $('cloud-signin').hidden = true;
    $('cloud-account').textContent = 'Could not connect to the assistant. Reopen this window to retry.';
  }
  $('cloud-signout').hidden = !login;
  $('cloud-generate').hidden = !login;
  updateSubmit();
}

function updateCount() {
  $('cloud-count').textContent = `${selected.size} selected`;
}

function renderTables() {
  const { sources, active } = getSQLContext();
  if (!sources.length) {
    $('cloud-tables').textContent = 'Import a file to include its table schema.';
    $('cloud-count').textContent = '0 selected';
    return;
  }
  if (!selected) selected = new Set(active ? [active.name] : []);
  const existing = new Set(sources.map(source => source.name));
  selected = new Set([...selected].filter(name => existing.has(name)));
  const fieldset = $('cloud-tables');
  fieldset.replaceChildren();
  for (const table of sources) {
    const label = document.createElement('label');
    label.className = 'assistant-table';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selected.has(table.name);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(table.name);
      else selected.delete(table.name);
      updateCount();
    });
    const name = document.createElement('code');
    name.textContent = table.name;
    const size = document.createElement('small');
    size.textContent = `${table.columns.length} columns`;
    label.append(checkbox, name, size);
    fieldset.append(label);
  }
  updateCount();
}

function openAssistant() {
  renderTables();
  if (!dialog.open) dialog.showModal();
  refreshSession();
  question.focus();
}

$('cloud-assistant').addEventListener('click', openAssistant);
$('cloud-close').addEventListener('click', () => dialog.close());
question.addEventListener('input', updateSubmit);
$('cloud-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !login || !question.value.trim()) return;
  const tables = getSQLContext().sources.filter(table => selected?.has(table.name)).map(table => ({
    name: table.name, columns: table.columns.map(({ name, type }) => ({ name, type }))
  }));
  busy = true;
  updateSubmit();
  $('cloud-result').hidden = true;
  $('cloud-status').textContent = 'Copilot is drafting…';
  try {
    const response = await fetch('./api/draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question.value.trim(), tables })
    });
    const reply = await response.json().catch(() => ({}));
    if (response.status === 401) await refreshSession();
    if (!response.ok) throw new Error(reply.detail || 'The assistant is unavailable. Try again shortly.');
    const isSQL = reply.kind === 'sql';
    $('cloud-result-heading').textContent = isSQL ? 'SQL draft' : 'Copilot has a question';
    $('cloud-clarification').hidden = isSQL;
    $('cloud-clarification').textContent = isSQL ? '' : reply.text;
    $('cloud-sql').hidden = !isSQL;
    $('cloud-sql').value = isSQL ? reply.text : '';
    $('cloud-use').hidden = !isSQL;
    $('cloud-result').hidden = false;
    $('cloud-status').textContent = '';
    if (isSQL) $('cloud-use').focus();
    else question.focus();
  } catch (error) {
    $('cloud-status').textContent = error.message || 'Could not reach Copilot. Try again.';
  } finally {
    busy = false;
    updateSubmit();
  }
});
$('cloud-use').addEventListener('click', () => {
  const draft = $('cloud-sql').value;
  if (draft) {
    dialog.close();
    reviewSQLDraft(draft);
  }
});
$('cloud-signout').addEventListener('click', async () => {
  try {
    const response = await fetch('./api/logout', { method: 'POST' });
    if (!response.ok) throw new Error();
    $('cloud-result').hidden = true;
    $('cloud-sql').value = '';
    $('cloud-status').textContent = '';
    await refreshSession();
  } catch {
    $('cloud-status').textContent = 'Could not sign out. Try again.';
  }
});
window.addEventListener('focus', () => { if (dialog.open) refreshSession(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && dialog.open) refreshSession(); });
if ('BroadcastChannel' in window) new BroadcastChannel('mallard-login').onmessage = refreshSession;
if (new URLSearchParams(location.search).has('assistant')) openAssistant();

initialization.then(() => { if (dialog.open) renderTables(); });
