import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'dist');
const output = join(root, 'build', 'pages');
const sourceHTML = await readFile(join(source, 'index.html'), 'utf8');
const sitesOnly = /^[ \t]*<!-- sites-only -->[\s\S]*?<!-- \/sites-only -->\r?\n/gm;
const linkTemplate = /<template id="pages-copilot-link">([\s\S]*?)<\/template>/;
const pagesHTML = sourceHTML.replace(sitesOnly, '');

if (!linkTemplate.test(pagesHTML)) {
  throw new Error('Missing Pages sign-in link in dist/index.html.');
}
const html = pagesHTML.replace(linkTemplate, '$1');
if (html.includes('sites-only') || html.includes('sql-assistant')) {
  throw new Error('The Pages build contains part of the Sites assistant.');
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, {
  recursive: true,
  filter(file) {
    const parts = relative(source, file).split(sep);
    return !parts.some(part => part.startsWith('.')) &&
      !['index.html', 'sql-assistant.js', 'sql-assistant.css'].includes(parts.at(-1));
  }
});
await writeFile(join(output, 'index.html'), html);
await writeFile(join(output, '.nojekyll'), '');
console.log('Built the standalone data explorer in build/pages/.');
