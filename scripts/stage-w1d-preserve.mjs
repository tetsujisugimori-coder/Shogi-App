import { readFileSync, readdirSync, lstatSync, readlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { hash, read, digest } from './stage-w1b-preflight.mjs';
const [mode,outArg]=process.argv.slice(2),out=resolve(outArg);
function inventory(root,dir=root) {return readdirSync(dir).sort().flatMap(n=>{const p=join(dir,n),s=lstatSync(p),path=relative(root,p).replaceAll('\\','/');return s.isSymbolicLink()?[{path,type:'link',target:readlinkSync(p)}]:s.isDirectory()?[{path,type:'directory'},...inventory(root,p)]:[{path,type:'file',sha256:hash(readFileSync(p))}];});}
const current=()=>({tmp:inventory(resolve('.tmp-tests')),w1c:inventory(resolve('docs/benchmarks/game-blunder-w1c-20261115'))});
if(mode==='before')writeFileSync(join(out,'retained-before.json.gz'),gzipSync(JSON.stringify(current())),{flag:'wx'});
else {
 const before=JSON.parse(gunzipSync(readFileSync(join(out,'retained-before.json.gz')))),after=current(),report={at:new Date().toISOString(),tmp:{entries:after.tmp.length,unchanged:digest(before.tmp)===digest(after.tmp)},w1c:{entries:after.w1c.length,files:after.w1c.filter(x=>x.type==='file').length,unchanged:digest(before.w1c)===digest(after.w1c)}};
 writeFileSync(join(out,'retained-after.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));if(!report.tmp.unchanged||!report.w1c.unchanged)process.exitCode=1;
}
