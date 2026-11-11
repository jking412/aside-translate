import { build } from 'esbuild';
import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import './icons.mjs';
const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
if (dist !== resolve(root, 'dist')) throw new Error('Invalid output path');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
const entries = ['background/index', 'content/index', 'content/youtube-main', 'popup/index'];
for (const entry of entries) {
  await build({ entryPoints: [join(root, 'src', entry + '.js')], outfile: join(dist, entry + '.js'),
    bundle: true, format: /^(background|popup)/.test(entry) ? 'esm' : 'iife', target: 'chrome120',
    legalComments: 'none', charset: 'utf8', minify: false });
}
for (const name of ['index.html', 'style.css']) await cp(join(root, 'src/popup', name), join(dist, 'popup', name));
await mkdir(join(dist, 'assets'), { recursive: true });
for (const n of [16,32,48,128]) await cp(join(root, 'assets', `icon-${n}.png`), join(dist, 'assets', `icon-${n}.png`));
for (const file of ['manifest.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md']) await cp(join(root, file), join(dist, file));
const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
await writeFile(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Built ${manifest.name} ${manifest.version} → dist/`);
