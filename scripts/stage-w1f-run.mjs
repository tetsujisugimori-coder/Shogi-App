import fs from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
const [outArg,name,exe,...args]=process.argv.slice(2),out=resolve(outArg);fs.mkdirSync(join(out,name));
const started=new Date().toISOString(),r=spawnSync(exe,args,{encoding:'utf8',maxBuffer:128*1024*1024});
for(const [n,v] of [['stdout.txt',r.stdout??''],['stderr.txt',r.stderr??''],['result.json',JSON.stringify({started,finished:new Date().toISOString(),command:[exe,...args],exitCode:r.status,signal:r.signal,error:r.error?.message??null},null,2)]])fs.writeFileSync(join(out,name,n),v,{flag:'wx'});
console.log(JSON.stringify({name,exitCode:r.status,signal:r.signal,stdoutTail:r.stdout?.slice(-1400),stderrTail:r.stderr?.slice(-600)}));process.exitCode=r.status??1;
