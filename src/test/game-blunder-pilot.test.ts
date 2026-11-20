import { describe, it, expect } from 'vitest';
import { capturedNext, extract } from '../../scripts/benchmarks/gameBlunderPilot';
import type { MoveRecord } from '../../scripts/benchmarks/matchJournal';

const move = (to: {row:number;col:number}, kind: 'move' | 'drop' = 'move') => ({action:{kind,to}} as MoveRecord);
describe('game blunder pilot', () => {
  it('uses next-ply capture as a trigger, not any unrelated move or drop', () => {
    const first=move({row:3,col:4});
    expect(capturedNext(first,move({row:3,col:4}))).toBe(true);
    expect(capturedNext(first,move({row:3,col:5}))).toBe(false);
    expect(capturedNext(first,move({row:3,col:4},'drop'))).toBe(false);
    expect(capturedNext(first,undefined)).toBe(false);
  });
  it('excludes incomplete and corrupt journals', () => {
    const base='docs/benchmarks/match-journal-20261026/fault-fixtures-final/';
    const result=extract([base+'4-killed.jsonl',base+'8-corrupt.jsonl']);
    expect(result.games.every(g=>g.audit.status !== 'complete')).toBe(true);
    expect(result.candidates).toEqual([]);
  });
});
