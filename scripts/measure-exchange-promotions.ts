// Reuses the SEE deadline runner's serial child/watchdog approach and existing fixtures.
import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import * as candidate from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { evaluateSearchPositionBreakdown } from '../src/domain/shogi/twoPlyMinimaxAi';
import { executeLegalAction, getLegalActions } from '../src/domain/shogi/legalActions';
import { SearchDiagnostics } from '../src/domain/shogi/searchDiagnostics';
import { exchangePositions } from './benchmarks/exchangePositions';

const [mode, baselinePath, output] = process.argv.slice(2);
const baseHead = '376bcba';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sources = ['src/domain/shogi/quiescenceSearch.ts','src/domain/shogi/twoPlyAlphaBetaAi.ts',
  'src/domain/shogi/staticExchangeEvaluation.ts','scripts/benchmarks/exchangePositions.ts',
  'scripts/benchmarks/checkEvasionReference.ts','scripts/measure-exchange-promotions.ts'];
if (mode === 'child') {
  const baseline: typeof candidate = await import(pathToFileURL(resolve(baselinePath,'src/domain/shogi/twoPlyAlphaBetaAi.ts')).href);
  const positions = exchangePositions();
  const variants = ['before','off','on'] as const;
  for (const p of positions) {
    const saved = JSON.stringify(p.state);
    // Fixed d1 OFF must equal the actual baseline, including counters/PV/breakdown.
    for (const ordering of ['standard','static-exchange'] as const) {
      const options = {moveOrdering:ordering,quiescence:{maxTacticalDepth:1,moveOrdering:'original' as const}};
      const old = baseline.analyzeAlphaBetaSearch(p.state,1,undefined,undefined,options);
      const off = candidate.analyzeAlphaBetaSearch(p.state,1,undefined,undefined,{...options,quiescence:{...options.quiescence,includeQuietPromotions:false}});
      const strip = ({elapsedMilliseconds: _ms,...r}: typeof old) => r;
      assert.deepEqual(strip(off),strip(old));
      process.send?.({type:'compatibility',id:p.id,ordering,passed:true});
      for (const limit of [null,100,1000]) {
        for (let run = 0; run < 4; run++) {
          const order = run % 2 ? ['on','before'] as const : ['before','on'] as const;
          for (const variant of limit === null ? variants : order) {
            const metadata = {id:p.id,ordering,variant,limit,run,phase:run===0?'warmup':'measurement'};
            process.send?.({type:'started',...metadata});
            const engine = variant === 'before' ? baseline : candidate;
            const opts = variant === 'before' ? options : {...options,quiescence:{...options.quiescence,includeQuietPromotions:variant==='on'}};
            const start = performance.now();
            const result = limit === null
              ? engine.analyzeAlphaBetaSearch(p.state,1,undefined,undefined,opts)
              : engine.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(p.state,4,limit,undefined,() => performance.now(),opts);
            const actualMilliseconds = performance.now()-start;
            let leaf = p.state;
            for (const a of result.principalVariation) {
              assert.ok(getLegalActions(leaf).some(x => JSON.stringify(x)===JSON.stringify(a)));
              const next = executeLegalAction(leaf,a); assert.equal(next.type,'applied');
              if (next.type==='applied') leaf=next.state;
            }
            if (result.evaluationBreakdown) assert.deepEqual(result.evaluationBreakdown,evaluateSearchPositionBreakdown(leaf,p.state.turn));
            assert.equal(JSON.stringify(p.state),saved);
            process.send?.({type:'sample',...metadata,actualMilliseconds,result});
          }
        }
      }
      // Separate instrumented d2 probes: timing samples above have diagnostics OFF.
      for (const variant of ['before','on'] as const) {
        process.send?.({type:'started',id:p.id,ordering,variant,phase:'diagnostic'});
        const diagnostics = new SearchDiagnostics();
        const engine = variant === 'before' ? baseline : candidate;
        const diagnosticOptions = variant === 'before' ? options :
          {...options,quiescence:{...options.quiescence,includeQuietPromotions:true}};
        const result = engine.analyzeAlphaBetaSearch(p.state,2,undefined,undefined,diagnosticOptions,diagnostics);
        process.send?.({type:'diagnostic',id:p.id,ordering,variant,seeCalls:diagnostics.phases.see.calls,result});
      }
    }
  }
  process.send?.({type:'end',finishedAt:new Date().toISOString()});
} else {
  assert.equal(mode,'run'); assert.ok(baselinePath && output,'run BASELINE_DIR NEW_OUTPUT_DIR');
  mkdirSync(output,{recursive:false});
  const emitFd = openSync(resolve(output,'raw.jsonl'),'wx');
  const emit = (v: unknown) => writeSync(emitFd,JSON.stringify(v)+'\n');
  const sourceHashes = Object.fromEntries(sources.map(file => {
    const bytes=readFileSync(file); writeFileSync(resolve(output,file.replaceAll('/','__')+'.gz'),gzipSync(bytes));
    return [file,hash(bytes)];
  }));
  // Preserve exact baseline tree, full input histories, and candidate source bytes.
  const archive = execFileSync('git',['archive',baseHead,'src'],{maxBuffer:20*1024*1024});
  writeFileSync(resolve(output,'baseline-src.tar.gz'),gzipSync(archive));
  emit({type:'config',baseHead:execFileSync('git',['rev-parse',baseHead],{encoding:'utf8'}).trim(),sourceHashes,
    baselineArchiveSha256:hash(archive),node:process.version,os:`${platform()} ${release()}`,cpu:cpus()[0]?.model,
    startedAt:new Date().toISOString(),repeats:3,warmups:1,maxDepth:4,qDepth:1,extraEvasions:0,
    evaluation:'standard',killer:false,pvHint:false,tt:false,diagnostics:'OFF except separate d2 probes',
    counters:'completed iterations only; interrupted work excluded; seeCalls separate instrumented d2 ordering batches',
    watchdogMs:20000,globalMs:360000});
  for (const p of exchangePositions()) emit({type:'position',...p});
  const child=fork(fileURLToPath(import.meta.url),['child',resolve(baselinePath)],
    {execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc']});
  let pending: unknown=null, stderr='', ended=false;
  const stop = (reason: string) => {emit({type:'failure',reason,pending});child.kill();};
  let watchdog=setTimeout(() => stop('sample-watchdog'),20000);
  const global=setTimeout(() => stop('global-budget'),360000);
  child.stderr?.on('data',d => {stderr+=String(d);});
  child.on('message',(message: {type:string}) => {
    clearTimeout(watchdog);
    if(message.type==='started') pending=message; else {emit(message);pending=null;}
    if(message.type==='end') ended=true;
    watchdog=setTimeout(() => stop('sample-watchdog'),20000);
  });
  await new Promise<void>((done,reject) => {
    child.on('error',reject);
    child.on('exit',(code,signal) => {
      clearTimeout(watchdog);clearTimeout(global);emit({type:'exit',code,signal,stderr,ended});closeSync(emitFd);
      if(code!==0 || !ended) reject(new Error('Incomplete benchmark: see raw.jsonl')); else done();
    });
  });
}
