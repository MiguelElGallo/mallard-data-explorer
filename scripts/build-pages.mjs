import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'dist');
const output = join(root, 'build', 'pages');
const sourceHTML = await readFile(join(source, 'index.html'), 'utf8');
const html = sourceHTML.replace('data-assistant-provider="chatgpt"', 'data-assistant-provider="copilot"');

if (html === sourceHTML) {
  throw new Error('Missing SQL assistant provider setting in dist/index.html.');
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, {
  recursive: true,
  filter(file) {
    const parts = relative(source, file).split(sep);
    return !parts.some(part => part.startsWith('.')) && parts.at(-1) !== 'index.html';
  }
});
await writeFile(join(output, 'index.html'), html);
await writeFile(join(output, '.nojekyll'), '');
console.log('Built the standalone data explorer in build/pages/.');
