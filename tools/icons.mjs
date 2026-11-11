// The SVG is the editable source of truth. Rasterization is deterministic and local.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(resolve(root, 'assets/icon.svg'), 'utf8');
await mkdir(resolve(root, 'assets'), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  await writeFile(resolve(root, `assets/icon-${size}.png`), png);
}
console.log('Generated original icons: 16, 32, 48, 128 px');
