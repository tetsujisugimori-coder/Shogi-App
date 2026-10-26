// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fork } from 'node:child_process';
import { JournalWriter, readJournal, encode, decode, canonical, sha256, frame, diskIO, CapacityError } from '../../scripts/benchmarks/journalIO';
import { runJournalGame, auditJournal, aggregateJournals, reportSummary, type StartRecord, type JournalRecord, stateHash } from '../../scripts/benchmarks/matchJournal';
import { fixtureStart, fixtureSearch } from '../../scripts/benchmarks/journalFixtures';
import { runSelfPlayGame } from '../domain/shogi/selfPlayGame';
import { tacticalPositions } from '../../scripts/benchmarks/tacticalPositions';

let dir: string, serial=0;
const file=(label='case') => join(dir,`${++serial}-${label}.jsonl`);
function run(start=fixtureStart(), path=file(), io=diskIO) {
  const writer=new JournalWriter(path,start.conditions.maxBytes,start.conditions.reserveBytes,io);
  try { return {path,result:runJournalGame(start,writer,fixtureSearch,()=>0)}; }
  finally {writer.close();}
}
function rewrite(records: unknown[], path=file('rewritten')) {
  let previous: string|null=null;
  const bytes=records.map((record,i)=>{const line=frame(record,i,previous); previous=JSON.parse(line).hash; return line;}).join('');
  writeFileSync(path,bytes,{flag:'wx'}); return path;
}
beforeAll(()=>{
  dir=process.env.MATCH_JOURNAL_EVIDENCE ? resolve(process.env.MATCH_JOURNAL_EVIDENCE) : mkdtempSync(join(tmpdir(),'shogi-journal-'));
  if(process.env.MATCH_JOURNAL_EVIDENCE) mkdirSync(dir,{recursive:false});
});
afterAll(()=>{if(!process.env.MATCH_JOURNAL_EVIDENCE)rmSync(dir,{recursive:true,force:true});});

