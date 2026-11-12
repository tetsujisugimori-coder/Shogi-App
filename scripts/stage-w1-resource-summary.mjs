import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.argv[2], output=process.argv[3];
const parse=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const runs=[];
for(let i=1;i<=8;i++) {
  const dir=join(root,`run-${String(i).padStart(2,'0')}`), meta=parse(join(dir,'run.json'));
  const stdout=readFileSync(join(dir,'stdout.log'),'utf8');
  const match=stdout.match(/Duration\s+([\d.]+)s/);
  let samples=null;
  if(meta.processSampling) {
    const lines=readFileSync(join(dir,'process-metrics.jsonl'),'utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const processes=lines.flatMap(x=>x.processes);
    samples={count:lines.length,peakVisibleNodeCount:Math.max(...lines.map(x=>x.processes.length)),peakSingleNodeWorkingSetBytes:Math.max(...processes.map(x=>x.workingSetBytes)),scope:'all visible node processes, not attributed to workers'};
  }
  runs.push({sequence:i,head:meta.head,sampled:meta.processSampling,start:meta.start,end:meta.end,wallSeconds:(Date.parse(meta.end)-Date.parse(meta.start))/1000,vitestDurationSeconds:match?Number(match[1]):null,beforeFreeBytes:meta.before.freeBytes,afterFreeBytes:meta.after.freeBytes,samples});
}
writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),runs,limitations:['Cumulative process CPU values in raw samples are not instantaneous utilization','Sampling includes unrelated processes','Wall time for sampled runs includes up to two seconds polling delay','No process attribution, GC, paging or cleanup observation','Sampling condition and run order are confounded']},null,2)+'\n',{flag:'wx'});
