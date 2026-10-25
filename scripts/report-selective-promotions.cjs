// Deterministic supplemental aggregation; emits JSON from immutable saved raw.
const fs=require('node:fs');
const path=require('node:path');
const base=path.resolve(process.argv[2]);
const s=JSON.parse(fs.readFileSync(path.join(base,'run2/summary.json'),'utf8'));
const rows=fs.readFileSync(path.join(base,'run2/raw.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(r=>r.type==='record');
const result={
  metrics:s.summary.filter(x=>x.stage==='performance'),pairs:s.pairs.map(({deltas,...p})=>p),
  quality:Object.fromEntries(['A','B','C1'].map(v=>[v,Object.fromEntries(['ProvenError','QualityGap','Inconclusive','NoObservedDifference'].map(k=>[k,s.quality.filter(q=>q.rows.find(r=>r.variant===v).classification.quality===k).length]))])),
  perPosition:[],matches:s.matches,proofs:s.proofs,
};
for(const limit of [100,1000])for(const id of [...new Set(rows.filter(x=>x.stage==='performance').map(x=>x.id))]) {
  const values=['A','B','C1'].map(variant=>{
    const cell=rows.filter(x=>x.stage==='performance'&&x.phase==='measurement'&&x.limit===limit&&x.id===id&&x.variant===variant);
    return {variant,depths:cell.map(r=>r.data.result.completedDepth),actualMs:cell.map(r=>r.data.actualMs),sources:cell.map(r=>r.data.result.resultSource)};
  });result.perPosition.push({id,limit,values});
}
const bytes=JSON.stringify(result,null,2)+'\n';
if(process.argv[3])fs.writeFileSync(process.argv[3],bytes,{flag:'wx'});else process.stdout.write(bytes);
