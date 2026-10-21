import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root=resolve(process.argv[2]), manifest=join(root,'manifest.json');
const collect=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?collect(join(dir,e.name)):
  join(dir,e.name)===manifest?[]:[join(dir,e.name)]);
const files=[...collect(root),'README.md','LOG.md','package.json','package-lock.json',
  'scripts/measure-tt-bottleneck.ts','scripts/prepare-tt-profile.ts','scripts/audit-tt-bottleneck.ts',
  'scripts/report-tt-bottleneck.ts','scripts/manifest-tt-bottleneck.ts','src/test/tt-bottleneck-audit.test.ts'].map(f=>resolve(f)).sort();
execFileSync('git',['diff','--exit-code','b031decd02ed32a036e43d88829a217cc385b70d','--',
  'docs/benchmarks/transposition-table-20261021','docs/benchmarks/tt-two-stage-20261021','src/domain']);
const hash=(file:string)=>createHash('sha256').update(file.endsWith('.gz')?readFileSync(file):
  Buffer.from(readFileSync(file,'utf8').replaceAll('\r\n','\n'))).digest('hex');
const value={algorithm:'SHA-256; .gz byte hash, other files UTF-8 text with CRLF normalized to LF',
  files:Object.fromEntries(files.map(f=>[relative(process.cwd(),f).replaceAll('\\','/'),hash(f)]))};
if(existsSync(manifest)) assert.deepEqual(JSON.parse(readFileSync(manifest,'utf8')),value);
else writeFileSync(manifest,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
console.log(`Verified ${files.length} final hashes; product and PR196/198 diagnostic originals unchanged.`);
