import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {basename} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {summarizeV4} from '../../scripts/summarize-game-blunders';
import {CONDITIONS,repeatKey,runFixed} from '../../scripts/benchmarks/gameBlunderInvestigation';
import {readJournal,sha256} from '../../scripts/benchmarks/journalIO';
import type {StartRecord,MoveRecord} from '../../scripts/benchmarks/matchJournal';
import {stateHash} from '../../scripts/benchmarks/matchJournal';
import {apply} from '../../scripts/benchmarks/gameBlunderPilot';
import {getLegalActions} from '../domain/shogi/legalActions';

const dir='docs/benchmarks/game-blunder-investigation-v4-20261105/';
const raw=readFileSync(dir+'observations.jsonl','utf8'),rows=raw.trim().split('\n').map(s=>JSON.parse(s));
const plan=rows[0];
const historicalSources=new Set([
  'scripts/benchmarks/gameBlunderInvestigation.ts','scripts/benchmarks/gameBlunderPilot.ts',
  'scripts/investigate-game-blunders.ts','scripts/summarize-game-blunders.ts',
]);
describe('v4 real journal saved evidence integration',()=>{
  it('verifies four unchanged journal hashes and source/input provenance',()=>{
    const summary=JSON.parse(readFileSync(dir+'summary.json','utf8'));
    expect(summary.fixed.rootCalls).toBe(48);expect(summary.fixed.pairCalls).toBe(64);
    expect(summary.fixed.rootReproducibility.every((r:{reproducible:boolean})=>r.reproducible)).toBe(true);
    expect(summary.fixed.groups.every((g:{conditions:{reproducible:boolean}[]})=>g.conditions.every(c=>c.reproducible))).toBe(true);
    expect(plan.paths.map((p:string)=>sha256(readFileSync(p)))).toEqual(plan.before);
    expect(sha256(readFileSync(plan.priorFile))).toBe(plan.priorHash);expect(sha256(readFileSync(plan.v3File))).toBe(plan.v3Hash);
    // Windows experiment sources included mixed LF/CRLF. The separate manifest
    // links byte-verified raw experiment hashes to canonical LF content hashes.
    const provenance=JSON.parse(readFileSync(dir+'source-provenance.json','utf8'));
    expect(Object.keys(provenance.sources).sort()).toEqual(Object.keys(plan.sourceHashes).sort());
    for(const [p,hash] of Object.entries(plan.sourceHashes)) {
      const bytes=historicalSources.has(p)
        ? gunzipSync(readFileSync('docs/benchmarks/game-blunder-review-20261111/baseline-sources/'+basename(p)+'.gz'))
        : readFileSync(p);
      const lf=bytes.toString('utf8').replaceAll('\r\n','\n');
      expect(provenance.sources[p].experimentRawSha256,p).toBe(hash);
      expect(sha256(lf),p).toBe(provenance.sources[p].lfSha256);
    }
    expect(summary.counts).toMatchObject({total:56,noFeature:30,noFeatureMeaning:'UNKNOWN',overlap:11,indeterminate:24,notRun:32});
  });
  it('rejects truncated, duplicate, mismatched-condition and altered result/key evidence',()=>{
    const clone=()=>JSON.parse(JSON.stringify(rows));
    expect(()=>summarizeV4(rows.slice(0,-1).map(r=>JSON.stringify(r)).join('\n'))).toThrow();
    let changed=clone();changed.splice(2,0,changed.find((r:{type:string})=>r.type==='timed'));expect(()=>summarizeV4(changed.map((r:unknown)=>JSON.stringify(r)).join('\n'))).toThrow();
    changed=clone();changed.find((r:{type:string})=>r.type==='pair-fixed').condition.options.killerMoves=true;
    expect(()=>summarizeV4(changed.map((r:unknown)=>JSON.stringify(r)).join('\n'))).toThrow();
    changed=clone();changed.find((r:{type:string})=>r.type==='root-fixed').condition.options.killerMoves=true;
    expect(()=>summarizeV4(changed.map((r:unknown)=>JSON.stringify(r)).join('\n'))).toThrow('fixed condition');
    changed=clone();
    for(const condition of [changed[0].conditions[1],...changed.filter((r:{type:string;condition?:{name:string}})=>r.type==='pair-fixed'&&r.condition?.name==='q0').map((r:{condition:unknown})=>r.condition)]) {
      condition.options.quiescence.maxTacticalDepth=1;
      condition.options.killerMoves=true;
    }
    expect(()=>summarizeV4(changed.map((r:unknown)=>JSON.stringify(r)).join('\n'))).toThrow('plan condition contract');
    changed=clone();changed.find((r:{type:string})=>r.type==='pair-fixed').result.selectedEvaluation+=1;
    expect(()=>summarizeV4(changed.map((r:unknown)=>JSON.stringify(r)).join('\n'))).toThrow();
  });
  it('reaggregates evidence, rejects invalid root results, and replays the historical pairs',()=>{
    const summary=JSON.parse(readFileSync(dir+'summary.json','utf8'));
    const rebuilt=summarizeV4(raw);
    const {rootPositionHashSource,invalidObservations,...previousFixed}=rebuilt.fixed;
    expect(rootPositionHashSource).toBe('journal-reconstructed');
    expect(invalidObservations.count).toBe(0);
    expect({...rebuilt,fixed:previousFixed}).toEqual(summary);
    const invalid=JSON.parse(JSON.stringify(rows));
    const id=plan.selection[0];
    for(const r of invalid.filter((r:{type:string;id:string})=>r.type==='root-fixed'&&r.id===id)) {
      r.result.selectedEvaluation={nonfinite:'NaN'};
      r.result.evaluationBreakdown.total=r.result.selectedEvaluation;
      r.repeatKey=repeatKey(r);
    }
    const result=summarizeV4(invalid.map((r:unknown)=>JSON.stringify(r)).join('\n'));
    expect(result.fixed.rootReproducibility[0]).toMatchObject({id,reproducible:false,score:null});
    expect(result.fixed.invalidObservations).toMatchObject({count:2,byReason:{'non-finite-evaluation':2}});

    const groups=rows.filter(r=>r.type==='candidates');let reran=false;
    for(const path of plan.paths) {
      const journal=readJournal(path);expect(journal.error).toBeNull();
      const start=journal.payloads[0] as StartRecord;let state=start.initialState;
      for(const record of journal.payloads.slice(1) as MoveRecord[]) {
        if(record.type!=='move')break;
        const c=groups.find(g=>g.journal===path&&g.ply===record.ply);
        if(c) {
          expect(stateHash(state)).toBe(c.positionHash);expect(c.actual.action).toEqual(record.action);
          for(const kind of ['actual','alternative']) {
            expect(getLegalActions(state)).toContainEqual(c[kind].action);
            const child=apply(state,c[kind].action);expect(getLegalActions(child)).toEqual(c[kind].replies);
            for(const branch of c[kind].branches)for(const recapture of branch.legalRecaptures)
              expect(getLegalActions(apply(child,branch.reply))).toContainEqual(recapture);
          }
          const entries=rows.filter(r=>r.type==='pair-fixed'&&r.id===c.id&&r.rep===0);
          for(const entry of entries) {
            let leaf=state;
            for(const action of entry.result.principalVariation) {expect(getLegalActions(leaf)).toContainEqual(action);leaf=apply(leaf,action);}
          }
          if(!reran) {
            for(const kind of ['actual','alternative']) {
              // Fixed clock: this test exercises the node/depth path without wall-time flakiness.
              const r=runFixed(state,c[kind].action,c.mode,CONDITIONS[0],undefined,()=>0);
              expect(repeatKey(r)).toBe(entries.find(e=>e.kind===kind&&e.condition.name==='baseline').repeatKey);
            }
            reran=true;
          }
        }
        state=apply(state,record.action);
      }
    }
    expect(reran).toBe(true);
  },30000);
});
