import { createInitialBoardState, type BoardState, type Piece, type PieceType, type Player } from '../../src/types/shogi';
import { isPlayerInCheck } from '../../src/domain/shogi/checkmate';
import { executeLegalAction, getLegalActions, type LegalAction } from '../../src/domain/shogi/legalActions';
import { normalizePositionHistory } from '../../src/domain/shogi/repetition';
import { normalizePositionSnapshots } from '../../src/domain/shogi/replay';

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
type HandPieceType = Exclude<PieceType, 'king'>;
type ScenarioPlacement = readonly [number, number, PieceType, Player];

interface ScenarioHands {
  readonly sente?: readonly HandPieceType[];
  readonly gote?: readonly HandPieceType[];
}

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

/**
 * Builds a deliberately sparse, deterministic research position through the
 * same normalized BoardState path used by the quiescence benchmark fixtures.
 * These are composed positions, not claims about a historical game record.
 */
function composeResearchPosition(
  id: string,
  turn: Player,
  placements: readonly ScenarioPlacement[],
  hands: ScenarioHands = {},
): BoardState {
  const state = createInitialBoardState();
  state.recordId = `killer-suite-${id}`;

  for (const row of state.squares) for (const square of row) square.piece = null;
  for (const [row, col, type, player] of placements) {
    state.squares[row][col].piece = { id: `${id}-board-${player}-${type}-${row}-${col}`, type, player };
  }

  const createHand = (player: Player, pieces: readonly HandPieceType[] = []): Piece[] =>
    pieces.map((type, index) => ({ id: `${id}-hand-${player}-${type}-${index}`, type, player }));
  state.senteHand = createHand('sente', hands.sente);
  state.goteHand = createHand('gote', hands.gote);
  state.turn = turn;
  state.status = isPlayerInCheck(state, turn) ? 'check' : 'active';

  return normalizePositionSnapshots(normalizePositionHistory(state));
}

const move = (player: Player, pieceType: PieceType, from: BookMove['from'], to: BookMove['to'],
  promotion: BookMove['promotion'] = 'none'): BookMove => ({ kind: 'move', player, pieceType, from, to, promotion });

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
    id: 'check-evasion-endgame', name: '構成終盤の王手回避',
    purpose: '駒数を大幅に減らした後手玉への飛車王手で、王手回避・合駒を含む探索木を比べる。',
    provenance: '実戦棋譜ではない。quiescence benchmark と同じ正規化済み BoardState 構築パターンで作った、盤上8枚・双方持ち駒ありの決定的な研究用構成局面。',
    phase: 'endgame', sideToMove: 'gote', create: () => composeResearchPosition('check-evasion-endgame', 'gote', [
      [8, 4, 'king', 'sente'], [0, 4, 'king', 'gote'], [4, 4, 'rook', 'sente'],
      [2, 2, 'silver', 'sente'], [6, 6, 'gold', 'sente'], [1, 3, 'gold', 'gote'],
      [1, 5, 'silver', 'gote'], [3, 7, 'bishop', 'gote'],
    ], { sente: ['pawn', 'knight'], gote: ['pawn', 'gold'] }),
  }),
  Object.freeze({
    id: 'hand-drop-endgame', name: '構成終盤の持ち駒歩打ち',
    purpose: '駒数を大幅に減らした後手番で、通常手と合法な持ち駒歩打ちが混ざる探索順を比べる。',
    provenance: '実戦棋譜ではない。quiescence benchmark と同じ正規化済み BoardState 構築パターンで作った、盤上7枚・双方持ち駒ありの決定的な研究用構成局面。',
    phase: 'endgame', sideToMove: 'gote', create: () => composeResearchPosition('hand-drop-endgame', 'gote', [
      [8, 4, 'king', 'sente'], [0, 4, 'king', 'gote'], [5, 2, 'rook', 'sente'],
      [6, 6, 'gold', 'sente'], [3, 6, 'bishop', 'gote'], [2, 2, 'silver', 'gote'],
      [4, 5, 'pawn', 'sente'],
    ], { sente: ['silver', 'knight'], gote: ['pawn', 'gold'] }),
  }),
]);
