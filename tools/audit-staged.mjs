import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const cwd = new URL('../', import.meta.url);
const run = args => execFileSync('git', args, { cwd, encoding: 'utf8' });
const names = run(['diff','--cached','--name-only','-z']).split('\0').filter(Boolean);
assert.ok(names.length,'Nothing staged to audit');
const denied = /(^|\/)(node_modules|dist|release|output|\.env(?:\..*)?|[^/]*(?:profile|user-data)[^/]*)(\/|$)|\.(?:pem|key|p12|pfx)$/i;
const secrets = [ /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\b(?:gh[pousr]_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{30,}|sk-[a-zA-Z0-9_-]{24,})\b/ ];
for(const name of names) {
  assert.ok(!denied.test(name),`Unexpected generated/private path: ${name}`);
  if(/\.png$/.test(name)) continue;
  const value = run(['show',`:${name}`]);
  assert.ok(!secrets.some(pattern=>pattern.test(value)),`Possible secret in ${name}; inspect locally`);
}
console.log(`Staged audit passed: ${names.length} explicitly staged source, asset and documentation files; no denied profiles, generated trees or recognized secret patterns.`);