describe('durable per-ply journal',()=>{
  it('round-trips non-finite, null, undefined, absent, negative zero and literal tags without ambiguity',()=>{
    const value={positive:Infinity,negative:-Infinity,nil:null,unknown:undefined,zero:-0,words:['Infinity','undefined'],nested:{'$journal':'undefined'},array:[null,undefined,0]};
    expect(decode(encode(value))).toStrictEqual(value);
    expect(canonical({missing:undefined})).not.toBe(canonical({}));
    expect(()=>encode(NaN)).toThrow();
    for(const bad of [['number','NaN'],['number',null],['number',Infinity],['number','1'],['unknown'],['object',[['a',['null']],['a',['null']]]]]) expect(()=>decode(bad)).toThrow();
  });
  it('persists a normal rule ending, PV and Infinity, and legally replays the same result',()=>{
    const start=fixtureStart({initialState:tacticalPositions().find(p=>p.id==='mate-sente')!.state});
    const {path,result}=run(start), audit=auditJournal(path);
    expect(result.end.reason).toBe('rule');expect(audit.status).toBe('complete');
    expect(audit.end?.gameResult).toEqual(result.end.gameResult);
    expect(audit.moves[0].search.selectedEvaluation).toBe(Infinity);
    expect(audit.finalHash).toBe(stateHash(result.finalState));
  });
  it('matches journal-disabled self-play actions and all deterministic search observations',()=>{
    const start=fixtureStart(), observed: unknown[]=[];
    const search=(s: Parameters<typeof fixtureSearch>[0])=>{const r=fixtureSearch(s,start.seats[s.turn]);observed.push(r);return r;};
    const participant={settings:undefined,search};
    const without=runSelfPlayGame({initialState:start.initialState,sente:participant,gote:participant,maxPlies:3});
    const {path,result}=run(start), audit=auditJournal(path);
    expect(audit.status).toBe('complete');expect(audit.end?.reason).toBe('max_plies');
    expect(audit.moves.map(m=>m.search)).toEqual(observed);
    expect(audit.moves.map(m=>m.action)).toEqual(without.plies.map(p=>p.action));
    expect(result.finalState).toEqual(without.finalState);
  });
  it('stops at an arbitrary committed ply and preserves the unfinished legal prefix',()=>{
    const start=fixtureStart();start.conditions.stopAfter=2;
    const {path}=run(start),audit=auditJournal(path);
    expect(audit.status).toBe('incomplete');expect(audit.moves).toHaveLength(2);expect(audit.end?.reason).toBe('interrupted');
  });
  it('kills a real writer process after fsync and replays its prefix without an end record',async()=>{
    const path=file('killed'); let committed=0;
    const child=fork(resolve('scripts/test-journal-kill-child.ts'),[path],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc']});
    let stderr='';child.stderr?.on('data',b=>{stderr+=String(b);});
    try {
      await new Promise<void>((done,reject)=>{
        child.once('error',reject);
        child.on('message',(m:{committed:number})=>{committed=m.committed;child.kill('SIGKILL');});
        child.once('exit',()=>committed===3?done():reject(Error(stderr||'child exited before commit')));
      });
      const audit=auditJournal(path);expect(audit.error).toBeNull();expect(audit.status).toBe('incomplete');
      expect(audit.moves).toHaveLength(3);expect(audit.end).toBeNull();expect(audit.partialTailBytes).toBe(0);
    } finally {child.kill('SIGKILL');}
  },20000);
  it('reports a torn final line, audits only its complete prefix, and never repairs the source',()=>{
    const {path}=run(),bytes=readFileSync(path),torn=file('torn');
    writeFileSync(torn,bytes.subarray(0,bytes.length-13));const before=sha256(readFileSync(torn));
    const audit=auditJournal(torn);expect(audit.error).toBeNull();expect(audit.status).toBe('incomplete');
    expect(audit.moves).toHaveLength(3);expect(audit.end).toBeNull();expect(audit.partialTailBytes).toBeGreaterThan(0);
    expect(sha256(readFileSync(torn))).toBe(before);
  });
  it.each(['corrupt','missing','duplicate','reverse','unknown-schema','invalid-value','complete-invalid-tail','extra-after-end'])('rejects %s instead of skipping records',kind=>{
    const {path}=run(),lines=readFileSync(path,'utf8').trimEnd().split('\n');
    if(kind==='corrupt')lines[2]=lines[2].replace('number','broken');
    if(kind==='missing')lines.splice(2,1);
    if(kind==='duplicate')lines.splice(2,0,lines[2]);
    if(kind==='reverse')[lines[1],lines[2]]=[lines[2],lines[1]];
    if(kind==='unknown-schema')lines[0]=lines[0].replace('"schema":1','"schema":2');
    if(kind==='invalid-value')lines[1]=lines[1].replace('"number",','"number","NaN",');
    if(kind==='complete-invalid-tail')lines.push('{"unfinished":');
    if(kind==='extra-after-end')lines.push(frame({type:'move'},5,JSON.parse(lines[4]).hash).trimEnd());
    const changed=file(kind);writeFileSync(changed,lines.join('\n')+'\n');
    expect(auditJournal(changed).status).toBe('corrupt');
    expect(aggregateJournals([changed]).counts.complete).toBe(0);
  });
  it.each(['ply','turn','state','end','observation','history','options'])('semantically rejects %s even with recomputed valid checksums',kind=>{
    const {path}=run(),records=readJournal(path).payloads as JournalRecord[];
    const start=records[0] as StartRecord, move=records[1];if(move.type!=='move')throw Error('fixture');
    if(kind==='ply')move.ply=99;
    if(kind==='turn')move.player='gote';
    if(kind==='state')move.afterHash='0'.repeat(64);
    if(kind==='end'&&records[4].type==='end')records[4].reason='rule';
    if(kind==='observation')move.search.completedDepth=-1;
    if(kind==='history')start.initialState.positionHistory![0].gaveCheck=true;
    if(kind==='options')start.conditions.options={...start.conditions.options,useTranspositionTable:true};
    expect(auditJournal(rewrite(records)).status).toBe('corrupt');
  });
  it('handles short writes and refuses zero writes and sync failures without continuing',()=>{
    let writes=0;
    const short={...diskIO,write:((fd:number,b:Buffer,offset:number,length:number)=>{writes++;return diskIO.write(fd,b,offset,Math.min(length,97));}) as typeof diskIO.write};
    const {path}=run(fixtureStart(),file('short'),short);expect(writes).toBeGreaterThan(20);expect(auditJournal(path).status).toBe('complete');
    for(const method of ['zero','sync'] as const){
      const io={...diskIO,...(method==='zero'?{write:(()=>0) as typeof diskIO.write}:{sync:()=>{throw Error('injected fsync failure');}})};
      const writer=new JournalWriter(file(method),1024*1024,65536,io);
      try {expect(()=>writer.append({type:'start'})).toThrow();expect(()=>writer.append({type:'end'},true)).toThrow(/poisoned/);}
      finally{writer.close();}
    }
  });
  it('stops on an actual closed-file write failure after a committed prefix',()=>{
    const path=file('write-error');let syncs=0;
    const io={...diskIO,sync:(fd:number)=>{diskIO.sync(fd);if(++syncs===2)diskIO.close(fd);},close:()=>{}};
    expect(()=>run(fixtureStart(),path,io)).toThrow();
    const audit=auditJournal(path);expect(audit.moves).toHaveLength(1);expect(audit.end).toBeNull();expect(audit.status).toBe('incomplete');
  });
  it('enforces capacity without exceeding it or treating a computed unsaved move as committed',()=>{
    const start=fixtureStart();
    // Recompute after changing maxBytes (its decimal width affects start-frame size).
    start.conditions.maxBytes=65536+Buffer.byteLength(frame(start,0,null))+20;
    const {path}=run(start);const audit=auditJournal(path);
    expect(audit.status).toBe('incomplete');expect(audit.end?.reason).toBe('capacity');expect(audit.moves).toHaveLength(0);
    expect(statSync(path).size).toBeLessThanOrEqual(start.conditions.maxBytes);
    const writer=new JournalWriter(file('start-capacity'),2048,1024);
    try {expect(()=>writer.append(start)).toThrow(CapacityError);}finally{writer.close();}
  });
  it('enforces the overall game time limit with an explicit ending',()=>{
    const start=fixtureStart();start.conditions.gameMs=0;const {path}=run(start);
    const audit=auditJournal(path);expect(audit.end?.reason).toBe('time_limit');expect(audit.moves).toHaveLength(0);expect(audit.status).toBe('incomplete');
  });
  it('stops at the next boundary when time expires during an actual search call',()=>{
    const start=fixtureStart(),path=file('midgame-time');start.conditions.gameMs=5;
    const writer=new JournalWriter(path,start.conditions.maxBytes);let now=0,calls=0;
    try{runJournalGame(start,writer,(state,mode)=>{calls++;const r=fixtureSearch(state,mode);now+=6;return r;},()=>now);}finally{writer.close();}
    const audit=auditJournal(path);expect(calls).toBe(1);expect(audit.moves).toHaveLength(1);expect(audit.end?.reason).toBe('time_limit');expect(audit.end?.apiMs).toBe(6);
  });
  it('preserves search failures as failures and records their separate attempted API cost',()=>{
    const start=fixtureStart(),path=file('search-error'),writer=new JournalWriter(path,start.conditions.maxBytes);let now=0;
    try{runJournalGame(start,writer,()=>{now=3;throw Error('search failed');},()=>now);}finally{writer.close();}
    const audit=auditJournal(path);expect(audit.status).toBe('incomplete');expect(audit.end?.reason).toBe('search_failure');expect(audit.end?.uncommittedApiMs).toBe(3);expect(audit.moves).toHaveLength(0);
    const invalidPath=file('nonfinite-failed-result'),invalidWriter=new JournalWriter(invalidPath,start.conditions.maxBytes);
    try{runJournalGame(start,invalidWriter,(s,m)=>({...fixtureSearch(s,m),completedDepth:-1,selectedEvaluation:-Infinity}));}finally{invalidWriter.close();}
    const saved=JSON.parse(JSON.stringify(aggregateJournals([invalidPath])));
    expect(decode(saved.games[0].end.finalSearchEncoded)).toMatchObject({selectedEvaluation:-Infinity,completedDepth:-1});
  });
  it('legally replays all prior history in the saved six-ply starting position',()=>{
    const start=fixtureStart({initialState:tacticalPositions().find(p=>p.id==='hirate-exchange')!.state});start.conditions.maxPlies=0;
    const {path}=run(start);expect(auditJournal(path).status).toBe('complete');
    const records=readJournal(path).payloads as JournalRecord[],s=records[0] as StartRecord;
    s.initialState.positionHistory![2].gaveCheck=!s.initialState.positionHistory![2].gaveCheck;
    expect(auditJournal(rewrite(records)).status).toBe('corrupt');
  });
  it('validates the starting snapshot even when there are no preceding moves',()=>{
    const start=fixtureStart();start.initialState.positionSnapshots![0].turn='gote';
    expect(()=>run(start)).toThrow(/snapshot/);
  });
  it('refuses same-name output without overwriting the original',()=>{
    const {path}=run(),before=readFileSync(path);expect(()=>run(fixtureStart(),path)).toThrow(/EEXIST/);expect(readFileSync(path)).toEqual(before);
  });
  it('deduplicates identical journals and rejects conflicting game identities',()=>{
    const {path}=run();const copy=file('copy');writeFileSync(copy,readFileSync(path));
    expect(aggregateJournals([path,path,copy]).counts.games).toBe(1);
    const other=run(fixtureStart());expect(()=>aggregateJournals([path,other.path])).toThrow(/conflicting/);
  });
  it('keeps unpaired results separate, distinguishes not-run, and regenerates identical summaries/reports twice',()=>{
    const first=fixtureStart(),second=fixtureStart({gameId:'fixture-2',seats:{sente:'experimental',gote:'legacy'}});
    const a=run(first),before=sha256(readFileSync(a.path));
    const incomplete=aggregateJournals([a.path],[first,second]);expect(incomplete.counts.notRun).toBe(1);expect(incomplete.completedPairs).toBe(0);expect(incomplete.pairedCounts.games).toBe(0);
    const b=run(second),one=aggregateJournals([a.path,b.path],[first,second]),two=aggregateJournals([b.path,a.path],[first,second]);
    expect(one.completedPairs).toBe(1);expect(one.counts.maxPlies).toBe(2);expect(one.counts.ruleDraws).toBe(0);
    expect(two).toEqual(one);expect(reportSummary(two)).toBe(reportSummary(one));expect(sha256(readFileSync(a.path))).toBe(before);
    writeFileSync(join(dir,'reaggregate-summary.json'),JSON.stringify(one,null,2)+'\n');
  });
  it('excludes an interrupted half-pair and refuses unexchanged seats',()=>{
    const first=fixtureStart(),second=fixtureStart({gameId:'fixture-2',seats:{sente:'experimental',gote:'legacy'}});first.conditions.stopAfter=second.conditions.stopAfter=2;
    const a=run(first),b=run(second);expect(aggregateJournals([a.path,b.path]).completedPairs).toBe(0);
    second.seats=first.seats;const c=run(second);expect(()=>aggregateJournals([a.path,c.path])).toThrow(/seats/);
  });
});
