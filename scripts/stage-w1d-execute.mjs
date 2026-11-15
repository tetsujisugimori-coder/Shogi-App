// Retain each command, raw stdout/stderr and termination; fresh output required.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const [outArg,...args]=process.argv.slice(2),out=resolve(outArg);mkdirSync(out);
const started=new Date().toISOString(),r=spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:128*1024*1024});
for(const [name,value] of [['stdout.log',r.stdout??''],['stderr.log',r.stderr??'']])writeFileSync(join(out,name),value,{flag:'wx'});
writeFileSync(join(out,'execution.json'),JSON.stringify({command:[process.execPath,...args],cwd:process.cwd(),started,finished:new Date().toISOString(),exitCode:r.status,signal:r.signal,error:r.error?.message??null},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,exitCode:r.status}));process.exitCode=r.status??1;
