import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..');
async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(name)); else files.push(name);
  }
  return files;
}
for (const dir of ['src', 'tools', 'tests']) for (const file of await walk(join(root,dir))) {
  if (!/\.[mc]?js$/.test(file)) continue;
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${file}\n${result.stderr}`);
}
const manifest = JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
assert.equal(manifest.manifest_version,3);
assert.deepEqual(manifest.permissions, ['storage','activeTab','scripting']);
assert.deepEqual(manifest.host_permissions, ['https://translate.googleapis.com/*']);
assert.ok(!JSON.stringify(manifest).includes('web_accessible_resources'));
for (const n of [16,32,48,128]) {
  const png = await readFile(join(root,manifest.icons[n]));
  assert.equal(png.subarray(1,4).toString(),'PNG');
  assert.equal(png.readUInt32BE(16),n);
  assert.equal(png.readUInt32BE(20),n);
}
console.log('Syntax, minimal permissions and PNG dimensions passed.');
