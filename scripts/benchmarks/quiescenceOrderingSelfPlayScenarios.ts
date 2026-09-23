import { createInitialBoardState, type BoardState, type PieceType, type Player } from '../../src/types/shogi';
import { executeLegalAction, getLegalActions, type LegalAction } from '../../src/domain/shogi/legalActions';

export interface SelfPlayScenario {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly provenance: string;
  readonly phase: ScenarioPhase;
  readonly sideToMove: Player;
  readonly create: () => BoardState;
}

export type ScenarioPhase = 'opening' | 'middlegame' | 'endgame';

type BookMove = Readonly<{
  kind: 'move';
  player: Player;
  pieceType: PieceType;
  from: readonly [row: number, col: number];
  to: readonly [row: number, col: number];
  promotion: 'none' | 'promote' | 'decline';
}>;

type BookDrop = Readonly<{
  kind: 'drop'; player: Player; pieceType: Exclude<PieceType, 'king'>;
  to: readonly [row: number, col: number];
}>;
type BookAction = BookMove | BookDrop;

function replayBookLine(id: string, expectedTurn: Player, moves: readonly BookAction[]): BoardState {
  let state = createInitialBoardState();
  for (const [index, expected] of moves.entries()) {
    const matches = getLegalActions(state).filter((action): action is LegalAction => expected.kind === 'drop'
      ? action.kind === 'drop' && action.player === expected.player && action.pieceType === expected.pieceType &&
        action.to.row === expected.to[0] && action.to.col === expected.to[1]
      : action.kind === 'move' && action.player === expected.player && action.pieceType === expected.pieceType &&
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
  if (state.turn !== expectedTurn) throw new Error(`scenario=${id}: expected ${expectedTurn} to move, found ${state.turn}.`);
  return state;
}

const move = (player: Player, pieceType: PieceType, from: BookMove['from'], to: BookMove['to'],
  promotion: BookMove['promotion'] = 'none'): BookMove => ({ kind: 'move', player, pieceType, from, to, promotion });
const drop = (player: Player, pieceType: BookDrop['pieceType'], to: BookDrop['to']): BookDrop => ({ kind: 'drop', player, pieceType, to });

/** Fixed, legal, independently-created starts for the research-only suite. */
export const QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS: readonly SelfPlayScenario[] = Object.freeze([
  Object.freeze({
    id: 'standard-hirate', name: '平手初期局面', purpose: '既存パイロットとの連続性を保つ基準局面。',
    provenance: 'createInitialBoardState()（固定手順なし）。', phase: 'opening', sideToMove: 'sente', create: () => createInitialBoardState(),
  }),
  Object.freeze({
    id: 'rook-pawn-opening-76-34-26-84', name: '▲7六歩 △3四歩 ▲2六歩 △8四歩後',
    purpose: '角道と飛車先の異なる定跡分岐を含める。',
    provenance: '平手から ▲7六歩 △3四歩 ▲2六歩 △8四歩 を公開合法手APIで再生。',
    phase: 'opening', sideToMove: 'sente', create: () => replayBookLine('rook-pawn-opening-76-34-26-84', 'sente', [
      move('sente', 'pawn', [6, 2], [5, 2]), move('gote', 'pawn', [2, 6], [3, 6]),
      move('sente', 'pawn', [6, 7], [5, 7]), move('gote', 'pawn', [2, 1], [3, 1]),
    ]),
  }),
  Object.freeze({
    id: 'rook-pawn-exchange-26-84-25-85', name: '▲2六歩 △8四歩 ▲2五歩 △8五歩後',
    purpose: '双方の飛車先を一段進めた別の定跡分岐を含める。',
    provenance: '平手から ▲2六歩 △8四歩 ▲2五歩 △8五歩 を公開合法手APIで再生。',
    phase: 'opening', sideToMove: 'sente', create: () => replayBookLine('rook-pawn-exchange-26-84-25-85', 'sente', [
      move('sente', 'pawn', [6, 7], [5, 7]), move('gote', 'pawn', [2, 1], [3, 1]),
      move('sente', 'pawn', [5, 7], [4, 7]), move('gote', 'pawn', [3, 1], [4, 1]),
    ]),
  }),
  Object.freeze({
    id: 'quiet-double-static-rook-middlegame', name: '相居飛車の静かな駒組み',
    purpose: '玉と金銀の整備が進み、初期局面より候補手が増えた非王手の静かな中盤を観察する。',
    provenance: '平手から相居飛車の基本的な駒組みを公開合法手APIで20手再生した固定手順。実戦棋譜であるとは主張しない。',
    phase: 'middlegame', sideToMove: 'sente', create: () => replayBookLine('quiet-double-static-rook-middlegame', 'sente', [
      move('sente', 'pawn', [6, 2], [5, 2]), move('gote', 'pawn', [2, 6], [3, 6]),
      move('sente', 'pawn', [6, 7], [5, 7]), move('gote', 'pawn', [2, 1], [3, 1]),
      move('sente', 'pawn', [5, 7], [4, 7]), move('gote', 'pawn', [3, 1], [4, 1]),
      move('sente', 'bishop', [7, 1], [6, 2]), move('gote', 'gold', [0, 5], [1, 6]),
      move('sente', 'silver', [8, 2], [7, 3]), move('gote', 'silver', [0, 6], [1, 5]),
      move('sente', 'king', [8, 4], [7, 4]), move('gote', 'king', [0, 4], [1, 4]),
      move('sente', 'king', [7, 4], [7, 5]), move('gote', 'king', [1, 4], [1, 3]),
      move('sente', 'gold', [8, 5], [7, 4]), move('gote', 'gold', [0, 3], [1, 4]),
      move('sente', 'silver', [8, 6], [7, 6]), move('gote', 'pawn', [2, 2], [3, 2]),
      move('sente', 'pawn', [6, 3], [5, 3]), move('gote', 'pawn', [2, 3], [3, 3]),
    ]),
  }),
  Object.freeze({
    id: 'rook-pawn-recapture-middlegame', name: '飛車先の歩交換と取り返し',
    purpose: '歩交換、飛車による取り返し、持ち駒の発生を含め、候補手順序の影響を観察しやすくする。',
    provenance: '平手から飛車先の歩交換を公開合法手APIで再生した固定手順。実戦棋譜であるとは主張しない。',
    phase: 'middlegame', sideToMove: 'sente', create: () => replayBookLine('rook-pawn-recapture-middlegame', 'sente', [
      move('sente', 'pawn', [6, 7], [5, 7]), move('gote', 'pawn', [2, 1], [3, 1]),
      move('sente', 'pawn', [5, 7], [4, 7]), move('gote', 'pawn', [3, 1], [4, 1]),
      move('sente', 'pawn', [4, 7], [3, 7]), move('gote', 'pawn', [2, 7], [3, 7]),
      move('sente', 'rook', [7, 7], [3, 7]), move('gote', 'pawn', [4, 1], [5, 1]),
      move('sente', 'pawn', [6, 1], [5, 1]), move('gote', 'rook', [1, 1], [5, 1]),
    ]),
  }),
  Object.freeze({
    id: 'check-evasion-endgame', name: '王手回避を含む終盤',
    purpose: '持ち駒を伴う局面で王手を受け、合法な回避手を探索する終盤の分岐を含める。',
    provenance: '既存の王手・金打ち合駒テスト配置を研究用に再構成し、公開合法手APIで合法性を検証した固定局面。実戦棋譜とは主張しない。',
    phase: 'endgame', sideToMove: 'gote', create: () => replayBookLine('check-evasion-endgame', 'gote', [
      move('sente', 'pawn', [6, 2], [5, 2]), move('gote', 'pawn', [2, 6], [3, 6]),
      move('sente', 'bishop', [7, 1], [6, 2]), move('gote', 'bishop', [1, 7], [2, 6]),
      move('sente', 'bishop', [6, 2], [2, 6], 'promote'),
    ]),
  }),
  Object.freeze({
    id: 'hand-drop-endgame', name: '持ち駒の歩打ちを含む終盤',
    purpose: '駒取りで得た持ち駒があり、駒打ち候補を含む終盤の候補集合を観察する。',
    provenance: '平手から飛車先の歩交換と持ち駒の歩打ちを公開合法手APIで再生した固定手順。実戦棋譜であるとは主張しない。',
    phase: 'endgame', sideToMove: 'gote', create: () => replayBookLine('hand-drop-endgame', 'gote', [
      move('sente', 'pawn', [6, 7], [5, 7]), move('gote', 'pawn', [2, 1], [3, 1]),
      move('sente', 'pawn', [5, 7], [4, 7]), move('gote', 'pawn', [3, 1], [4, 1]),
      move('sente', 'pawn', [4, 7], [3, 7]), move('gote', 'pawn', [2, 7], [3, 7]),
      move('sente', 'rook', [7, 7], [3, 7]), move('gote', 'pawn', [4, 1], [5, 1]),
      move('sente', 'pawn', [6, 1], [5, 1]), move('gote', 'rook', [1, 1], [5, 1]),
      drop('sente', 'pawn', [6, 1]),
    ]),
  }),
]);
