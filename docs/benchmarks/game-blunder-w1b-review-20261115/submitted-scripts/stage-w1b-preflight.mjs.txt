// Strict raw-byte admission. No historical environment assertions.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
export const hash = b => createHash('sha256').update(b).digest('hex');
export const digest = o => hash(JSON.stringify(o));
export const read = p => JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
export function tree(root, dir=root) {
  return readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(e=>{
    const p=join(dir,e.name), path=relative(root,p).replaceAll('\\','/');
    if(e.isSymbolicLink()) throw Error(`unsupported symlink: ${p}`);
    if(e.isDirectory()) return tree(root,p);
    if(!e.isFile()) throw Error(`unsupported entry: ${p}`);
    return [{path,sha256:hash(readFileSync(p))}];
  });
}
export function inspect(repo, dir, head, dependencyCache=new Map()) {
  dir=resolve(dir);
  if(!/^[a-f0-9]{40}$/.test(head)) throw Error('invalid target HEAD');
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{maxBuffer:128*1024*1024,encoding:'utf8'});
  if(git('rev-parse',`${head}^{commit}`).trim()!==head) throw Error('HEAD mismatch');
  const source=[];
  for(const line of git('ls-tree','-r','-z',head).split('\0').filter(Boolean)) {
    const m=/^100(?:644|755) blob ([0-9a-f]+)\t([\s\S]+)$/.exec(line);
    if(!m) throw Error('unsupported source entry');
    const [,oid,path]=m,p=join(dir,path),st=lstatSync(p),b=readFileSync(p);
    if(!st.isFile()||st.isSymbolicLink()) throw Error(`not regular source: ${path}`);
    const actual=createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
    if(actual!==oid) throw Error(`raw blob mismatch: ${path}; no CRLF normalization permitted`);
    source.push({path,sha256:hash(b)});
  }
  const expected=new Set(source.map(s=>s.path));
  function extras(d=dir) {for(const e of readdirSync(d,{withFileTypes:true})) {
    const p=join(d,e.name),r=relative(dir,p).replaceAll('\\','/');
    if(r==='node_modules') continue; // separately hashed in full below
    if(e.isDirectory()) extras(p); else if(!expected.has(r)) throw Error(`untracked snapshot entry: ${r}`);
  }}
  extras();
  const dependencyRoot=realpathSync(join(dir,'node_modules'));
  if(!dependencyCache.has(dependencyRoot)) dependencyCache.set(dependencyRoot,tree(dependencyRoot));
  const dependencies=dependencyCache.get(dependencyRoot);
  const vitest=read(join(dependencyRoot,'vitest/package.json')).version;
  if(vitest!=='4.1.11') throw Error(`unsupported reporter version: ${vitest}`);
  return {dir,head,source,sourceSha256:digest(source),dependencyRoot,dependencyCount:dependencies.length,dependenciesSha256:digest(dependencies),lockSha256:hash(readFileSync(join(dir,'package-lock.json'))),vitest};
}
export function requirePair(observations) {
  if(observations.length!==2) throw Error('exactly two targets required');
  for(const key of ['dependenciesSha256','lockSha256','vitest']) if(observations[0][key]!==observations[1][key]) throw Error(`target mismatch: ${key}`);
}
export function requireUnchanged(before,after) {
  if(digest(before)!==digest(after)) throw Error('snapshot changed after collection or execution');
}
