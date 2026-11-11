import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
const dist=join(root,'dist');
const manifest=JSON.parse(await readFile(join(dist,'manifest.json'),'utf8'));
const files=[];
async function walk(dir) { for(const e of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
  const p=join(dir,e.name); if(e.isDirectory()) await walk(p); else files.push(p);
}}
await walk(dist);
function crc32(bytes) { let c=0xffffffff; for(const b of bytes) { c^=b; for(let i=0;i<8;i++) c=(c>>>1)^((c&1)?0xedb88320:0); } return (c^0xffffffff)>>>0; }
const locals=[],central=[]; let offset=0;
for(const path of files) {
  const name=Buffer.from(relative(dist,path).replaceAll('\\','/'));
  const raw=await readFile(path), packed=deflateRawSync(raw), crc=crc32(raw);
  const local=Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt16LE(8,8);
  local.writeUInt16LE(33,12); local.writeUInt32LE(crc,14); local.writeUInt32LE(packed.length,18); local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
  locals.push(local,name,packed);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);c.writeUInt16LE(33,14);
  c.writeUInt32LE(crc,16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);central.push(c,name);
  offset+=local.length+name.length+packed.length;
}
const directory=Buffer.concat(central);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
const zip=Buffer.concat([...locals,directory,end]);
await mkdir(join(root,'release'),{recursive:true});
const name=`aside-translate-${manifest.version}.zip`;
await writeFile(join(root,'release',name),zip);
await writeFile(join(root,'release',name+'.sha256'),createHash('sha256').update(zip).digest('hex')+'  '+name+'\n');
console.log(`release/${name}: ${files.length} files, ${zip.length} bytes`);
