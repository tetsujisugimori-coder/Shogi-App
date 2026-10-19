import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { tacticalPositions, constructed, type TacticalPosition } from './benchmarks/tacticalPositions';
import { CONDITIONS, options, validatePosition, reference, validateResult, summarize, apply,
  json, parse, hash, verifyReference, type Condition, type Result, type Sample, type Reference } from './benchmarks/tacticalDiagnostics';
import { analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { resolveSearchEvaluationPreset } from '../src/domain/shogi/searchEvaluationPresets';
import { evaluateSearchPositionBreakdown } from '../src/domain/shogi/twoPlyMinimaxAi';
import { protectSearchInput } from '../src/domain/shogi/selfPlayGame';
import type { LegalAction } from '../src/domain/shogi/legalActions';
const [mode, outArg] = process.argv.slice(2);
const git = (args: string[]) => execFileSync('git',args,{encoding:'utf8'}).trim();
const preset = resolveSearchEvaluationPreset('standard');
if (mode === 'child') {
  const { p, c, phase, probe } = parse(readFileSync(0,'utf8')) as { p:TacticalPosition;c:Condition;phase:Sample['phase'];probe?:boolean };
  const input = protectSearchInput(p.state); const before = hash(p.state);
  if (probe) {
    const scores: { action:LegalAction;score:number;pv:LegalAction[] }[] = [];
    for (const a of (await import('../src/domain/shogi/legalActions')).getLegalActions(input.snapshot)) {
      const child = apply(input.snapshot,a);
      const r = child.status==='ended' ? null : analyzeAlphaBetaSearch(child,3,preset,undefined,options(1));
      scores.push({ action:a, score:r ? -r.selectedEvaluation! : evaluateSearchPositionBreakdown(child,p.state.turn,preset).total,
        pv:[a,...(r?.principalVariation??[])] });
    }
    const select = (xs: typeof scores) => xs.reduce((best,x)=>x.score>best.score?x:best);
    assert.equal(hash(p.state),before); assert.ok(!input.wasMutated());
    process.stdout.write(json({ depth:4,q:1,scores, originalTieSelection:select(scores), reversedTieSelection:select([...scores].reverse()),
      interpretation:'independent original/reversed first-maximum reduction of separately searched root scores; not a changed production search order' }));
  } else {
    // Warm this same process before the measured call, outside its clock interval.
    const warmState=constructed('child-warmup',[[8,8,'king','sente'],[0,0,'king','gote']]);
    const warmStart=performance.now();
    const warmResult=analyzeAlphaBetaSearch(warmState,1,preset,undefined,options(c.q));
    const processWarmup={depth:1,q:c.q,callMs:performance.now()-warmStart,apiMs:warmResult.elapsedMilliseconds};
    const start = performance.now();
    const result: Result = c.budget===null ? analyzeAlphaBetaSearch(input.snapshot,c.depth,preset,undefined,options(c.q))
      : analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(input.snapshot,c.depth,c.budget,preset,undefined,options(c.q));
    const callMs = performance.now()-start;
    assert.ok(!input.wasMutated()); assert.equal(hash(p.state),before);
    try { validateResult(p,c,result); } catch (e) {
      process.stdout.write(json({position:p.id,condition:c.id,phase,result:null,rejectedResult:result,rejectedApiMs:result.elapsedMilliseconds,
        callMs,apiMs:null,overrunMs:c.budget===null?null:Math.max(0,callMs-c.budget),status:'error',error:String(e),processWarmup}));
      process.exit(0);
    }
    process.stdout.write(json({position:p.id,condition:c.id,phase,result,callMs,apiMs:result.elapsedMilliseconds,
      overrunMs:c.budget===null?null:Math.max(0,callMs-c.budget),status:'ok',processWarmup}));
  }
} else {
  assert.ok(outArg && ['prepare','run','audit','probe'].includes(mode), 'prepare NEW_DIR | run DIR | audit DIR | probe DIR');
  const out = path.resolve(outArg);
  const write = (name:string,v:unknown) => writeFileSync(path.join(out,name),json(v)+'\n',{flag:'wx'});
  const read = (name:string) => parse(readFileSync(path.join(out,name),'utf8'));
  if (mode === 'prepare') {
    mkdirSync(out); const positions=tacticalPositions();
    const validation=Object.fromEntries(positions.map(p=>[p.id,validatePosition(p)]));
    write('plan.json',{schema:1,createdAt:new Date().toISOString(),baseSha:git(['rev-parse','origin/main']),
      conditions:CONDITIONS, options:options(1),preset:'standard',positions,validation,
      positionHash:hash(positions),referenceLimits:{nodes:60000,ms:8000},hardStopMs:15000,
      repetitions:1,warmup:'one independent sparse-kings call per condition, separate warmup.jsonl; additionally every measurement child performs d1/q(condition) sparse-kings warmup before the API clock, saved as processWarmup',
      supplementalProbe:'mixed-distance/resistance only: independently search every child at d3/q1, negate opponent-root score; original/reversed first-maximum reduction; not a production ordering change',
      order:'serial position-major then condition order, one sample each; no tests/build/other performance work',
      stopRule:'exactly ten positions/six conditions; no post-outcome expansion; hard stops remain unverified',
      referenceDefinition:'ply includes root action; attacker existential over ALL legal moves, defender universal; minimal proven horizon; no-force-within-bound is not absence of mate; 3-ply fixture may have quiet first move (not a continuous-check tsume problem)'});
    const refs = Object.fromEntries(positions.map(p=>[p.id,reference(p)])); write('references.json',refs);
    console.log('Frozen positions/settings and independent bounded reference.');
  } else {
    const plan=read('plan.json'); const positions=plan.positions as TacticalPosition[];
    assert.deepEqual(plan.conditions,CONDITIONS); assert.equal(plan.positionHash,hash(positions));
    assert.deepEqual(positions,tacticalPositions());
    for (const p of positions) assert.deepEqual(validatePosition(p),plan.validation[p.id]);
    const refs=read('references.json') as Record<string,Reference>;
    for (const p of positions) verifyReference(p,refs[p.id]);
    const call = (p:TacticalPosition,c:Condition,phase:Sample['phase'],probe=false) => {
      const start=performance.now();
      const child=spawnSync(process.execPath,['--import','tsx',path.resolve('scripts/measure-tactical-diagnostics.ts'),'child'],
        {input:json({p,c,phase,probe}),encoding:'utf8',timeout:plan.hardStopMs,maxBuffer:16*1024*1024,windowsHide:true});
      if (child.status===0) return parse(child.stdout);
      return {position:p.id,condition:c.id,phase,result:null,callMs:null,apiMs:null,
        overrunMs:null,status:(child.error as NodeJS.ErrnoException)?.code==='ETIMEDOUT'?'hard-stop':'error',
        error:String(child.error??child.stderr),parentWallMs:performance.now()-start};
    };
    if (mode==='run') {
      assert.ok(!existsSync(path.join(out,'environment.json')),'refuse rerun into existing measurements');
      assert.equal(git(['diff','--name-only']), ''); assert.equal(git(['diff','--cached','--name-only']),'');
      write('environment.json',{startedAt:new Date().toISOString(),sha:git(['rev-parse','HEAD']),status:git(['status','--porcelain']),
        node:process.version,platform:`${os.platform()} ${os.release()} ${os.arch()}`,cpu:os.cpus()[0].model,
        planHash:hash(plan),referencesHash:hash(refs),clock:'performance.now; undefined engine clock; no diagnostics hooks',
        sourceHashes:Object.fromEntries(['scripts/benchmarks/tacticalDiagnostics.ts','scripts/benchmarks/tacticalPositions.ts','scripts/measure-tactical-diagnostics.ts',
          'src/domain/shogi/twoPlyAlphaBetaAi.ts','src/domain/shogi/twoPlyMinimaxAi.ts','src/domain/shogi/quiescenceSearch.ts'].map(f=>[f,hash(readFileSync(f,'utf8'))]))});
      const warm = { ...positions[0],id:'warmup',state:constructed('warmup',[[8,8,'king','sente'],[0,0,'king','gote']]) };
      for (const c of CONDITIONS) appendFileSync(path.join(out,'warmup.jsonl'),json(call(warm,c,'warmup'))+'\n');
      for (const p of positions) for (const c of CONDITIONS) {
        const row=call(p,c,'measurement'); appendFileSync(path.join(out,'raw.jsonl'),json(row)+'\n');
        console.log(p.id,c.id,row.status);
      }
      write('completed.json',{finishedAt:new Date().toISOString(),samples:positions.length*CONDITIONS.length});
    } else if (mode==='probe') {
      // Predeclared diagnostic on mixed distances, not extra timing samples.
      for (const id of ['mixed-distance','resistance']) write(`candidate-probe-${id}.json`,call(positions.find(p=>p.id===id)!,CONDITIONS[3],'measurement',true));
    } else {
      const env=read('environment.json'); assert.equal(env.planHash,hash(plan)); assert.equal(env.referencesHash,hash(refs));
      const rows=readFileSync(path.join(out,'raw.jsonl'),'utf8').trim().split(/\r?\n/).map(parse) as Sample[];
      const summary=summarize(positions,refs,rows);
      if (existsSync(path.join(out,'summary.json'))) assert.deepEqual(read('summary.json'),summary); else write('summary.json',summary);
      console.log(`Audited ${summary.length} samples; regenerated summary from raw.`);
    }
  }
}
