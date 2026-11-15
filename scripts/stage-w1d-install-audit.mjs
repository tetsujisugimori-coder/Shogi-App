import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { read, tree, digest, hash } from './stage-w1b-preflight.mjs';
const out=resolve(process.argv[2]),plan=read(join(out,'limited-plan.json')),dest=join(out,'install-audit');mkdirSync(dest);
const write=(p,o)=>writeFileSync(p,JSON.stringify(o,null,2)+'\n',{flag:'wx'}),rows=[];
const npm=process.env.W1C_NPM_CLI;if(!npm)throw Error('supply pinned npm CLI');
for(const [i,target] of plan.targets.entries()){
 const label=i?'new':'old',install=read(join(out,'build',label+'-install.json'));
 const env={...process.env,TEMP:install.temp,TMP:install.temp,npm_config_cache:install.cache,NODE_DISABLE_COMPILE_CACHE:'1',npm_config_update_notifier:'false',npm_config_logs_max:'0'};
 const commands=[];
 for(const args of [['--version'],['ls','--all','--json']]){
  const r=spawnSync(process.execPath,[npm,...args],{cwd:target.dir,env,encoding:'utf8',maxBuffer:64*1024*1024}),name=args[0]==='ls'?'ls':'version';
  writeFileSync(join(dest,`${label}-${name}-stdout.txt`),r.stdout??'',{flag:'wx'});writeFileSync(join(dest,`${label}-${name}-stderr.txt`),r.stderr??'',{flag:'wx'});
  commands.push({command:[process.execPath,npm,...args],cwd:target.dir,exitCode:r.status,signal:r.signal,error:r.error?.message??null});if(r.status!==0)throw Error('installation audit failed');if(name==='version'&&r.stdout.trim()!=='11.17.0')throw Error('npm version mismatch');
 }
 const dependencies=tree(join(target.dir,'node_modules')),initial=read(join(out,'build',`${label}-dependency-manifest.json`));
 rows.push({label,head:target.head,node:process.version,npm:'11.17.0',commands,lockSha256:hash(readFileSync(join(target.dir,'package-lock.json'))),initialEntries:initial.length,currentEntries:dependencies.length,installationCacheUnchanged:digest(tree(install.cache))===install.cacheSha256,installationTempUnchanged:digest(tree(install.temp))===install.tempSha256});
}
write(join(dest,'outcomes.json'),rows);console.log(JSON.stringify(rows));
