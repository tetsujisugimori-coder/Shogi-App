import type {
  BoardCoordinate,
  BoardState,
  GameResult,
  MoveRecord,
  PieceType,
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

function formatPiece(pieceType: PieceType): string {
  const piece = KIF_PIECES[pieceType];
  if (!piece) throw new TypeError('駒種別が不正です。');
  return piece;
}

function formatMoveNotation(move: MoveRecord): string {
  const destination = formatDestination(move.to);
  const piece = formatPiece(move.pieceType);

  switch (move.kind) {
    case 'move': {
      const source = formatSource(move.from);
      const promotion = move.promotion === 'promote' ? '成' : move.promotion === 'decline' ? '不成' : '';
      return destination + piece + promotion + '(' + source + ')';
    }
    case 'drop':
      if (move.from !== null || move.promotion !== 'none') {
        throw new TypeError('駒打ちの指し手情報が不正です。');
      }
      return destination + piece + '打';
    default:
      return assertNever(move, '指し手種別');
  }
}

function formatMoveLine(move: MoveRecord): string {
  if (!Number.isSafeInteger(move.moveNumber) || move.moveNumber <= 0) {
    throw new TypeError('手数は1以上の整数である必要があります。');
  }
  return String(move.moveNumber).padStart(4, ' ') + ' ' + formatMoveNotation(move);
}

function getResultData(result: GameResult): Record<string, unknown> {
  return result as unknown as Record<string, unknown>;
}

function getResultType(result: GameResult): string {
  const data = getResultData(result);
  const resultType = data.type ?? data.kind;
  if (typeof resultType !== 'string') throw new TypeError('終局結果の種別が不正です。');
  return resultType;
}

function getWinnerName(result: GameResult): string {
  const data = getResultData(result);
  if (data.winner === 'sente') return '先手';
  if (data.winner === 'gote') return '後手';
  if (data.loser === 'sente' || data.player === 'sente') return '後手';
  if (data.loser === 'gote' || data.player === 'gote') return '先手';
  throw new TypeError('終局結果から勝者を判定できません。');
}

function getCompletedMoveCount(state: BoardState): number {
  if (!Number.isSafeInteger(state.moveNumber) || state.moveNumber <= 0) {
    throw new TypeError('現在手数が不正です。');
  }
  return state.moveNumber - 1;
}

function formatResultLines(state: BoardState): string[] {
  if (state.result === null) return [];
  const completedMoveCount = getCompletedMoveCount(state);
  const resultType = getResultType(state.result);
  const terminalPrefix = String(state.moveNumber).padStart(4, ' ') + ' ';
  const winnerSummary = (detail = '') =>
    'まで' + completedMoveCount + '手で' + getWinnerName(state.result) + 'の勝ち' + detail;

  switch (resultType) {
    case 'resignation':
      return [terminalPrefix + '投了', winnerSummary()];
    case 'checkmate':
      return [terminalPrefix + '詰み', winnerSummary()];
    case 'foul_loss':
      return [terminalPrefix + '反則勝ち', winnerSummary('（反則負け）')];
    case 'repetition':
      return [terminalPrefix + '千日手', 'まで' + completedMoveCount + '手で千日手'];
    case 'five_hundred_move_jishogi':
      return [terminalPrefix + '持将棋', 'まで' + completedMoveCount + '手で持将棋（500手規定）'];
    case 'agreed_jishogi_draw':
      return [terminalPrefix + '持将棋', 'まで' + completedMoveCount + '手で持将棋（合意による引き分け）'];
    case 'agreed_jishogi_point_loss':
      return [terminalPrefix + '持将棋', winnerSummary('（持将棋の点数合意）')];
    case 'entering_king_win':
      return [terminalPrefix + '入玉勝ち', winnerSummary('（入玉宣言）')];
    case 'entering_king_draw':
      return [terminalPrefix + '入玉', 'まで' + completedMoveCount + '手で入玉宣言による引き分け'];
    case 'entering_king_declaration_failure':
      return [terminalPrefix + '入玉宣言失敗', winnerSummary('（入玉宣言失敗）')];
    default:
      throw new TypeError('未対応の終局結果です: ' + resultType);
  }
}

function assertPositionSnapshots(state: BoardState): void {
  for (const snapshot of state.positionSnapshots) {
    if (
      !Number.isSafeInteger(snapshot.historyIndex) ||
      snapshot.historyIndex < 0 ||
      snapshot.historyIndex > state.history.length
    ) {
      throw new TypeError('局面履歴の履歴位置が不正です。');
    }
    if (snapshot.historyIndex === 0 && snapshot.lastMove !== null) {
      throw new TypeError('初期局面の最終手はnullである必要があります。');
    }
    if (
      snapshot.historyIndex > 0 &&
      snapshot.lastMove?.moveNumber !== state.history[snapshot.historyIndex - 1]?.moveNumber
    ) {
      throw new TypeError('局面履歴と指し手履歴が一致しません。');
    }
  }
}

export function createKifText(state: BoardState): string {
  assertPositionSnapshots(state);
  const lines = [
    '#KIF version=2.0',
    '# Generated by Shogi-App',
    '手数----指手---------消費時間--',
    ...state.history.map(formatMoveLine),
    ...formatResultLines(state),
  ];
  return lines.join(CRLF) + CRLF;
}

export function createKifFileName(exportedAt: Date): string {
  if (!(exportedAt instanceof Date) || Number.isNaN(exportedAt.getTime())) {
    throw new TypeError('書き出し日時が不正です。');
  }
  const timestamp = exportedAt.toISOString().replace(/[-:]/g, '').replace('.', '-');
  return 'shogi-game-' + timestamp + '.kif';
}

export function downloadKifText(kifText: string, filename: string): void {
  const blob = new Blob([kifText], { type: KIF_MIME_TYPE });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}
