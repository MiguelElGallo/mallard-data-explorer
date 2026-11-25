import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'dist');
const output = join(root, 'build', 'pages');
const sourceHTML = await readFile(join(source, 'index.html'), 'utf8');
const assistantBlocks = /^[ \t]*<!-- assistant-only -->[\s\S]*?<!-- \/assistant-only -->\r?\n/gm;
const html = sourceHTML.replace(assistantBlocks, '');

if (html === sourceHTML || /assistant-only|id="(?:ask-chatgpt|sql-assistant)"|sql-assistant\.(?:css|js)|https:\/\/chatgpt\.com\//.test(html)) {
  throw new Error('Check the optional assistant sections in dist/index.html.');
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, {
  recursive: true,
  filter(file) {
    const parts = relative(source, file).split(sep);
    return !parts.some(part => part.startsWith('.')) &&
      !['index.html', 'sql-assistant.css', 'sql-assistant.js'].includes(parts.at(-1));
  }
});
await writeFile(join(output, 'index.html'), html);
await writeFile(join(output, '.nojekyll'), '');
console.log('Built the standalone data explorer in build/pages/.');
