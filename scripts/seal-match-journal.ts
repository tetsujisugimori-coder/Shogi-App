import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { sha256, parse } from './benchmarks/journalIO';
import type { StartRecord } from './benchmarks/matchJournal';

const [mode, directory = 'docs/benchmarks/match-journal-20261026'] = process.argv.slice(2), dir = resolve(directory);
const walk = (path: string): string[] => readdirSync(path).flatMap(name => {
  const p = resolve(path,name); return statSync(p).isDirectory() ? walk(p) : [p];
});
const old = JSON.parse(readFileSync(resolve(dir,'protected-originals.json'),'utf8')) as Record<string,string>;
for (const [path,hash] of Object.entries(old)) assert.equal(sha256(readFileSync(path)),hash,'old evidence changed: '+path);
const plans = walk(dir).filter(p => p.endsWith('plan.json'));
for (const path of plans) {
  const plan = parse<{games:StartRecord[]}>(readFileSync(path,'utf8'));
  for (const [source,hash] of Object.entries(plan.games[0].sourceHashes)) {
    assert.equal(sha256(gunzipSync(readFileSync(resolve(path,'..','sources',source+'.gz')))),hash,'source snapshot '+source);
    assert.equal(sha256(readFileSync(source,'utf8').replaceAll('\r\n','\n')),hash,'measured source changed '+source);
  }
}
const manifestPath = resolve(dir,'manifest.json');
if (mode === 'create') {
  const manifest = Object.fromEntries(walk(dir).filter(p => p !== manifestPath).sort().map(p => [relative(dir,p).replaceAll('\\','/'),sha256(readFileSync(p))]));
  writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({oldFiles:Object.keys(old).length,newFiles:Object.keys(manifest).length,manifestHash:sha256(readFileSync(manifestPath))}));
} else if (mode === 'verify') {
  const manifest = JSON.parse(readFileSync(manifestPath,'utf8')) as Record<string,string>;
  for (const [path,hash] of Object.entries(manifest)) assert.equal(sha256(readFileSync(resolve(dir,path))),hash,'new evidence changed '+path);
  assert.deepEqual(walk(dir).filter(p => p !== manifestPath).map(p => relative(dir,p).replaceAll('\\','/')).sort(),Object.keys(manifest).sort());
  console.log(JSON.stringify({verified:true,oldFiles:Object.keys(old).length,newFiles:Object.keys(manifest).length}));
} else if (mode === 'originals') console.log(JSON.stringify({protectedOriginals:Object.keys(old).length,sourcePlans:plans.length,verified:true}));
else throw Error('create|verify|originals [EVIDENCE_DIR]');
