/** Serial, exclusive-output 1000ms comparison. The child itself commits every ply. */
import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, platform, arch } from 'node:os';
import { gzipSync } from 'node:zlib';
import { analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { JournalWriter, JournalWriteError, CapacityError, parse, stringify, sha256 } from './benchmarks/journalIO';
import { aggregateJournals, reportSummary, runJournalGame, validateStart, type StartRecord, type Conditions } from './benchmarks/matchJournal';

interface Plan {
  schema: 1; runId: string; sourceSha: string; createdAt: string;
  previousPlanHash: string; conditions: Conditions; games: StartRecord[];
}
const [command, directory, extra] = process.argv.slice(2), dir = resolve(directory ?? '.');
const planPath = resolve(dir, 'plan.json');
const sources = () => [...new Set([
  ...execFileSync('git', ['ls-files','src/domain','src/types','src/application','scripts/benchmarks'], { encoding: 'utf8' }).trim().split('\n'),
  'scripts/benchmarks/journalIO.ts','scripts/benchmarks/matchJournal.ts','scripts/measure-match-journal.ts',
  'scripts/seal-match-journal.ts','scripts/replay-match-journals.ts','package.json','package-lock.json','tsconfig.json',
])].sort();
const sourceBytes = (path: string) => readFileSync(path, 'utf8').replaceAll('\r\n','\n');
const environment = () => ({ node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown' });
const readPlan = () => {
  const plan = parse<Plan>(readFileSync(planPath,'utf8'));
  assert.equal(plan.schema, 1); assert.equal(plan.games.length, 4);
  assert.equal(new Set(plan.games.map(g => g.gameId)).size, 4);
  for (const game of plan.games) {
    validateStart(game); assert.equal(game.runId, plan.runId); assert.equal(game.sourceSha, plan.sourceSha);
    assert.deepEqual(game.conditions, plan.conditions);
  }
  return plan;
};

if (command === 'prepare') {
  assert.ok(directory, 'prepare NEW_DIR');
  const previousPath = 'docs/benchmarks/piece-safety-20261025/run2/plan.json';
  const previousBytes = readFileSync(previousPath), previous = JSON.parse(previousBytes.toString());
  const sourceSha = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  assert.equal(execFileSync('git',['status','--porcelain','--','src/domain','src/types','src/application','scripts/benchmarks',
    'scripts/measure-match-journal.ts','scripts/replay-match-journals.ts','scripts/seal-match-journal.ts','package.json','package-lock.json','tsconfig.json'],
    {encoding:'utf8'}).trim(),'','commit the measured sources before prepare');
  const conditions: Conditions = { timeMs: 1000, depth: 4, options: previous.opts, maxPlies: 120,
    gameMs: 290000, hardGameMs: 300000, runMs: 1320000, maxBytes: 16*1024*1024, reserveBytes: 65536, stopAfter: null };
  assert.deepEqual(previous.tasks.filter((t: { stage: string; limit: number }) => t.stage === 'match' && t.limit === 1000),
    [{stage:'match',id:'hirate',limit:1000,maxPlies:120},{stage:'match',id:'replay',limit:1000,maxPlies:120}]);
  const runId = 'journal-' + randomUUID(), createdAt = new Date().toISOString();
  const sourceHashes = Object.fromEntries(sources().map(f => [f, sha256(sourceBytes(f))]));
  const games: StartRecord[] = ['hirate','replay'].flatMap(pairId => [1,2].map(n => ({
    type: 'start' as const, runId, pairId, gameId: `${pairId}-${n}`, sourceSha, sourceHashes, conditions,
    seats: { sente: n === 1 ? 'legacy' as const : 'experimental' as const, gote: n === 1 ? 'experimental' as const : 'legacy' as const },
    initialState: previous.matches.find((m: { id: string }) => m.id === pairId).state,
    startedAt: createdAt, environment: environment(),
  })));
  games.forEach(validateStart);
  const plan: Plan = { schema: 1,runId,sourceSha,createdAt,previousPlanHash:sha256(previousBytes),conditions,games };
  const snapshots = Object.entries(sourceHashes).map(([source]) => ({source,bytes:gzipSync(sourceBytes(source))}));
  assert.ok(snapshots.reduce((total,s) => total+s.bytes.length,Buffer.byteLength(stringify(plan))) <= 4*1024*1024,'plan/source capacity');
  mkdirSync(dir, { recursive: false });
  for (const {source,bytes} of snapshots) {
    const out = resolve(dir,'sources',source + '.gz'); mkdirSync(dirname(out),{recursive:true});
    writeFileSync(out,bytes,{flag:'wx'});
  }
  writeFileSync(planPath,stringify(plan),{flag:'wx'});
  console.log(JSON.stringify({runId,sourceSha,games:games.length,conditions}));
} else if (command === 'child') {
  const plan = readPlan(), game = plan.games.find(g => g.gameId === extra); assert.ok(game);
  for (const [f,h] of Object.entries(game.sourceHashes)) assert.equal(sha256(sourceBytes(f)),h,'changed source: '+f);
  const start = { ...game, startedAt: new Date().toISOString(), environment: environment() };
  const writer = new JournalWriter(resolve(dir,game.gameId+'.jsonl'),game.conditions.maxBytes,game.conditions.reserveBytes);
  try {
    const result = runJournalGame(start,writer,(state,mode) => {
      const before = performance.now();
      const observation = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state,game.conditions.depth,game.conditions.timeMs,
        {pieceSafetyMode:mode},() => performance.now(),game.conditions.options);
      return {...observation,actualElapsedMilliseconds:performance.now()-before};
    }, undefined, ply => { if (ply % 10 === 0) process.send?.({type:'progress',gameId:game.gameId,ply}); });
    process.send?.({type:'done',gameId:game.gameId,reason:result.end.reason,plies:result.end.plies,
      wallMs:result.wallMs,saveMs:result.saveMs,bytes:result.bytes});
    if (!['rule','max_plies'].includes(result.end.reason)) process.exitCode = 1;
  } catch (error) {
    process.send?.({type:'failure',gameId:game.gameId,reason:error instanceof JournalWriteError ? 'storage_failure' : error instanceof CapacityError ? 'capacity' : 'execution_failure',
      message:error instanceof Error ? error.message : String(error),cause:error instanceof Error && error.cause instanceof Error ? error.cause.message : null});
    process.exitCode=1;
  } finally { writer.close(); }
} else if (command === 'run') {
  const plan = readPlan();
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),plan.sourceSha,'HEAD changed since prepare');
  for (const [f,h] of Object.entries(plan.games[0].sourceHashes)) assert.equal(sha256(sourceBytes(f)),h,'source changed: '+f);
  // Never resume/overwrite a run, even if its supervisor died before game 1.
  const log = new JournalWriter(resolve(dir,'supervisor.jsonl'),1024*1024);
  const began = performance.now();
  try {
    log.append({type:'run-start',runId:plan.runId,at:new Date().toISOString(),planHash:sha256(readFileSync(planPath))});
    for (const game of plan.games) {
      if (performance.now()-began >= plan.conditions.runMs) { log.append({type:'run-time-limit',notStarted:game.gameId}); process.exitCode=1; break; }
      assert.ok(!existsSync(resolve(dir,game.gameId+'.jsonl')),'existing game journal');
      await new Promise<void>((done,reject) => {
        const beganGame = performance.now(); let stderr = '', killed = false, doneMessage: unknown = null, failure: unknown = null;
        const child = fork(fileURLToPath(import.meta.url),['child',dir,game.gameId],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc']});
        const timer = setTimeout(() => { killed=true; child.kill('SIGKILL'); }, Math.min(plan.conditions.hardGameMs,plan.conditions.runMs-(performance.now()-began)));
        child.stderr?.on('data',b => { stderr=(stderr+String(b)).slice(-16000); });
        child.on('message',(message: {type: string}) => {
          if (message.type === 'progress') console.log(JSON.stringify(message));
          if (message.type === 'done') doneMessage=message;
          if (message.type === 'failure') failure=message;
        });
        child.once('error',error => { clearTimeout(timer); reject(error); });
        child.once('exit',(code,signal) => {
          clearTimeout(timer);
          try {
            log.append({type:'game-exit',gameId:game.gameId,code,signal,killed,stderr,failure,done:doneMessage,wallMs:performance.now()-beganGame});
            console.log(JSON.stringify({gameId:game.gameId,code,killed,done:doneMessage}));
            if (code !== 0 || !doneMessage) process.exitCode=1;
            done();
          } catch(error) { reject(error); }
        });
      });
    }
    log.append({type:'run-end',at:new Date().toISOString(),wallMs:performance.now()-began,exitCode:process.exitCode??0},true);
  } finally { log.close(); }
} else if (command === 'audit') {
  assert.ok(extra, 'audit RUN_DIR NEW_OUTPUT_DIR');
  const plan = readPlan(), out = resolve(extra);
  const paths = plan.games.map(g => resolve(dir,g.gameId+'.jsonl')).filter(existsSync);
  const summary = aggregateJournals(paths,plan.games);
  // Binding to the frozen plan is additional to standalone journal replay.
  const { auditJournal } = await import('./benchmarks/matchJournal');
  for (const path of paths) {
    const audit = auditJournal(path);
    if (!audit.start) continue;
    const intended = plan.games.find(g => g.gameId === audit.start!.gameId); assert.ok(intended);
    assert.deepEqual({...audit.start,startedAt:intended.startedAt,environment:intended.environment},intended,'journal differs from frozen plan');
  }
  mkdirSync(out,{recursive:false});
  writeFileSync(resolve(out,'summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
  writeFileSync(resolve(out,'report.md'),reportSummary(summary),{flag:'wx'});
  console.log(JSON.stringify({counts:summary.counts,completedPairs:summary.completedPairs,summaryHash:sha256(readFileSync(resolve(out,'summary.json')))}));
  if (summary.counts.corrupt || summary.counts.incomplete || summary.counts.notRun || summary.completedPairs !== 2) process.exitCode=1;
} else throw Error('prepare NEW_DIR | run RUN_DIR | audit RUN_DIR NEW_OUTPUT_DIR');
