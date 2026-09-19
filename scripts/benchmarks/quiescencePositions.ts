import { createInitialBoardState, type BoardState, type PieceType, type Player } from '../../src/types/shogi';
import { isPlayerInCheck } from '../../src/domain/shogi';
import { normalizePositionHistory } from '../../src/domain/shogi/repetition';
import { normalizePositionSnapshots } from '../../src/domain/shogi/replay';

export type BenchmarkPurpose = 'quiet' | 'recapture' | 'poisoned-capture' | 'check-evasion' | 'promotion-capture' | 'drop-evasion';
export interface BenchmarkPosition {
  readonly id: string;
  readonly name: string;
  readonly purpose: BenchmarkPurpose;
  readonly observation: string;
  readonly provenance: string;
  readonly create: () => BoardState;
}
type Placement = readonly [row: number, col: number, type: PieceType, player: Player];

// Composed sparse positions, not claimed to be a historical game or a full-game
// reconstruction. Unplaced pieces are outside the board (not available in hand).
// Reuse the application's board and history constructors, never test fixtures.
function composed(id: string, placements: readonly Placement[], goldInHand = false): BoardState {
  const state = createInitialBoardState();
  state.recordId = `quiescence-benchmark-${id}`;
  for (const row of state.squares) for (const square of row) square.piece = null;
  for (const [row, col, type, player] of placements) {
    state.squares[row][col].piece = { id: `${player}-${type}-${row}-${col}`, type, player };
  }
  if (goldInHand) state.senteHand = [{ id: 'sente-hand-gold', type: 'gold', player: 'sente' }];
  state.status = isPlayerInCheck(state, state.turn) ? 'check' : 'active';
  return normalizePositionSnapshots(normalizePositionHistory(state));
}
const kings: readonly Placement[] = [[8, 8, 'king', 'sente'], [0, 8, 'king', 'gote']];
const checked: readonly Placement[] = [[8, 4, 'king', 'sente'], [0, 8, 'king', 'gote'], [4, 4, 'rook', 'gote']];

export const QUIESCENCE_BENCHMARK_POSITIONS: readonly BenchmarkPosition[] = [
  {
    id: 'initial', name: '平手初期局面', purpose: 'quiet',
    observation: '直ちに駒が衝突しない局面で、PV・評価と読み足しの計算量を観察する。',
    provenance: '既存measure-alpha-beta-quiescence.tsと同じcreateInitialBoardState。',
    create: () => ({ ...createInitialBoardState(), recordId: 'quiescence-benchmark-initial' }),
  },
  {
    id: 'pawn-recapture', name: '歩の取り返し', purpose: 'recapture',
    observation: '▲5五歩に△5五銀と取り返せる単純な交換で、探索末端の応酬を観察する。',
    provenance: '既存静止探索テストの取り返し配置を参考に新規作成。飛車を歩、後方の歩を銀に変更して二歩を避ける。',
    create: () => composed('pawn-recapture', [...kings, [5, 4, 'pawn', 'sente'], [4, 4, 'pawn', 'gote'], [3, 4, 'silver', 'gote']]),
  },
  {
    id: 'poisoned-rook', name: '飛車の毒入り捕獲', purpose: 'poisoned-capture',
    observation: '▲5五飛の歩取りに△5五銀が合法な局面。駒損の可能性とPV・評価の変化を観察する。正解手は指定しない。',
    provenance: 'quiescenceComparisonPositions.tsと旧測定のrecaptureを参考に、取り返す歩を銀へ変更。旧fixtureの固定期待値には影響させない。',
    create: () => composed('poisoned-rook', [...kings, [5, 4, 'rook', 'sente'], [4, 4, 'pawn', 'gote'], [3, 4, 'silver', 'gote']]),
  },
  {
    id: 'rook-check', name: '飛車の王手回避', purpose: 'check-evasion',
    observation: '先手玉が飛車の王手を受けた局面で、合法な玉移動を含む回避と探索量を観察する。',
    provenance: 'shogi-quiescence-search.test.tsの王手回避配置を再構成（持ち駒なし）。',
    create: () => composed('rook-check', checked),
  },
  {
    id: 'promotion-capture', name: '銀の成り捕獲', purpose: 'promotion-capture',
    observation: '▲5三銀成／不成の歩取りが可能な局面で、成りを伴う捕獲とPVの変化を観察する。',
    provenance: '成りを含む駒取りの観察用に新規作成した疎な配置。',
    create: () => composed('promotion-capture', [...kings, [3, 4, 'silver', 'sente'], [2, 4, 'pawn', 'gote']]),
  },
  {
    id: 'gold-drop-evasion', name: '金打ちの合駒', purpose: 'drop-evasion',
    observation: '飛車の王手に金打ちで合駒できる局面で、駒打ちを含む回避とその後の応酬を観察する。',
    provenance: 'shogi-quiescence-search.test.tsの王手・金の合駒配置を再構成。旧測定の自動配置玉との重複を避け、各玉は1枚。',
    create: () => composed('gold-drop-evasion', checked, true),
  },
];
