import { tree, digest } from './stage-w1b-preflight.mjs';
import { resolve, join } from 'node:path';
import { writeFileSync } from 'node:fs';
const out=resolve(process.argv[2]);
const old=tree(resolve('../stage-w1-snapshots/old/node_modules')),newer=tree(resolve('../stage-w1-snapshots/new/node_modules'));
const a=new Map(old.map(x=>[x.path,x.sha256])),b=new Map(newer.map(x=>[x.path,x.sha256]));
const differences=[...new Set([...a.keys(),...b.keys()])].filter(p=>a.get(p)!==b.get(p)).map(path=>({path,oldSha256:a.get(path)??null,newSha256:b.get(path)??null}));
const report={at:new Date().toISOString(),old:{count:old.length,sha256:digest(old)},new:{count:newer.length,sha256:digest(newer)},differences,note:'Raw file differences only; do not exclude caches or normalize dependency bytes to authorize comparison. Different hashes cannot establish the environment of past trials.'};
writeFileSync(join(out,'dependency-differences.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({differences:differences.length,paths:differences.map(x=>x.path)}));
