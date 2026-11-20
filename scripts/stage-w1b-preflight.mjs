// Strict raw-byte admission. No historical environment assertions.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, realpathSync, existsSync } from 'node:fs';
import { join, relative, resolve, isAbsolute, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
export const hash = b => createHash('sha256').update(b).digest('hex');
export const digest = o => hash(JSON.stringify(o));
export const read = p => JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
export function contains(root, path) {
  const r=relative(resolve(root),resolve(path));
  return r==='' || (!isAbsolute(r) && r!=='..' && !r.startsWith('..'+(process.platform==='win32'?'\\':'/')));
}
export function physical(path) {
  const p=resolve(path);
  if(existsSync(p)) return realpathSync(p);
  const parent=dirname(p);if(parent===p)throw Error('unresolved physical path');
  return join(physical(parent),relative(parent,p));
}
export function tree(root, dir=root) {
  if(lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()) throw Error(`unsupported directory: ${dir}`);
  return readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(e=>{
    const p=join(dir,e.name), path=relative(root,p).replaceAll('\\','/');
    const st=lstatSync(p);
    if(st.isSymbolicLink()) throw Error(`unsupported symlink/junction: ${p}`);
    if(st.isDirectory()) return [{path,type:'directory'},...tree(root,p)];
    if(!e.isFile()) throw Error(`unsupported entry: ${p}`);
    return [{path,type:'file',sha256:hash(readFileSync(p))}];
  });
}
export function inspect(repo, dir, head, dependencyCache=new Map()) {
  dir=resolve(dir);
  if(!/^[a-f0-9]{40}$/.test(head)) throw Error('invalid target HEAD');
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{maxBuffer:128*1024*1024,encoding:'utf8'});
  if(git('rev-parse',`${head}^{commit}`).trim()!==head) throw Error('HEAD mismatch');
  if(lstatSync(dir).isSymbolicLink()) throw Error('snapshot root must not be a link');
  const lines=git('ls-tree','-r','-z',head).split('\0').filter(Boolean);
  const expectedFiles=new Set(lines.map(l=>l.slice(l.indexOf('\t')+1))),expectedDirs=new Set();
  for(const p of expectedFiles) for(let d=dirname(p).replaceAll('\\','/');d!=='.';d=dirname(d).replaceAll('\\','/')) expectedDirs.add(d);
  function extras(d=dir) {for(const e of readdirSync(d,{withFileTypes:true})) {
    const p=join(d,e.name),r=relative(dir,p).replaceAll('\\','/'),st=lstatSync(p);
    if(r==='node_modules') continue; // explicit root junction allowed; entire resolved tree is sealed below
    if(st.isSymbolicLink()) throw Error(`unsupported snapshot symlink/junction: ${r}`);
    if(st.isDirectory()) {if(!expectedDirs.has(r)) throw Error(`untracked snapshot directory: ${r}`);extras(p);}
    else if(!st.isFile() || !expectedFiles.has(r)) throw Error(`untracked snapshot entry/type: ${r}`);
  }}
  extras(); // check ancestors before reading any source bytes; never follow source links
  const source=[];
  for(const line of lines) {
    const m=/^100(?:644|755) blob ([0-9a-f]+)\t([\s\S]+)$/.exec(line);
    if(!m) throw Error('unsupported source entry');
    const [,oid,path]=m,p=join(dir,path),st=lstatSync(p),b=readFileSync(p);
    if(!st.isFile()||st.isSymbolicLink()) throw Error(`not regular source: ${path}`);
    const actual=createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
    if(actual!==oid) throw Error(`raw blob mismatch: ${path}; no CRLF normalization permitted`);
    source.push({path,sha256:hash(b)});
  }
  const dependencyRoot=realpathSync(join(dir,'node_modules'));
  if(!dependencyCache.has(dependencyRoot)) dependencyCache.set(dependencyRoot,tree(dependencyRoot));
  const dependencies=dependencyCache.get(dependencyRoot);
  const vitest=read(join(dependencyRoot,'vitest/package.json')).version;
  if(vitest!=='4.1.11') throw Error(`unsupported reporter version: ${vitest}`);
  return {dir,head,source,sourceSha256:digest(source),dependencyRoot,dependencyCount:dependencies.length,dependenciesSha256:digest(dependencies),lockSha256:hash(readFileSync(join(dir,'package-lock.json'))),vitest};
}
// Selected environment only; no secrets or full process environment are persisted.
export function environment(plan) {
  const values=Object.fromEntries(['TEMP','TMP','npm_config_cache'].map(k=>[k,plan.environment?.[k]??process.env[k]??null]));
  for(const [k,v] of Object.entries(values)) if(!v) throw Error(`UNKNOWN isolation ${k}`);
  const inherited=Object.fromEntries(['NODE_OPTIONS','NODE_COMPILE_CACHE','NODE_DISABLE_COMPILE_CACHE','NODE_ENV','TZ','CI','DISABLE_HMR'].map(k=>[k,hash(process.env[k]??'<absent>')]));
  return {values,inherited,trees:Object.fromEntries([...new Set([...Object.values(values),...(plan.isolationPaths??[])])].sort().map(p=>[realpathSync(p),tree(p)]))};
}
export function requirePair(observations) {
  if(observations.length!==2) throw Error('exactly two targets required');
  for(const key of ['dependenciesSha256','lockSha256','vitest']) if(observations[0][key]!==observations[1][key]) throw Error(`target mismatch: ${key}`);
}
export function requireUnchanged(before,after) {
  if(digest(before)!==digest(after)) throw Error('snapshot changed after collection or execution');
}
