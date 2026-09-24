import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { cloneBoardSquares } from '../src/domain/shogi/boardStateUtils';
import { getLegalDropSquares, validateDrop } from '../src/domain/shogi/dropRules';
import { getLegalActions } from '../src/domain/shogi/legalActions';
import { createInitialBoardState, type BoardState, type Piece } from '../src/types/shogi';
import { replayPositions, SOURCE } from './benchmarks/timedDepthOneDiagnostics';
import { ROOT_LEGAL_TARGETS } from './benchmarks/rootLegalTargets';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const piece = (id: string, type: Piece['type'], player: Piece['player'] = 'sente'): Piece => ({ id, type, player });

function stateWith(
  board: Array<{ row: number; col: number; piece: Piece }>,
  hand: Piece[],
): BoardState {
  const initial = createInitialBoardState();
  const squares = cloneBoardSquares(initial.squares);
  for (const row of squares) for (const square of row) square.piece = null;
  for (const item of board) squares[item.row][item.col].piece = { ...item.piece };
  return { ...initial, squares, senteHand: hand, turn: 'sente' };
}

const kings = [
  { row: 8, col: 4, piece: piece('king-s', 'king') },
  { row: 0, col: 8, piece: piece('king-g', 'king', 'gote') },
];
const cases: Array<{ id: string; state: BoardState }> = replayPositions(SOURCE, ROOT_LEGAL_TARGETS).positions
  .map(position => ({ id: position.id, state: position.state }));
cases.push(
  { id: 'nifu-dead-and-representative', state: stateWith([
    ...kings, { row: 5, col: 3, piece: piece('board-pawn', 'pawn') },
  ], [piece('pawn-z', 'pawn'), piece('pawn-a', 'pawn'), piece('knight', 'knight'), piece('lance', 'lance')]) },
  { id: 'check-response', state: stateWith([
    ...kings, { row: 0, col: 4, piece: piece('checking-rook', 'rook', 'gote') },
  ], [piece('blocking-gold', 'gold')]) },
  { id: 'pawn-drop-mate', state: stateWith([
    { row: 8, col: 4, piece: piece('king-s', 'king') },
    { row: 0, col: 4, piece: piece('king-g', 'king', 'gote') },
    { row: 2, col: 4, piece: piece('guard', 'gold') },
    { row: 0, col: 3, piece: piece('left-blocker', 'lance', 'gote') },
    { row: 0, col: 5, piece: piece('right-blocker', 'lance', 'gote') },
    { row: 1, col: 3, piece: piece('left-front', 'pawn', 'gote') },
    { row: 1, col: 5, piece: piece('right-front', 'pawn', 'gote') },
  ], [piece('mate-pawn', 'pawn')]) },
);

const rows = cases.map(({ id, state }) => {
  const before = JSON.stringify(state);
  const hands = state.turn === 'sente' ? state.senteHand : state.goteHand;
  const drops = hands.map(handPiece => {
    const results = Array.from({ length: 9 }, (_, row) =>
      Array.from({ length: 9 }, (_, col) => validateDrop(state, handPiece.id, { row, col }))).flat();
    const reasons: Record<string, number> = {};
    for (const result of results) if (!result.isValid) reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
    const legal = getLegalDropSquares(state, handPiece.id);
    assert.deepEqual(legal, results.flatMap((result, index) => result.isValid
      ? [{ row: Math.floor(index / 9), col: index % 9 }] : []));
    return { pieceId: handPiece.id, resultsSha256: hash(results), legalSquaresSha256: hash(legal),
      legalCount: legal.length, reasons };
  });
  const actions = getLegalActions(state);
  assert.equal(JSON.stringify(state), before, `${id}: input changed`);
  return { id, stateSha256: hash({ ...state, recordId: 'replayed' }), actionsSha256: hash(actions), actionCount: actions.length,
    representativeDropIds: [...new Set(actions.filter(action => action.kind === 'drop').map(action => action.pieceId))], drops };
});

const output = JSON.stringify({ schema: 'drop-validation-parity-v1', rows }, null, 2) + '\n';
const [mode, path] = process.argv.slice(2);
assert.ok((mode === '--out' || mode === '--compare') && path, 'Usage: --out PATH | --compare PATH');
if (mode === '--out') writeFileSync(path, output, { flag: 'wx' });
else assert.equal(output, readFileSync(path, 'utf8'), 'drop validation changed');
console.log(`${mode}: ${rows.length} positions, ${rows.reduce((n, row) => n + row.drops.length * 81, 0)} validation results`);
