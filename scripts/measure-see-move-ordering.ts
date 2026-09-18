// Reference timings, never a CI threshold: npx tsx scripts/measure-see-move-ordering.ts
import assert from 'node:assert/strict';
import { analyzeAlphaBetaSearch } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { createInitialBoardState, type PieceType, type Player } from '../src/types/shogi';

// Same position as moveOrderingBenefitState in shogi-two-ply-minimax-ai.test.ts.
const tactical = createInitialBoardState();
for (const row of tactical.squares) for (const square of row) square.piece = null;
const placements: [number, number, PieceType, Player][] = [
  [8, 8, 'king', 'sente'], [0, 8, 'king', 'gote'], [4, 4, 'rook', 'sente'],
  [3, 4, 'pawn', 'gote'], [4, 5, 'silver', 'gote'], [4, 6, 'rook', 'gote'],
  [5, 4, 'pawn', 'sente'],
];
for (const [row, col, type, player] of placements) {
  tactical.squares[row][col].piece = { id: `${player}-${type}-${row}-${col}`, type, player };
}
const results = [ ['initial', createInitialBoardState()], ['moveOrderingBenefitState', tactical] ] as const;
console.log(JSON.stringify({ node: process.version, depth: 3, warmups: 3, samples: 7,
  positions: results.map(([name, state]) => {
    const before = structuredClone(state);
    for (let i = 0; i < 3; i++) analyzeAlphaBetaSearch(state, 3);
    const runs = Array.from({ length: 7 }, () => analyzeAlphaBetaSearch(state, 3));
    const reference = { ...runs[0], elapsedMilliseconds: 0 };
    for (const run of runs) assert.deepEqual({ ...run, elapsedMilliseconds: 0 }, reference);
    assert.deepEqual(state, before);
    const times = runs.map((run) => run.elapsedMilliseconds).sort((a, b) => a - b);
    return { name, result: reference, medianMilliseconds: times[3], times };
  }),
}, null, 2));
