import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {spawnSync,execFileSync} from 'node:child_process';
import {sha256} from './benchmarks/journalIO';
import {json,repeatKey} from './benchmarks/gameBlunderInvestigation';

const [baseline,output]=process.argv.slice(2);
if(baseline==='--check') {
  const [checkout,input,id]=process.argv.slice(3);
  try {
    const {summarizeV4}=await import(pathToFileURL(resolve(checkout,'scripts/summarize-game-blunders.ts')).href);
    const summary=summarizeV4(readFileSync(input,'utf8'));
    const invalid=summary.fixed.invalidObservations?.rows??[];
    const root=summary.fixed.rootReproducibility.find(r=>r.id===id);
    const reproducible=summary.fixed.rootReproducibility.filter(r=>r.reproducible).length;
    const excluded=invalid.filter(r=>r.id===id);
    console.log(JSON.stringify({decision:root?.reproducible?'accepted':'excluded',reproducible,
      reason:excluded.length?excluded.map(r=>r.reason):root?.reproducible?'reproducible':'not reproducible',
      rootScore:root?.score,invalid:excluded}));
  } catch(error) {
    console.log(JSON.stringify({decision:'rejected',reason:error.message}));
    process.exitCode=1;
  }
} else {
  if(!baseline||!output) throw Error('BASELINE_SOURCE_DIR NEW_RESULTS_JSON');
  const original='docs/benchmarks/game-blunder-investigation-v4-20261105/observations.jsonl';
  const source=readFileSync(original,'utf8');
  const parse=()=>source.trim().split('\n').map(JSON.parse);
  const first=parse()[0].selection[0];
  const roots=rows=>rows.filter(r=>r.type==='root-fixed'&&r.id===first);
  const changeRoots=fn=>rows=>roots(rows).forEach((row,i)=>fn(row,i,rows));
  const refresh=row=>{row.repeatKey=repeatKey(row);};
  const score=value=>changeRoots(r=>{r.result.selectedEvaluation=value;r.result.evaluationBreakdown.total=value;refresh(r);});
  const changeCondition=(name,fn)=>rows=>{
    fn(rows[0].conditions.find(c=>c.name===name));
    rows.filter(r=>r.type==='pair-fixed'&&r.condition.name===name).forEach(r=>fn(r.condition));
  };
  const cases=[
    ['control','normal','Untouched schema 2 observations',()=>{}],
    ['P2-01','foreign-hash','Add hash of a different selected journal position to rep 1',changeRoots((r,i,rs)=>{if(i===1)r.positionHash=rs[0].selection[2].split('/')[0];})],
    ['P2-01','foreign-mode','Change mode of rep 1 only, keeping identical repeatKey',changeRoots((r,i)=>{if(i===1)r.mode='experimental';})],
    ['P2-01','foreign-settings','Enable killerMoves for rep 1 only',changeRoots((r,i)=>{if(i===1)r.condition.options.killerMoves=true;})],
    ['P2-01','foreign-depth','Claim requested and completed depth 2 on both root-depth1 rows',changeRoots(r=>{r.requestedDepth=r.completedDepth=r.result.depth=2;refresh(r);})],
    ['P2-01','foreign-budget','Change only root rep 1 budget to 1499 nodes',changeRoots((r,i)=>{if(i===1)r.budget.nodes=1499;})],
    ['P2-01','coherent-budget','Change plan and every recorded budget together to 1499 nodes',rows=>rows.filter(r=>r.budget).forEach(r=>{r.budget.nodes=1499;})],
    ['P2-01','duplicate-rep','Duplicate root rep 0 as rep 1 index',changeRoots(r=>{r.rep=0;})],
    ['P2-01','missing-rep','Remove rep 1 and update I/O coverage',rows=>{
      const index=rows.indexOf(roots(rows)[1]);
      rows.splice(index,1); rows.at(-1).ioMeasurements.splice(index,1);
      rows.at(-1).ioMeasurements.forEach((entry,i)=>{entry.index=i;});
    }],
    ['P2-01','candidate-replies','Erase legal candidate replies in the saved metadata',rows=>{rows.find(r=>r.type==='candidates').actual.replies=[];}],
    ['P2-01','foreign-id','Replace one root ID with a different existing selected position ID',changeRoots((r,i,rs)=>{if(i===1)r.id=rs[0].selection[2];})],
    ['P2-02','q0-killer','In plan and rows, replace q0 depth change with killerMoves=true',changeCondition('q0',c=>{c.options.quiescence.maxTacticalDepth=1;c.options.killerMoves=true;})],
    ['P2-02','depth1-mislabeled','In plan and rows, relabel depth1 as wrong-depth',changeCondition('depth1',c=>{c.name='wrong-depth';})],
    ['P2-02','see-order-wrong-value','In plan and rows, replace static-exchange with an invented ordering',changeCondition('see-order',c=>{c.options.moveOrdering='unknown-policy';})],
    ['P2-02','baseline-and-variants','Change TT from false to true in the plan and all pair rows for every condition',rows=>{
      for(const name of ['baseline','q0','depth1','see-order'])changeCondition(name,c=>{c.options.useTranspositionTable=true;})(rows);
    }],
    ['P3-01','null-score','Both roots claim completed with null scores and updated keys',score(null)],
    ['P3-01','nan-tag','Both roots claim completed with NaN, serialized by the production JSON encoder',score(NaN)],
    ['P3-01','infinity-tag','Both roots claim completed with Infinity, serialized by the production JSON encoder',score(Infinity)],
    ['P3-01','infinity-number','Both roots contain a legal JSON exponent that parses to numeric Infinity',score(Infinity),raw=>raw.replaceAll('"selectedEvaluation":{"nonfinite":"Infinity"}','"selectedEvaluation":1e400')],
    ['P3-01','partial','Both roots report partial status, with regenerated keys',changeRoots(r=>{r.status='partial';r.validity='unusable';refresh(r);})],
    ...['interrupted','error'].map(status=>['P3-01',status,'Both roots record '+status+' with no result',changeRoots(r=>{
      Object.assign(r,{status,reason:'fixture',validity:'unusable',completedDepth:0,result:null});refresh(r);
    })]),
    ['P3-01','depth-mismatch','Both roots report completedDepth 0 with regenerated keys',changeRoots(r=>{r.completedDepth=0;refresh(r);})],
    ['P3-01','invalid-validity','Both roots claim unusable with otherwise finite consistent results',changeRoots(r=>{r.validity='unusable';})],
    ['P3-01','forged-finite-score','Change both finite totals and regenerate keys while keeping the original legal PV',score(999999)],
    ['P3-01','score-breakdown','Both roots retain finite score with inconsistent evaluation breakdown',changeRoots(r=>{r.result.evaluationBreakdown.total+=1;})],
    ['P3-01','inconsistent-nodes','Change both observed normal node counts without changing result counters',changeRoots(r=>{r.nodes.normal=0;refresh(r);})],
    ['P3-01','illegal-pv','Both roots have the same illegal selected action and matching PV start',changeRoots(r=>{
      r.result.selectedAction.to={row:99,col:99};r.result.principalVariation[0]=r.result.selectedAction;refresh(r);
    })],
  ];
  const scratch=mkdtempSync(join(tmpdir(),'shogi-blunder-review-'));
  const results=[];
  for(const [finding,name,change,mutate,transform] of cases) {
    const rows=parse();
    mutate(rows);
    const raw=name==='normal'?source:rows.map(json).join('\n')+'\n';
    const input=join(scratch,name+'.jsonl');
    const mutated=transform?transform(raw):raw;
    writeFileSync(input,mutated);
    const attempts=[baseline,'.'].map(checkout=>{
      const run=spawnSync(process.execPath,['--import','tsx',process.argv[1],'--check',checkout,input,first],{encoding:'utf8'});
      if(run.error||!run.stdout) throw Error(run.stderr||String(run.error));
      return {exitCode:run.status,...JSON.parse(run.stdout)};
    });
    const [old,current]=attempts;
    results.push({finding,name,change,inputSha256:sha256(mutated),old,current});
    console.log(name,old.exitCode,old.decision,'->',current.exitCode,current.decision);
  }
  writeFileSync(output,JSON.stringify({source:original,baseline:execFileSync('git',['rev-parse','e1ccb1a'],{encoding:'utf8'}).trim(),
    currentParent:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cases:results},null,2)+'\n',{flag:'wx'});
  if(results.some(r=>r.name==='normal'?(r.old.decision!=='accepted'||r.current.decision!=='accepted'):r.current.decision==='accepted'))
    process.exitCode=1;
}
