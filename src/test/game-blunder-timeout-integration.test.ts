import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {completedTimedIteration} from '../../scripts/benchmarks/gameBlunderFixed';
import type {TimeLimitedIterativeDeepeningAlphaBetaSearchResult} from '../domain/shogi/twoPlyAlphaBetaAi';

describe('completed iteration vs later deadline',()=>{
  const records=readFileSync('docs/benchmarks/game-blunder-investigation-20261030/observations.jsonl','utf8').trim().split('\n').map(s=>JSON.parse(s));
  const timed=records.filter(r=>r.type==='timed');
  it('retains only a self-consistent finite completed iteration',()=>{
    expect(timed).toHaveLength(24);
    expect(timed.every(r=>completedTimedIteration(r.result).status==='completed-with-later-deadline')).toBe(true);
  });
  it('refuses partial root and mismatched completed depth or score',()=>{
    const r=timed[0].result as TimeLimitedIterativeDeepeningAlphaBetaSearchResult;
    expect(completedTimedIteration({...r,resultSource:'partial-root'}).status).toBe('unusable');
    expect(completedTimedIteration({...r,completedDepth:r.completedDepth+1}).status).toBe('unusable');
    expect(completedTimedIteration({...r,selectedEvaluation:Infinity}).status).toBe('unusable');
  });
});
