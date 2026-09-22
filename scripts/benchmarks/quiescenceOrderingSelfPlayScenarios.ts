import { createInitialBoardState, type BoardState, type PieceType, type Player } from '../../src/types/shogi';
import { executeLegalAction, getLegalActions, type LegalAction } from '../../src/domain/shogi/legalActions';

export interface SelfPlayScenario {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly provenance: string;
  readonly create: () => BoardState;
}

type BookMove = Readonly<{
  player: Player;
  pieceType: PieceType;
  from: readonly [row: number, col: number];
  to: readonly [row: number, col: number];
  promotion: 'none' | 'promote' | 'decline';
}>;

function replayBookLine(id: string, moves: readonly BookMove[]): BoardState {
  let state = createInitialBoardState();
  for (const [index, expected] of moves.entries()) {
    const matches = getLegalActions(state).filter((action): action is Extract<LegalAction, { kind: 'move' }> =>
      action.kind === 'move' && action.player === expected.player && action.pieceType === expected.pieceType &&
      action.from.row === expected.from[0] && action.from.col === expected.from[1] &&
      action.to.row === expected.to[0] && action.to.col === expected.to[1] && action.promotion === expected.promotion,
    );
    if (matches.length !== 1) {
      throw new Error(`scenario=${id} book ply=${index + 1}: expected exactly one semantic legal move, found ${matches.length}.`);
    }
    const execution = executeLegalAction(state, matches[0], { proposer: 'local_ai' });
    if (execution.type !== 'applied') {
      throw new Error(`scenario=${id} book ply=${index + 1}: legal move application returned ${execution.type}.`);
    }
    state = execution.state;
  }
  if (state.turn !== 'sente') throw new Error(`scenario=${id}: fixed line must finish with sente to move.`);
  return state;
}

const move = (player: Player, pieceType: PieceType, from: BookMove['from'], to: BookMove['to']): BookMove =>
  ({ player, pieceType, from, to, promotion: 'none' });

/** Fixed, legal, independently-created starts for the research-only suite. */
export const QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS: readonly SelfPlayScenario[] = Object.freeze([
  Object.freeze({
    id: 'standard-hirate', name: '平手初期局面', purpose: '既存パイロットとの連続性を保つ基準局面。',
    provenance: 'createInitialBoardState()（固定手順なし）。', create: () => createInitialBoardState(),
  }),
  Object.freeze({
    id: 'rook-pawn-opening-76-34-26-84', name: '▲7六歩 △3四歩 ▲2六歩 △8四歩後',
    purpose: '角道と飛車先の異なる定跡分岐を含める。',
    provenance: '平手から ▲7六歩 △3四歩 ▲2六歩 △8四歩 を公開合法手APIで再生。',
    create: () => replayBookLine('rook-pawn-opening-76-34-26-84', [
      move('sente', 'pawn', [6, 2], [5, 2]), move('gote', 'pawn', [2, 6], [3, 6]),
      move('sente', 'pawn', [6, 7], [5, 7]), move('gote', 'pawn', [2, 1], [3, 1]),
    ]),
  }),
  Object.freeze({
    id: 'rook-pawn-exchange-26-84-25-85', name: '▲2六歩 △8四歩 ▲2五歩 △8五歩後',
    purpose: '双方の飛車先を一段進めた別の定跡分岐を含める。',
    provenance: '平手から ▲2六歩 △8四歩 ▲2五歩 △8五歩 を公開合法手APIで再生。',
    create: () => replayBookLine('rook-pawn-exchange-26-84-25-85', [
      move('sente', 'pawn', [6, 7], [5, 7]), move('gote', 'pawn', [2, 1], [3, 1]),
      move('sente', 'pawn', [5, 7], [4, 7]), move('gote', 'pawn', [3, 1], [4, 1]),
    ]),
  }),
]);
