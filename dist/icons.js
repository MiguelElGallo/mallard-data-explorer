const paths = {
  'git-branch':
    '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 7v10m0-4h3c5 0 9-1 9-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.6 5.4L8 16l2.6-5.4L16 8Z"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  history: '<path d="M3 10a9 9 0 1 1 2.4 7.8M3 5v5h5m4-3v5l3.3 2"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14.5h18M9 9v11"/>',
  rows: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.3h18M3 14.7h18"/>',
  columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m6-16v16"/>',
  drive:
    '<path d="m5.5 4.5-2.3 9.1v4.2A2.2 2.2 0 0 0 5.4 20h13.2a2.2 2.2 0 0 0 2.2-2.2v-4.2l-2.3-9.1zM3.4 13.2h17.2M7 16.7h.1m3.2 0h.1"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  'folder-in':
    '<path d="M3 8V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z"/><path d="M12 17v-6m-2.5 2.5L12 11l2.5 2.5"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.4 2.4 0 0 1 4.7.6c0 1.6-2.4 2-2.4 3.7m0 3h.02"/>',
  sparkles:
    '<path d="m10 4 1.9 5.5L17 12l-5.1 2.4L10 20l-2-5.6L3 12l5-2.5L10 4Zm8-2 .9 2.6L21.5 6l-2.6 1.2L18 10l-1-2.8L14.5 6 17 4.6 18 2Z"/>',
  'chevron-right': '<path d="m9 5 7 7-7 7"/>',
  'chevron-left': '<path d="m15 5-7 7 7 7"/>',
  code: '<path d="m8 8-4 4 4 4m8-8 4 4-4 4m-3-12-2 16"/>',
  'arrow-up-right': '<path d="M7 17 17 7M7 7h10v10"/>',
  search: '<circle cx="10.6" cy="10.6" r="6.6"/><path d="m16 16 4.5 4.5"/>',
  filter:
    '<path d="M3 6h10m4 0h4M3 12h3m4 0h11M3 18h8m4 0h6"/><circle cx="15" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="13" cy="18" r="2"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  schema:
    '<rect x="3" y="3" width="6" height="5" rx="1"/><rect x="15" y="10" width="6" height="4.5" rx="1"/><rect x="15" y="17" width="6" height="4.5" rx="1"/><path d="M6 8v10a1 1 0 0 0 1 1h8M6 12h9"/>',
  chart: '<path d="M4 4v16h16M8 16v-4m5 4V7m5 9v-6"/>',
  database:
    '<ellipse cx="12" cy="5.5" rx="8" ry="3.5"/><path d="M4 5.5v12c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5v-12M4 11.5c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5"/>',
  layers: '<path d="m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5m-18 5 9 5 9-5"/>',
  braces:
    '<path d="M9 4H7a2 2 0 0 0-2 2v3c0 2-1 3-3 3 2 0 3 1 3 3v3a2 2 0 0 0 2 2h2m6-16h2a2 2 0 0 1 2 2v3c0 2 1 3 3 3-2 0-3 1-3 3v3a2 2 0 0 1-2 2h-2"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v5h4m-9 5h6m-6 4h6"/>',
  sort: '<path d="m8 9 4-4 4 4m-8 6 4 4 4-4"/>',
  up: '<path d="M12 19V5m-5 5 5-5 5 5"/>',
  down: '<path d="M12 5v14m-5-5 5 5 5-5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  play: '<path d="m7 4 12 8-12 8z" fill="currentColor" stroke-width="1"/>',
  shield: '<path d="m12 3 8 3v5c0 5-3 8-8 11-5-3-8-6-8-11V6l8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  check: '<path d="m4.5 12 5 5 10-11"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3h.02"/>',
  refresh: '<path d="M3 6v5h5M3.5 11a8.5 8.5 0 1 1 2.2 7"/>'
};
export function icon(name) {
  return '<svg class="ico" aria-hidden="true" viewBox="0 0 24 24">' + (paths[name] || '') + '</svg>';
}
export function fillIcons(root = document) {
  for (const node of root.querySelectorAll('i[data-icon]')) {
    const replacement = document.createElement('template');
    replacement.innerHTML = icon(node.dataset.icon);
    const svg = replacement.content.firstElementChild;
    if (node.className) svg.classList.add(...node.classList);
    node.replaceWith(svg);
  }
}
