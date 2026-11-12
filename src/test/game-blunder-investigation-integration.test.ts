import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {summarize} from '../../scripts/summarize-blunder-investigation';
import {sha256} from '../../scripts/benchmarks/journalIO';

describe('game journal investigation saved evidence integration',()=>{
  it('recomputes the saved summary deterministically and preserves original hashes',()=>{
    const dir='docs/benchmarks/game-blunder-investigation-20261030/';
    const raw=readFileSync(dir+'observations.jsonl','utf8');
    const expected=JSON.parse(readFileSync(dir+'summary.json','utf8'));
    expect(summarize(raw)).toEqual(expected);expect(summarize(raw)).toEqual(summarize(raw));
    expect(expected.timed.count).toBe(24);expect(expected.fixed.calls).toBe(32);
    expect(expected.journals.map((p:string)=>sha256(readFileSync(p)))).toEqual(expected.journalHashes);
  });
  it('refuses truncated or altered completion status',()=>{
    const dir='docs/benchmarks/game-blunder-investigation-20261030/';
    const raw=readFileSync(dir+'observations.jsonl','utf8');
    expect(()=>summarize(raw.replace('"unchanged":true','"unchanged":false'))).toThrow();
  });
});
