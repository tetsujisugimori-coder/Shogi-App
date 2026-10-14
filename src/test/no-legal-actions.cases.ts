import { createInitialBoardState, type Player, type PieceType } from '../types/shogi';
import { normalizePositionSnapshots } from '../domain/shogi/replay';
import { createPositionKey } from '../domain/shogi/repetition';

// A constructed 40-piece position, not a proven continuation from hirate.
// Rotating 180 degrees and swapping owners gives the symmetric gote case.
export function noLegalActionsCase(player: Player = 'sente') {
  const opponent: Player = player === 'sente' ? 'gote' : 'sente';
  const state = createInitialBoardState();
  const remaining = state.squares.flat().flatMap(s => s.piece ? [s.piece] : []);
  state.squares.forEach(row => row.forEach(s => { s.piece = null; }));
  const coord = (row: number, col: number) => player === 'sente' ? { row, col } : { row: 8-row, col: 8-col };
  const place = (type: PieceType, owner: Player, row: number, col: number) => {
    const index = remaining.findIndex(p => p.type === type && p.player === owner);
    if (index < 0) throw new Error('Missing fixture piece');
    const [piece] = remaining.splice(index, 1);
    const c = coord(row, col); state.squares[c.row][c.col].piece = piece;
  };
  place('king', player, 8, 0); place('king', opponent, 0, 8);
  place('rook', opponent, 6, 1); place('gold', opponent, 5, 0);
  state.turn = opponent; state.status = 'active'; state.result = null;
  state.senteHand = []; state.goteHand = [];
  const hand = remaining.map(p => ({ ...p, player: opponent }));
  if (opponent === 'sente') state.senteHand = hand; else state.goteHand = hand;
  state.positionSnapshots = [];
  state.positionHistory = [{ key: createPositionKey(state), historyIndex: 0, movedBy: null, gaveCheck: false }];
  return { before: normalizePositionSnapshots(state), coord, player, opponent };
}
