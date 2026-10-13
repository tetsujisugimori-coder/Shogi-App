import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createInitialBoardState, type BoardState } from '../src/types/shogi';
import { executeLegalAction, getLegalActions } from '../src/domain/shogi/legalActions';
import { hasLegalResponse } from '../src/domain/shogi/checkmate';
import { analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { TIME_LIMIT_STRESS_POSITIONS } from './benchmarks/timeLimitStressPositions';
import { QUIESCENCE_BENCHMARK_POSITIONS } from './benchmarks/quiescencePositions';

const [mode, fixturePath, outputPath, label] = process.argv.slice(2);
const encode = (value: unknown) => JSON.stringify(value, (_key, v) => typeof v === 'number' && !Number.isFinite(v) ? String(v) : v);
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
if (mode === 'generate') {
  const sparse = createInitialBoardState();
  const pieces = sparse.squares.flat().flatMap(s=>s.piece?[s.piece]:[]);
  sparse.squares.forEach(row=>row.forEach(s=>{s.piece=null;}));
  for (const [type,player,row,col] of [['king','sente',8,0],['king','gote',0,8],['rook','gote',6,1],['gold','gote',5,0]] as const) {
    const index=pieces.findIndex(p=>p.type===type && p.player===player);
    sparse.squares[row][col].piece=pieces.splice(index,1)[0];
  }
  sparse.senteHand=[]; sparse.goteHand=pieces.map(p=>({...p,player:'gote' as const}));
  sparse.positionHistory=[]; sparse.positionSnapshots=[];
  const cases = [
    {id:'opening', provenance:'hirate', state:createInitialBoardState()},
    {id:'middle', provenance:'saved legal self-play, 50 plies', state:TIME_LIMIT_STRESS_POSITIONS[0].create()},
    {id:'many-hands', provenance:'saved legal self-play, 98 plies', state:TIME_LIMIT_STRESS_POSITIONS[1].create()},
    {id:'few-responses', provenance:'constructed 40-piece position, sente king has one escape; not proven from hirate', state:sparse},
    {id:'in-check', provenance:'existing sparse gold-drop-evasion fixture; not a full hirate game', state:QUIESCENCE_BENCHMARK_POSITIONS.find(p=>p.id==='gold-drop-evasion')!.create()},
  ];
  const json=JSON.stringify(cases);
  fs.writeFileSync(fixturePath,gzipSync(json));
  console.log(encode({fixtureSha256:hash(json),bytes:json.length,cases:cases.map(c=>({id:c.id,actions:getLegalActions(c.state).length,hands:c.state.senteHand.length+c.state.goteHand.length,status:c.state.status}))}));
} else if (mode === 'audit') {
  const json=gunzipSync(fs.readFileSync(fixturePath)).toString('utf8');
  const cases=JSON.parse(json) as {id:string;state:BoardState}[];
  const rows=cases.map(c=>{
    const original=JSON.stringify(c.state);
    const actions=getLegalActions(c.state);
    const applied=crypto.createHash('sha256');
    for(const action of actions) {
      const result=executeLegalAction(c.state,action);
      if(result.type!=='applied') throw new Error('Rejected generated action');
      applied.update(encode(result.state));
    }
    if(JSON.stringify(c.state)!==original) throw new Error('Input mutated');
    return {case:c.id,actions:actions.length,legalActionSha256:hash(encode(actions)),allAppliedStatesSha256:applied.digest('hex')};
  });
  fs.writeFileSync(outputPath,encode({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),fixtureSha256:hash(json),rows}));
  console.log('Complete legal-action order and every applied child audited');
} else if (mode === 'measure') {
  const json=gunzipSync(fs.readFileSync(fixturePath)).toString('utf8');
  const cases=(JSON.parse(json) as {id:string;state:BoardState;provenance:string}[])
    .filter(c=>!process.env.REVIEW_CASE || c.id===process.env.REVIEW_CASE);
  const rows: unknown[]=[];
  const warmups=Number(process.env.REVIEW_WARMUPS??2), repetitions=Number(process.env.REVIEW_REPETITIONS??5), batch=100;
  const metadata={label,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceTree:execFileSync('git',['rev-parse','HEAD:src'],{encoding:'utf8'}).trim(),node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0].model,cpuCount:os.cpus().length,fixtureSha256:hash(json),warmups,repetitions,microBatch:batch,depth:2,maxDepth:4,options:{moveOrdering:'standard',quiescence:'disabled',killerMoves:false},startedAt:new Date().toISOString()};
  for (const c of cases) {
    const frozen=JSON.stringify(c.state);
    const actions=getLegalActions(c.state);
    const board=actions.find(a=>a.kind==='move');
    const drop=actions.find(a=>a.kind==='drop');
    const responseState=board?executeLegalAction(c.state,board):drop?executeLegalAction(c.state,drop):null;
    for (const kind of ['move','drop','response'] as const) {
      const action=kind==='move'?board:drop;
      if (kind!=='response' && !action) continue;
      if (kind==='response' && responseState?.type!=='applied') continue;
      for(let sample=-warmups;sample<repetitions;sample++) {
        let observation: unknown;
        const start=performance.now();
        for(let i=0;i<batch;i++) {
          if(kind==='response' && responseState?.type==='applied') observation=hasLegalResponse(responseState.state,responseState.state.turn);
          else if(action) { const result=executeLegalAction(c.state,action); if(result.type!=='applied') throw new Error('Rejected fixture action'); observation={status:result.state.status,result:result.state.result}; }
        }
        const elapsed=performance.now()-start;
        if(sample>=0) rows.push({case:c.id,kind,sample,elapsedMilliseconds:elapsed,batch,perCallMilliseconds:elapsed/batch,observation});
      }
    }
    for(const kind of ['fixed','100ms','1000ms'] as const) {
      for(let sample=-warmups;sample<repetitions;sample++) {
        const start=performance.now();
        const result=kind==='fixed'?analyzeAlphaBetaSearch(c.state,2):analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(c.state,4,kind==='100ms'?100:1000);
        const wall=performance.now()-start;
        if(sample>=0) rows.push({case:c.id,kind,sample,wallMilliseconds:wall,apiMilliseconds:result.elapsedMilliseconds,depth:result.depth,visited:result.visitedPositionCount,totalVisited:'totalVisitedPositionCount' in result?result.totalVisitedPositionCount:result.visitedPositionCount,source:'resultSource' in result?result.resultSource:'fixed',timedOut:'timedOut' in result?result.timedOut:false,excessMilliseconds:kind==='fixed'?null:Math.max(0,wall-(kind==='100ms'?100:1000)),signature:hash(encode({action:result.selectedAction,evaluation:result.selectedEvaluation,breakdown:result.evaluationBreakdown,pv:result.principalVariation,visited:result.visitedPositionCount}))});
      }
    }
    if(JSON.stringify(c.state)!==frozen) throw new Error('Input mutated');
    fs.writeFileSync(outputPath,encode({metadata,rows}));
    console.log(`${label}: ${c.id} complete (${actions.length} root actions)`);
  }
} else throw new Error('Usage: tsx scripts/measure-no-legal-review.ts generate|measure fixtures.json.gz output.json label');
