import assert from 'node:assert/strict';
import { createInitialBoardState, type BoardState, type PieceType, type Player } from '../../src/types/shogi';
import { normalizePositionHistory } from '../../src/domain/shogi/repetition';
import { normalizePositionSnapshots } from '../../src/domain/shogi/replay';
import { isPlayerInCheck } from '../../src/domain/shogi/checkmate';
import { executeLegalAction, getLegalActions } from '../../src/domain/shogi/legalActions';

export type Placement = [number, number, PieceType, Player];
export const other = (p: Player): Player => p === 'sente' ? 'gote' : 'sente';
export function constructed(id: string, placements: Placement[], turn: Player = 'sente'): BoardState {
  let state = createInitialBoardState();
  state.recordId = id;
  for (const row of state.squares) for (const square of row) square.piece = null;
  placements.forEach(([r, c, type, player], i) => {
    assert.equal(state.squares[r][c].piece, null);
    state.squares[r][c].piece = { id: `${id}-${i}`, type, player };
  });
  state.turn = turn;
  state.status = isPlayerInCheck(state, turn) ? 'check' : 'active';
  state.positionHistory = []; state.positionSnapshots = [];
  state = normalizePositionSnapshots(normalizePositionHistory(state));
  return state;
}
export function rotate(state: BoardState, id: string): BoardState {
  assert.equal(state.history.length, 0);
  const placements: Placement[] = state.squares.flatMap(row => row.flatMap(s => s.piece
    ? [[8 - s.row, 8 - s.col, s.piece.type, other(s.piece.player)] as Placement] : []));
  return constructed(id, placements, other(state.turn));
}
export interface TacticalPosition {
  id: string;
  origin: string;
  purpose: string;
  state: BoardState;
  referenceWinner: Player;
  referenceDepth: number;
  expectation: 'shortest-win' | 'longest-resistance' | 'avoid-loss' | 'capture';
  // Coordinate predicate is independent of engine evaluation/order.
  target?: { from: [number, number]; to: [number, number]; avoid: boolean };
}
export function tacticalPositions(): TacticalPosition[] {
  // Adapted from shogi-checkmate.test.tsx:createSenteMatingMovePosition.
  const mating: Placement[] = [[8,4,'king','sente'],[0,4,'king','gote'],
    [2,4,'rook','sente'],[1,4,'silver','gote'],[2,3,'gold','sente'],
    [2,1,'bishop','sente'],[2,7,'bishop','sente']];
  const mate = constructed('mate-sente', mating);
  const trap = constructed('recapture', [[8,8,'king','sente'],[0,8,'king','gote'],
    [5,4,'rook','sente'],[4,4,'pawn','gote'],[3,4,'gold','gote']]);
  const undefended = constructed('capture', [[8,8,'king','sente'],[0,8,'king','gote'],
    [5,4,'rook','sente'],[4,4,'pawn','gote']]);
  const defence = constructed('evasion', [[8,4,'king','sente'],[0,8,'king','gote'],[4,4,'rook','gote']]);
  const loss = constructed('resistance', [[0,1,'king','gote'],[2,1,'king','sente'],[2,3,'gold','sente'],[3,0,'gold','sente']], 'gote');
  const three = constructed('mate-three', [[0,0,'king','gote'],[2,1,'king','sente'],[3,0,'gold','sente']]);
  const mixed = constructed('mixed-distance', [[0,0,'king','gote'],[2,1,'king','sente'],[2,0,'gold','sente'],[3,2,'gold','sente']]);
  const base = (id: string, state: BoardState, purpose: string, expectation: TacticalPosition['expectation'], winner: Player = state.turn): TacticalPosition =>
    ({ id, state, purpose, expectation, referenceWinner: winner, referenceDepth: 3,
      origin: 'constructed; omitted pieces outside problem, not in hands; no claim of hirate reachability' });
  // Legal replay from hirate, using public enumeration/application, retaining history.
  let replay = createInitialBoardState(); replay.recordId = 'hirate-exchange';
  for (const [fr,fc,tr,tc] of [[6,0,5,0],[2,0,3,0],[5,0,4,0],[3,0,4,0],[8,0,4,0],[2,1,3,1]]) {
    const action = getLegalActions(replay).find(a => a.kind === 'move' && a.from.row === fr && a.from.col === fc && a.to.row === tr && a.to.col === tc);
    assert.ok(action); const next = executeLegalAction(replay, action); assert.equal(next.type, 'applied');
    if (next.type === 'applied') replay = next.state;
  }
  return [
    { ...base('mate-sente', mate, 'mate one; alternative forced wins and original-order ties', 'shortest-win'), origin: 'adapted existing checkmate fixture; constructed, both kings present' },
    base('mate-gote', rotate(mate, 'mate-gote'), 'rotated mate; root score direction', 'shortest-win'),
    base('mate-three', three, 'three-ply forced mate including every king reply; quiet first move', 'shortest-win'),
    base('mixed-distance', mixed, 'one-ply and three-ply forced wins in same root', 'shortest-win'),
    { ...base('resistance', loss, 'all responses; unavoidable loss with two/four-ply resistance', 'longest-resistance', 'sente'), referenceDepth: 4 },
    base('evasion', defence, 'all legal actions must resolve check; avoid forced loss if proven', 'avoid-loss', 'gote'),
    { ...base('recapture', trap, 'adapted q captureTrap; recapturer gold replaces second same-file pawn to avoid nifu', 'capture'), target: { from: [5,4], to: [4,4], avoid: true } },
    { ...base('capture', undefended, 'unprotected pawn capture control', 'capture'), target: { from: [5,4], to: [4,4], avoid: false } },
    { ...base('recapture-gote', rotate(trap, 'recapture-gote'), 'rotated poisoned pawn and q cap', 'capture'), target: { from: [3,4], to: [4,4], avoid: true } },
    { ...base('hirate-exchange', replay, 'legal opening replay with captured pawn in hand; reference deliberately bounded', 'avoid-loss', 'gote'), origin: 'hirate replay: (6,0)-(5,0), (2,0)-(3,0), (5,0)-(4,0), (3,0)-(4,0), (8,0)-(4,0), (2,1)-(3,1); 0-based row,col' },
  ];
}
