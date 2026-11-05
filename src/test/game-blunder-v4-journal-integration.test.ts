import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
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
describe('v4 real journal saved evidence integration',()=>{
  it('reaggregates complete coverage and verifies four unchanged journal hashes and source/input provenance',()=>{
    const summary=JSON.parse(readFileSync(dir+'summary.json','utf8'));
    expect(summarizeV4(raw)).toEqual(summary);
    expect(summary.fixed.rootCalls).toBe(48);expect(summary.fixed.pairCalls).toBe(64);
    expect(summary.fixed.rootReproducibility.every((r:{reproducible:boolean})=>r.reproducible)).toBe(true);
    expect(summary.fixed.groups.every((g:{conditions:{reproducible:boolean}[]})=>g.conditions.every(c=>c.reproducible))).toBe(true);
    expect(plan.paths.map((p:string)=>sha256(readFileSync(p)))).toEqual(plan.before);
    expect(sha256(readFileSync(plan.priorFile))).toBe(plan.priorHash);expect(sha256(readFileSync(plan.v3File))).toBe(plan.v3Hash);
    // Source checkouts may use LF or CRLF; raw experiment hashes remain saved.
    // Journal/input artifacts are byte-exact and protected by .gitattributes.
    for(const [p,hash] of Object.entries(plan.sourceHashes)) {
      const text=readFileSync(p,'utf8'),lf=text.replaceAll('\r\n','\n');
      expect([sha256(text),sha256(lf),sha256(lf.replaceAll('\n','\r\n'))],p).toContain(hash);
    }
    expect(summary.counts).toMatchObject({total:56,noFeature:30,noFeatureMeaning:'UNKNOWN',overlap:11,indeterminate:24,notRun:32});
  });
  it('rejects truncated, duplicate, mismatched-condition and altered result/key evidence',()=>{
    const clone=()=>JSON.parse(JSON.stringify(rows));
    expect(()=>summarizeV4(rows.slice(0,-1).map(r=>JSON.stringify(r)).join('\n'))).toThrow();
    let changed=clone();changed.splice(2,0,changed.find((r:{type:string})=>r.type==='timed'));expect(()=>summarizeV4(changed.map((r:unknown)=>JSON.stringify(r)).join('\n'))).toThrow();
    changed=clone();changed.find((r:{type:string})=>r.type==='pair-fixed').condition.options.killerMoves=true;
    expect(()=>summarizeV4(changed.map((r:unknown)=>JSON.stringify(r)).join('\n'))).toThrow();
    changed=clone();changed.find((r:{type:string})=>r.type==='pair-fixed').result.selectedEvaluation+=1;
    expect(()=>summarizeV4(changed.map((r:unknown)=>JSON.stringify(r)).join('\n'))).toThrow();
  });
  it('replays the four historical positions, validates both candidates and all saved PVs, and reruns one fixed pair',()=>{
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
