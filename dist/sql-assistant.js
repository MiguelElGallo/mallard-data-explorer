import { escape, formatNumber } from './view.js';
import { getSQLContext, reviewSQLDraft } from './app.js';

const providers = {
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  copilot: { name: 'Copilot', url: 'https://github.com/copilot' }
};
const $ = (id) => document.getElementById(id);

function buildPrompt(question, tables, version) {
  const definitions = tables.map((table) => ({
    table: table.name,
    columns: Object.fromEntries(table.columns.map(({ name, type }) => [name, type]))
  }));
  return [
    'Write a single read-only DuckDB SQL query for Mallard, a browser workspace running DuckDB ' +
      version +
      '.',
    'Use the supplied local tables and their exact identifiers. Quote identifiers when needed. If the requested result needs information missing from the schema, ask me to clarify. Return the query in one SQL code block.',
    'My question\n' + question.trim(),
    'Available table definitions (JSON)\n' + JSON.stringify(definitions, null, 2)
  ].join('\n\n');
}

function sqlFromReply(reply) {
  const input = reply.replace(/\r\n?/g, '\n').trim();
  const fences = [...input.matchAll(/^[ \t]*`{3,}|^[ \t]*~{3,}/gm)];
  if (fences.length === 0) return input;
  const block = /^[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/m.exec(input);
  if (!block || fences.length !== 2)
    throw new Error('Paste one complete code block, or copy just the SQL you want to use.');
  return block[2].trim();
}

// Copy during the click so opening a new window cannot consume clipboard activation.
async function copyText(text) {
  let wroteText = false;
  function write(event) {
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    wroteText = true;
  }
  document.addEventListener('copy', write);
  try {
    if (document.execCommand('copy') && wroteText) return true;
  } catch {
    /* Use the Clipboard API when the browser disables the legacy copy command. */
  } finally {
    document.removeEventListener('copy', write);
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function installSQLAssistant() {
  const dialog = $('sql-assistant');
  const provider = providers[dialog.dataset.assistantProvider];
  const trigger = $('ask-assistant');
  for (const label of document.querySelectorAll('[data-chat-name]')) {
    label.textContent = provider.name;
  }
  $('assistant-chat-link').href = provider.url;
  const question = $('assistant-question');
  const answer = $('assistant-answer');
  const choices = $('schema-choices');
  const error = $('assistant-error');
  let selected = new Set();
  let lastPrompt = '';
  let fresh = true;
  let step = 'compose';
  let copyAttempt = 0;

  function showStep(next, focus = true) {
    step = next;
    const composing = next === 'compose';
    $('assistant-compose').hidden = !composing;
    $('assistant-return').hidden = composing;
    $('choose-compose').setAttribute('aria-pressed', String(composing));
    $('choose-reply').setAttribute('aria-pressed', String(!composing));
    if (focus) (composing ? question : answer).focus({ preventScroll: true });
  }
  function selectedTables() {
    return getSQLContext().sources.filter((source) => selected.has(source.name));
  }
  function updatePreview() {
    const tables = selectedTables();
    $('scope-count').textContent = tables.length + ' selected';
    $('prepared-prompt').value = buildPrompt(question.value, tables, getSQLContext().version);
    $('launch-assistant').disabled = !question.value.trim();
  }
  function renderTables(sources) {
    choices.innerHTML =
      sources
        .map(
          (source) =>
            '<label class="assistant-table"><input type="checkbox" value="' +
            escape(source.name) +
            '"' +
            (selected.has(source.name) ? ' checked' : '') +
            '><code>' +
            escape(source.name) +
            '</code><small>' +
            formatNumber(source.columns.length) +
            ' columns</small></label>'
        )
        .join('') || '<p>Import a file to include its table definition.</p>';
  }
  function showAssistant() {
    const { sources, active } = getSQLContext();
    if (fresh && active) selected = new Set([active.name]);
    renderTables(sources);
    updatePreview();
    dialog.showModal();
    showStep(step);
  }
  function setCopyResult(copied) {
    const fallback = $('manual-copy');
    fallback.value = lastPrompt;
    fallback.hidden = copied;
    $('handoff-message').textContent = copied
      ? `Prompt copied. Paste it into ${provider.name}, send it, and bring the SQL back here.`
      : `Select and copy the prompt below, then paste it into ${provider.name}.`;
    if (!copied && dialog.open && step === 'reply') {
      fallback.focus();
      fallback.select();
    }
  }
  async function copyForHandoff(openChat) {
    const attempt = ++copyAttempt;
    const copied = copyText(lastPrompt);
    if (openChat) {
      // Keep the destination fixed. The prompt travels through the visitor's clipboard.
      try {
        window.open(provider.url, '_blank', 'popup=yes,width=980,height=800,noopener,noreferrer');
      } catch {
        // The return panel includes a link for browsers that block popups.
      }
    }
    $('assistant-handoff').hidden = false;
    $('handoff-message').textContent = 'Preparing your prompt…';
    showStep('reply');
    const ok = await copied;
    if (attempt === copyAttempt) setCopyResult(ok);
  }
  trigger.addEventListener('click', showAssistant);
  trigger.hidden = false;
  $('assistant-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  $('choose-compose').addEventListener('click', () => showStep('compose'));
  $('choose-reply').addEventListener('click', () => showStep('reply'));
  choices.addEventListener('change', (event) => {
    const box = event.target;
    if (box.checked) selected.add(box.value);
    else selected.delete(box.value);
    fresh = false;
    updatePreview();
  });
  question.addEventListener('input', () => {
    fresh = false;
    updatePreview();
  });
  $('assistant-compose').addEventListener('click', (event) => {
    const idea = event.target.closest('[data-idea]')?.dataset.idea;
    if (!idea) return;
    const tables = selectedTables();
    const isFlights = tables.length === 1 && tables[0].sample && tables[0].name === 'flights';
    const request = {
      summary: isFlights
        ? 'Rank airlines by average delay in minutes and include their flight counts.'
        : 'Summarize the selected data with row counts and useful aggregates for its numeric columns.',
      duplicates: 'Find duplicate records in the selected data and show how many times each occurs.',
      missing: 'For each column in the selected data, show the number and percentage of missing values.'
    }[idea];
    question.value = request;
    fresh = false;
    updatePreview();
    question.focus();
  });
  $('assistant-compose').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!question.value.trim()) return;
    fresh = false;
    lastPrompt = buildPrompt(question.value, selectedTables(), getSQLContext().version);
    copyForHandoff(true);
  });
  $('copy-prepared').addEventListener('click', () => copyForHandoff(false));
  answer.addEventListener('input', () => {
    fresh = false;
    error.hidden = true;
    $('use-assistant-sql').disabled = !answer.value.trim();
  });
  $('use-assistant-sql').disabled = true;
  $('assistant-return').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const sql = sqlFromReply(answer.value);
      if (!sql) throw new Error('Paste a SQL query to continue.');
      dialog.close();
      reviewSQLDraft(sql);
      fresh = true;
      selected.clear();
      lastPrompt = '';
      copyAttempt++;
      question.value = '';
      answer.value = '';
      $('assistant-handoff').hidden = true;
      $('manual-copy').value = '';
      $('assistant-scope').open = false;
      $('assistant-preview').open = false;
      $('use-assistant-sql').disabled = true;
      error.hidden = true;
      showStep('compose', false);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      answer.focus();
    }
  });
}

installSQLAssistant();
