import fs from 'node:fs';
import {resolve,relative,isAbsolute,join,parse} from 'node:path';
import {digest,physical} from './stage-w1b-preflight.mjs';
const fail=r=>{throw Error(r);};
// Predeclared normalization: only the enclosing snapshot prefix is replaced.
// No case folding, arbitrary string replacement, cache exclusion or boolean coercion.
export function cacheIdentity(settings,root,{fixture=false}={}) {
  const c=settings.cache;
  if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).sort().join()!=='dir'||typeof c.dir!=='string'||!isAbsolute(c.dir))fail('CACHE_SHAPE');
  const p=resolve(c.dir),r=relative(resolve(root),p);
  if(!r||isAbsolute(r)||r==='..'||r.startsWith('..'+(process.platform==='win32'?'\\':'/')))fail('CACHE_SCOPE');
  if(p!==resolve(settings.cacheDir))fail('CACHE_PATH');
  if(!fixture){let cur=p;while(cur!==parse(cur).root){try{if(fs.lstatSync(cur).isSymbolicLink())fail('CACHE_LINK');}catch(e){if(e.code!=='ENOENT')throw e;}cur=resolve(cur,'..');}}
  if(!fixture&&fs.existsSync(p)&&!fs.lstatSync(p).isDirectory())fail('CACHE_TYPE');
  const exists=!fixture&&fs.existsSync(p);
  return {enabled:true,raw:c,absolute:p,physical:fixture?p:exists?fs.realpathSync(p):null,projectedPhysical:fixture?p:physical(p),directoryState:fixture?'synthetic':exists?'present':'absent',relative:r.replaceAll('\\','/'),normalization:'snapshot-relative-v1'};
}
export function cachePair(a,b){if(a.relative!==b.relative)fail('CACHE_PAIR_PATH');if(a.projectedPhysical===b.projectedPhysical||a.physical&&a.physical===b.physical)fail('CACHE_SHARED');return {status:a.physical&&b.physical?'PASS':'PARTIAL',configuration:'PASS',physical:a.physical&&b.physical?'distinct observed directories':'UNKNOWN: cache directory absent; prospective path only',scope:'configuration identity only; result semantics UNKNOWN'};}
export function requireExactCache(a,b){if(digest(a)!==digest(b))fail('CACHE_RESULT_CHANGED');}
