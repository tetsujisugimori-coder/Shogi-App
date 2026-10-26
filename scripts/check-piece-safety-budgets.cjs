const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root='docs/benchmarks/piece-safety-20261025';
function cli(mode,dir,expected=0){const r=cp.spawnSync(process.execPath,['--import','tsx','scripts/measure-piece-safety.ts',mode,dir],{encoding:'utf8',timeout:15000,maxBuffer:1024*1024});assert.equal(r.error,undefined);assert.equal(r.status,expected,r.stderr);return r.stdout.trim();}
for(const mode of ['zero','capacity']){
  const dir=path.join(root,'budget-'+mode);console.log(cli('prepare',dir));
  const file=path.join(dir,'plan.json'),plan=JSON.parse(fs.readFileSync(file,'utf8'));
  if(mode==='zero')plan.globalMs=0;
  else plan.maxBytes=fs.readdirSync(dir).reduce((n,f)=>n+fs.statSync(path.join(dir,f)).size,0)+plan.reserveBytes+8192;
  fs.writeFileSync(file,JSON.stringify(plan)+'\n');console.log(cli('run',dir,1));
  const a=cli('audit',dir),b=cli('audit',dir);assert.equal(a,b);
  const raw=fs.readFileSync(path.join(dir,'raw.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  const summary=JSON.parse(fs.readFileSync(path.join(dir,'summary.json'),'utf8'));
  assert.equal(summary.complete,false);assert.ok(summary.missing.length>0);
  assert.equal(raw.find(r=>r.type==='failure').reason,mode==='zero'?'global budget':'capacity budget');
  if(mode==='zero')assert.equal(summary.completed,0);
  const bytes=fs.readdirSync(dir).reduce((n,f)=>n+fs.statSync(path.join(dir,f)).size,0);assert.ok(bytes<=plan.maxBytes);
  console.log(JSON.stringify({mode,audit:a,bytes,maxBytes:plan.maxBytes,completed:summary.completed,missing:summary.missing.length}));
}
