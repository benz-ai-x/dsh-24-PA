import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const model = (await readFile(new URL('prototypes/24pa-dsh/model.js', root), 'utf8')).replace(/^export /gm, '');
const shell = await readFile(new URL('prototypes/24pa-dsh/demo-shell.html', root), 'utf8');
await writeFile(new URL('prototypes/24pa-dsh/demo.html', root), shell.replace('/* INLINE_PORTABLE_MODEL */', model));
console.log('离线演练已生成：prototypes/24pa-dsh/demo.html（可双击打开）');
