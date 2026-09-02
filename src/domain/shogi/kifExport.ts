import { getPositionSnapshot } from './replay';
import type {
  BoardState,
  GameResult,
  MoveRecord,
  Piece,
  PieceType,
  Player,
} from '../../types/shogi';

export const KIF_MIME_TYPE = 'text/plain;charset=utf-8' as const;

const CRLF = '\r\n';
const FULL_WIDTH_FILES = ['９', '８', '７', '６', '５', '４', '３', '２', '１'] as const;
const KIF_RANKS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

const KIF_PIECES: Record<PieceType, string> = {
  king: '玉',
  rook: '飛',
  bishop: '角',
  gold: '金',
  silver: '銀',
  knight: '桂',
  lance: '香',
  pawn: '歩',
};

const KIF_PROMOTED_PIECES: Partial<Record<PieceType, string>> = {
  rook: '龍',
  bishop: '馬',
  silver: '成銀',
  knight: '成桂',
  lance: '成香',
  pawn: 'と',
};

type DecisiveGameResult = Extract<GameResult, { winner: Player }>;
type BoardCoordinate = { row: number; col: number };

function assertNever(value: never, label: string): never {
  throw new TypeError(label + 'が不正です: ' + String(value));
}

function assertBoardCoordinate(coordinate: BoardCoordinate, label: string): void {
  if (
    !Number.isInteger(coordinate.row) ||
    !Number.isInteger(coordinate.col) ||
    coordinate.row < 0 ||
    coordinate.row > 8 ||
    coordinate.col < 0 ||
    coordinate.col > 8
  ) {
    throw new TypeError(label + 'は盤上の座標である必要があります。');
  }
}

function formatDestination(coordinate: BoardCoordinate): string {
  assertBoardCoordinate(coordinate, '移動先');
  return FULL_WIDTH_FILES[coordinate.col] + KIF_RANKS[coordinate.row];
}

function formatSource(coordinate: BoardCoordinate): string {
  assertBoardCoordinate(coordinate, '移動元');
  return String(9 - coordinate.col) + String(coordinate.row + 1);
}

function formatPiece(pieceType: PieceType, isPromoted: boolean): string {
  if (!isPromoted) return KIF_PIECES[pieceType];
  const promotedPiece = KIF_PROMOTED_PIECES[pieceType];
  if (!promotedPiece) throw new TypeError('成れない駒を成駒として出力しようとしました。');
  return promotedPiece;
}

function movesMatch(left: MoveRecord | null, right: MoveRecord | null): boolean {
  if (left === null || right === null) return left === right;
  if (
    left.kind !== right.kind ||
    left.moveNumber !== right.moveNumber ||
    left.player !== right.player ||
    left.to.row !== right.to.row ||
    left.to.col !== right.to.col ||
    left.pieceType !== right.pieceType ||
    left.capturedPieceType !== right.capturedPieceType ||
    left.promotion !== right.promotion ||
    left.notation !== right.notation
  ) {
    return false;
  }
  if (left.kind === 'move' && right.kind === 'move') {
    return left.from.row === right.from.row && left.from.col === right.from.col;
  }
  if (left.kind === 'drop' && right.kind === 'drop') return left.pieceId === right.pieceId;
  return false;
}

function assertStateIntegrity(state: BoardState): void {
  if (!Number.isSafeInteger(state.moveNumber) || state.moveNumber !== state.history.length + 1) {
    throw new TypeError('現在手数と指し手履歴が一致しません。');
  }
  state.history.forEach((move, historyIndex) => {
    if (!Number.isSafeInteger(move.moveNumber) || move.moveNumber !== historyIndex + 1) {
      throw new TypeError('指し手履歴の手数が連番になっていません。');
    }
  });

  const snapshots = state.positionSnapshots;
  if (!snapshots) return;
  const historyIndexes = new Set<number>();
  for (const snapshot of snapshots) {
    if (
      !Number.isSafeInteger(snapshot.historyIndex) ||
      snapshot.historyIndex < 0 ||
      snapshot.historyIndex > state.history.length
    ) {
      throw new TypeError('局面スナップショットの履歴位置が不正です。');
    }
    if (historyIndexes.has(snapshot.historyIndex)) {
      throw new TypeError('局面スナップショットの履歴位置が重複しています。');
    }
    historyIndexes.add(snapshot.historyIndex);
    if (snapshot.moveNumber !== snapshot.historyIndex + 1) {
      throw new TypeError('局面スナップショットの手数と履歴位置が一致しません。');
    }
    const expectedLastMove = snapshot.historyIndex === 0 ? null : state.history[snapshot.historyIndex - 1];
    if (!movesMatch(snapshot.lastMove, expectedLastMove)) {
      throw new TypeError('局面スナップショットと指し手履歴が一致しません。');
    }
  }
}

function isPotentiallyPromotedMove(move: MoveRecord): boolean {
  return move.kind === 'move' && move.promotion === 'none' && KIF_PROMOTED_PIECES[move.pieceType] !== undefined;
}

function needsSnapshotToResolvePromotion(state: BoardState, historyIndex: number, move: MoveRecord): boolean {
  if (!isPotentiallyPromotedMove(move)) return false;
  return state.history.slice(0, historyIndex).some(
    (previousMove) =>
      previousMove.kind === 'move' &&
      previousMove.player === move.player &&
      previousMove.pieceType === move.pieceType &&
      previousMove.promotion === 'promote'
  );
}

