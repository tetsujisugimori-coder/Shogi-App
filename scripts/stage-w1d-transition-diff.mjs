import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { digest } from './stage-w1b-preflight.mjs';
const out=resolve(process.argv[2]),states=['S1-before-config','S2-config-loaded','S3-inventory-collected','post-close'];
const read=(i,s)=>JSON.parse(gunzipSync(readFileSync(join(out,'probe',`${i}-${s}.json.gz`))));
const diff=(a,b)=>{const left=new Map(a.map(e=>[e.path,e])),right=new Map(b.map(e=>[e.path,e]));return [...new Set([...left.keys(),...right.keys()])].filter(p=>digest(left.get(p)??null)!==digest(right.get(p)??null)).map(path=>({path,before:left.get(path)??null,after:right.get(path)??null}));};
const rows=[];
for(let i=0;i<2;i++)for(let s=1;s<states.length;s++){
 const before=read(i,states[s-1]),after=read(i,states[s]);
 rows.push({target:i?'new':'old',from:states[s-1],to:states[s],environment:Object.keys(after.environment).map(path=>({path,changes:diff(before.environment[path],after.environment[path])})),installationEnvironment:Object.keys(after.installEnvironment).map(path=>({path,changes:diff(before.installEnvironment[path],after.installEnvironment[path])}))});
}
writeFileSync(join(out,'environment-transitions.json'),JSON.stringify(rows,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(rows.map(({target,from,to,environment})=>({target,from,to,environment:environment.map(({path,changes})=>({path,changes:changes.length,examples:changes.slice(0,5)}))}))));
