// Read-only W1b preflight. UNKNOWN is deliberately fail-closed.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, readlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const [repo, oldDir, oldHead, newDir, newHead, output] = process.argv.slice(2);
if (!output || !/^[0-9a-f]{40}$/.test(oldHead) || !/^[0-9a-f]{40}$/.test(newHead)) throw Error('usage: node stage-w1b-preflight.mjs <repo> <old-snapshot> <old-sha> <new-snapshot> <new-sha> <new-output.json>');
const hash = b => createHash('sha256').update(b).digest('hex');
const git = (...a) => execFileSync('git',['-C',repo,...a],{encoding:'utf8',maxBuffer:64*1024*1024});
function walk(root, dir=root, skipDependencies=false) {
  return readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const p=join(dir,e.name),r=relative(root,p).replaceAll('\\','/'); if(skipDependencies && r==='node_modules') return []; if(e.isSymbolicLink()) return [{path:r,type:'symlink',value:readlinkSync(p)}]; if(e.isDirectory()) return walk(root,p,skipDependencies); if(e.isFile()) return [{path:r,type:'file',value:hash(readFileSync(p))}]; return [{path:r,type:'other'}];});
}
function inspect(dir, head) {
  const errors=[]; let entries=[];
  const resolvedHead=git('rev-parse',`${head}^{commit}`).trim();
  if(resolvedHead!==head) errors.push('commit mismatch');
  const lines=git('ls-tree','-r','-z',head).split('\0').filter(Boolean);
  for(const line of lines){ const m=/^(\d+) blob ([0-9a-f]+)\t([\s\S]+)$/.exec(line); if(!m){errors.push('unsupported tree entry');continue;} const [,mode,oid,path]=m;
    try { const p=join(dir,...path.split('/')); const stat=lstatSync(p); let bytes;
      if(mode==='120000') { if(!stat.isSymbolicLink()) throw Error('symlink missing'); bytes=Buffer.from(readlinkSync(p)); }
      else { if(!stat.isFile() || stat.isSymbolicLink()) throw Error('not regular file'); bytes=readFileSync(p); }
      const blob=createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
      if(blob!==oid) errors.push(`blob mismatch: ${path}`);
    } catch(e){errors.push(`${path}: ${e.message}`);}
  }
  const tracked=new Set(lines.map(l=>l.slice(l.indexOf('\t')+1)));
  const extras=walk(dir,dir,true).filter(x=>!tracked.has(x.path));
  if(extras.length) errors.push(`untracked snapshot entries: ${extras.length}`);
  try {entries=walk(join(dir,'node_modules')).sort((a,b)=>a.path.localeCompare(b.path));} catch(e){errors.push(`dependency tree: ${e.message}`);}
  const unsafe=entries.filter(e=>e.type!=='file');
  if(unsafe.length) errors.push(`dependency entries not regular files: ${unsafe.length}`);
  return {head:resolvedHead,sourceTree:git('rev-parse',`${head}^{tree}`).trim(),trackedCount:tracked.size,sourceErrors:errors,extraExamples:extras.slice(0,20),lockSha256:hash(readFileSync(join(dir,'package-lock.json'))),vitestVersion:JSON.parse(readFileSync(join(dir,'node_modules/vitest/package.json'),'utf8')).version,dependencies:{entries:entries.length,sha256:hash(JSON.stringify(entries)),nonRegular:unsafe.slice(0,20)}};
}
let report={at:new Date().toISOString(),executionContext:{platform:process.platform,node:process.version,nodePath:process.execPath,TEMP:process.env.TEMP??null,TMP:process.env.TMP??null,npm_config_cache:process.env.npm_config_cache??null},status:'UNKNOWN',limitations:['Values are for this preflight process only; a different host or process must capture its own environment.','Resolved pool, maxWorkers, timeout, and effective cache are not measured; do not launch an official comparison.','Hash comparison is a point-in-time check and cannot establish past trial dependency identity.']};
try {report.old=inspect(resolve(oldDir),oldHead);report.new=inspect(resolve(newDir),newHead);report.comparison={lockEqual:report.old.lockSha256===report.new.lockSha256,dependenciesEqual:report.old.dependencies.sha256===report.new.dependencies.sha256,vitestEqual:report.old.vitestVersion===report.new.vitestVersion};if(report.old.sourceErrors.length||report.new.sourceErrors.length||Object.values(report.comparison).includes(false))report.status='INVALID';}catch(e){report.error=String(e);report.status='UNKNOWN';}
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(report.status);process.exitCode=1;