function getMovingPiece(
  state: BoardState,
  historyIndex: number,
  move: Extract<MoveRecord, { kind: 'move' }>
): Piece | null {
  const snapshot = getPositionSnapshot(state, historyIndex);
  if (!snapshot) {
    if (needsSnapshotToResolvePromotion(state, historyIndex, move)) {
      throw new TypeError('成駒の表記に必要な局面スナップショットがありません。');
    }
    return null;
  }

  const sourceSquare = snapshot.squares[move.from.row]?.[move.from.col];
  const piece = sourceSquare?.piece;
  if (!piece) throw new TypeError('局面スナップショットの移動元に駒がありません。');
  if (piece.player !== move.player || piece.type !== move.pieceType) {
    throw new TypeError('局面スナップショットの移動元の駒と指し手履歴が一致しません。');
  }
  if (move.promotion !== 'none' && piece.isPromoted === true) {
    throw new TypeError('成駒に対する成り・不成の指し手は出力できません。');
  }
  return piece;
}

function formatMoveNotation(state: BoardState, historyIndex: number, move: MoveRecord): string {
  const destination = formatDestination(move.to);
  switch (move.kind) {
    case 'move': {
      const movingPiece = getMovingPiece(state, historyIndex, move);
      const piece = formatPiece(move.pieceType, movingPiece?.isPromoted === true);
      const promotion = move.promotion === 'promote' ? '成' : move.promotion === 'decline' ? '不成' : '';
      return destination + piece + promotion + '(' + formatSource(move.from) + ')';
    }
    case 'drop':
      if (move.from !== null || move.promotion !== 'none') {
        throw new TypeError('駒打ちの指し手情報が不正です。');
      }
      return destination + formatPiece(move.pieceType, false) + '打';
    default:
      return assertNever(move, '指し手種別');
  }
}

function getWinnerName(result: DecisiveGameResult): string {
  return result.winner === 'sente' ? '先手' : '後手';
}

function formatWinnerSummary(result: DecisiveGameResult, completedMoveCount: number, detail = ''): string {
  return 'まで' + completedMoveCount + '手で' + getWinnerName(result) + 'の勝ち' + detail;
}

function assertPoints(points: number, label: string): number {
  if (!Number.isSafeInteger(points) || points < 0) {
    throw new TypeError(label + 'は0以上の整数である必要があります。');
  }
  return points;
}

function formatPoints(result: Extract<GameResult, { sentePoints: number }>): string {
  const sentePoints = assertPoints(result.sentePoints, '先手の持将棋点');
  const gotePoints = assertPoints(result.gotePoints, '後手の持将棋点');
  return '（先手' + sentePoints + '点・後手' + gotePoints + '点）';
}

function formatResultLines(state: BoardState): string[] {
  const result = state.result;
  if (result == null) return [];
  if (state.status !== 'ended') throw new TypeError('終局結果がある局面は終局状態である必要があります。');

  const completedMoveCount = state.history.length;
  const terminalPrefix = String(state.moveNumber).padStart(4, ' ') + ' ';
  switch (result.endReason) {
    case 'resignation':
      return [terminalPrefix + '投了', formatWinnerSummary(result, completedMoveCount)];
    case 'checkmate':
      return [terminalPrefix + '詰み', formatWinnerSummary(result, completedMoveCount)];
    case 'foul_loss':
      return [
        terminalPrefix + (result.foulReason === 'perpetual_check_repetition' ? '反則勝ち' : '反則負け'),
        formatWinnerSummary(result, completedMoveCount, '（反則負け）'),
      ];
    case 'repetition':
      return [terminalPrefix + '千日手', 'まで' + completedMoveCount + '手で千日手'];
    case 'five_hundred_move_jishogi':
      return [terminalPrefix + '持将棋', 'まで' + completedMoveCount + '手で持将棋（500手規定）'];
    case 'agreed_jishogi_draw':
      return [
        terminalPrefix + '持将棋',
        'まで' + completedMoveCount + '手で持将棋（合意による引き分け）' + formatPoints(result),
      ];
    case 'agreed_jishogi_point_loss':
      return [
        terminalPrefix + '持将棋',
        formatWinnerSummary(result, completedMoveCount, '（持将棋の点数合意）' + formatPoints(result)),
      ];
    case 'entering_king_win':
      return [terminalPrefix + '入玉勝ち', formatWinnerSummary(result, completedMoveCount, '（入玉宣言）')];
    case 'entering_king_draw':
      return [terminalPrefix + '持将棋', 'まで' + completedMoveCount + '手で入玉宣言による引き分け'];
    case 'entering_king_declaration_failure':
      return [
        terminalPrefix + '反則負け',
        formatWinnerSummary(result, completedMoveCount, '（入玉宣言失敗）'),
      ];
    default:
      return assertNever(result, '終局結果');
  }
}

export function createKifText(state: BoardState): string {
  assertStateIntegrity(state);
  const lines = [
    '#KIF version=2.0 encoding=UTF-8',
    '# Generated by Shogi-App',
    '手数----指手---------消費時間--',
    ...state.history.map((move, historyIndex) =>
      String(move.moveNumber).padStart(4, ' ') + ' ' + formatMoveNotation(state, historyIndex, move)
    ),
    ...formatResultLines(state),
  ];
  return lines.join(CRLF) + CRLF;
}

export function createKifFileName(exportedAt: Date): string {
  if (!(exportedAt instanceof Date) || Number.isNaN(exportedAt.getTime())) {
    throw new TypeError('書き出し日時が不正です。');
  }
  const timestamp = exportedAt.toISOString().replace(/[-:]/g, '').replace('T', '-');
  return 'shogi-game-' + timestamp + '.kif';
}

export function downloadKifText(kifText: string, filename: string): void {
  const blob = new Blob([kifText], { type: KIF_MIME_TYPE });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  try {
    link.href = objectUrl;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }
}
