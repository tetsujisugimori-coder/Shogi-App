/** KIF 2.0 reader for hirate games.  Every move is replayed through the public domain APIs. */
import { createInitialBoardState } from '../../types/shogi';
import type { BoardState, MoveRecord, Piece, PieceType } from '../../types/shogi';
import { executeDrop } from './drops';
import { executeEnteringKingDeclaration } from './enteringKing';
import { executeMove } from './gameState';
import { getPromotionStatus } from './promotion';
import { executeResignation } from './resignation';

export const MAX_KIF_FILE_BYTES = 32 * 1024 * 1024;

type KifImportErrorCode =
  | 'file_too_large'
  | 'invalid_encoding'
  | 'unsupported_kif_version'
  | 'invalid_kif_structure'
  | 'unsupported_position'
  | 'invalid_move'
  | 'illegal_move'
  | 'invalid_result'
  | 'unsupported_result';

export type KifImportResult =
  | { ok: true; state: BoardState; metadata: { moveCount: number; isEnded: boolean } }
  | { ok: false; code: KifImportErrorCode; message: string };

type Coordinate = { row: number; col: number };
type KifPiece = { type: PieceType; isPromoted: boolean };
type ParsedMove =
  | { kind: 'move'; to: Coordinate; from: Coordinate; piece: KifPiece; promote: boolean }
  | { kind: 'drop'; to: Coordinate; piece: KifPiece };
type Terminal = '投了' | '詰み' | '千日手' | '反則勝ち' | '反則負け' | '持将棋' | '入玉勝ち';

const FULL_WIDTH_FILES: Record<string, number> = {
  '１': 1, '２': 2, '３': 3, '４': 4, '５': 5, '６': 6, '７': 7, '８': 8, '９': 9,
};
const RANKS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const PIECES: Record<string, KifPiece> = {
  玉: { type: 'king', isPromoted: false }, 王: { type: 'king', isPromoted: false },
  飛: { type: 'rook', isPromoted: false }, 角: { type: 'bishop', isPromoted: false },
  金: { type: 'gold', isPromoted: false }, 銀: { type: 'silver', isPromoted: false },
  桂: { type: 'knight', isPromoted: false }, 香: { type: 'lance', isPromoted: false },
  歩: { type: 'pawn', isPromoted: false }, と: { type: 'pawn', isPromoted: true },
  成香: { type: 'lance', isPromoted: true }, 成桂: { type: 'knight', isPromoted: true },
  成銀: { type: 'silver', isPromoted: true }, 馬: { type: 'bishop', isPromoted: true },
  竜: { type: 'rook', isPromoted: true }, 龍: { type: 'rook', isPromoted: true },
};
const PIECE_PATTERN = '(成香|成桂|成銀|玉|王|飛|角|金|銀|桂|香|歩|と|馬|竜|龍)';
const KIF_VERSION_DECLARATION = '#KIF version=2.0 encoding=UTF-8';
const MOVE_TABLE_HEADER = '手数----指手---------消費時間--';

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function fail(code: KifImportErrorCode, message: string): KifImportResult {
  return { ok: false, code, message };
}

function coordinateFromDestination(fileCharacter: string, rankCharacter: string): Coordinate | null {
  const file = FULL_WIDTH_FILES[fileCharacter];
  const rank = RANKS[rankCharacter];
  return file && rank ? { row: rank - 1, col: 9 - file } : null;
}

function coordinateFromSource(fileCharacter: string, rankCharacter: string): Coordinate | null {
  const file = Number(fileCharacter);
  const rank = Number(rankCharacter);
  return Number.isInteger(file) && Number.isInteger(rank) && file >= 1 && file <= 9 && rank >= 1 && rank <= 9
    ? { row: rank - 1, col: 9 - file }
    : null;
}

function removeConsumedTime(text: string): string {
  return text.replace(/\s+\(\s*\d+(?::\d+){1,2}\s*\/\s*\d+(?::\d+){1,2}\s*\)\s*$/, '').trim();
}

function parseMoveNotation(text: string, previousMove: MoveRecord | null): ParsedMove | string {
  const withoutTime = removeConsumedTime(text);
  if (withoutTime.includes('不成')) return 'KIF 2.0では「不成」修飾子を使用しません。';
  const match = new RegExp(`^(同|[１２３４５６７８９][一二三四五六七八九])\\s*${PIECE_PATTERN}(成|打)?(?:\\(([1-9])([1-9])\\))?$`).exec(withoutTime);
  if (!match) return '指し手の表記がKIF 2.0として読み取れません。';
  const [, destinationText, pieceText, modifier, sourceFile, sourceRank] = match;
  const piece = PIECES[pieceText];
  const to = destinationText === '同'
    ? previousMove ? { ...previousMove.to } : null
    : coordinateFromDestination(destinationText[0], destinationText[1]);
  if (!to) return '「同」に対応する直前の合法手がありません。';
  if (modifier === '打') {
    if (piece.isPromoted) return '成駒を駒打ちとして指定できません。';
    if (sourceFile || sourceRank) return '駒打ちに移動元座標は指定できません。';
    return { kind: 'drop', to, piece };
  }
  if (!sourceFile || !sourceRank) return '通常移動には移動元座標(11)から(99)が必要です。';
  const from = coordinateFromSource(sourceFile, sourceRank);
  if (!from) return '移動元座標は(11)から(99)で指定してください。';
  return { kind: 'move', to, from, piece, promote: modifier === '成' };
}

function findHandPiece(state: BoardState, type: PieceType): Piece | null {
  const hand = state.turn === 'sente' ? state.senteHand : state.goteHand;
  return hand.find((piece) => piece.type === type && !piece.isPromoted && piece.player === state.turn) ?? null;
}

function moveError(lineNumber: number, moveNumber: number, item: string): KifImportResult {
  return fail('illegal_move', `${lineNumber}行目・${moveNumber}手目: ${item}`);
}

function executionMessage(execution: { type: string; message?: string }): string {
  return execution.message ?? '既存の合法手判定で拒否されました';
}

function replayMove(state: BoardState, parsed: ParsedMove, lineNumber: number): KifImportResult | BoardState {
  const moveNumber = state.moveNumber;
  if (parsed.kind === 'drop') {
    const handPiece = findHandPiece(state, parsed.piece.type);
    if (!handPiece) return moveError(lineNumber, moveNumber, '指定された持ち駒がありません。');
    const execution = executeDrop(state, handPiece.id, parsed.to, { mode: 'assist', proposer: 'human' });
    return execution.type === 'applied'
      ? execution.state
      : moveError(lineNumber, moveNumber, `駒打ちが合法ではありません（${executionMessage(execution)}）。`);
  }

  const movingPiece = state.squares[parsed.from.row]?.[parsed.from.col]?.piece;
  if (!movingPiece) return moveError(lineNumber, moveNumber, '移動元に駒がありません。');
  if (
    movingPiece.player !== state.turn ||
    movingPiece.type !== parsed.piece.type ||
    (movingPiece.isPromoted === true) !== parsed.piece.isPromoted
  ) {
    return moveError(lineNumber, moveNumber, 'KIFの駒名と移動元にある駒が一致しません。');
  }
  const promotionStatus = getPromotionStatus(movingPiece, parsed.from, parsed.to);
  if (parsed.promote && promotionStatus === 'none') {
    return moveError(lineNumber, moveNumber, '成れない駒または成れない局面で「成」が指定されています。');
  }
  if (!parsed.promote && promotionStatus === 'required') {
    return moveError(lineNumber, moveNumber, '成りが必須の手で「成」が省略されています。');
  }
  const promotion = promotionStatus === 'optional' ? (parsed.promote ? 'promote' : 'decline') : parsed.promote ? 'promote' : undefined;
  const execution = executeMove(state, parsed.from, parsed.to, { mode: 'assist', proposer: 'human', promotion });
  return execution.type === 'applied'
    ? execution.state
    : moveError(lineNumber, moveNumber, `通常移動が合法ではありません（${executionMessage(execution)}）。`);
}

function parseTerminal(value: string): Terminal | null {
  return (['投了', '詰み', '千日手', '反則勝ち', '反則負け', '持将棋', '入玉勝ち'] as const)
    .find((terminal) => value === terminal) ?? null;
}

function applyTerminal(state: BoardState, terminal: Terminal, lineNumber: number): KifImportResult | BoardState {
  if (terminal === '投了') {
    const execution = executeResignation(state);
    return execution.type === 'applied'
      ? execution.state
      : fail('invalid_result', `${lineNumber}行目: 投了を現在の局面へ適用できません（${execution.message}）。`);
  }
  if (terminal === '入玉勝ち') {
    const execution = executeEnteringKingDeclaration(state, { mode: 'assist', proposer: 'human' });
    return execution.type === 'applied' && execution.result.endReason === 'entering_king_win'
      ? execution.state
      : fail('invalid_result', `${lineNumber}行目: 入玉勝ちの条件を既存ルールで確認できません。`);
  }
  const expected = terminal === '詰み' ? 'checkmate'
    : terminal === '千日手' ? 'repetition'
      : terminal === '反則勝ち' ? 'foul_loss'
        : terminal === '持将棋' ? 'five_hundred_move_jishogi' : null;
  if (terminal === '反則負け') {
    return fail('unsupported_result', `${lineNumber}行目: KIFの「反則負け」には反則理由がないため安全に復元できません。`);
  }
  if (state.status !== 'ended' || state.result?.endReason !== expected) {
    return fail('invalid_result', `${lineNumber}行目: 終局語「${terminal}」が再実行した局面の結果と一致しません。`);
  }
  if (
    terminal === '反則勝ち' &&
    (state.result.endReason !== 'foul_loss' || state.result.foulReason !== 'perpetual_check_repetition')
  ) {
    return fail('invalid_result', `${lineNumber}行目: 反則勝ちは連続王手の千日手として再現できません。`);
  }
  return state;
}

function isInformationalLine(line: string): boolean {
  return (
    line.startsWith('*') || line.startsWith('まで') ||
    /^(開始日時|終了日時|棋戦|場所|持ち時間|消費時間|先手|後手)\s*[：:]/.test(line)
  );
}

/** Parses one UTF-8 KIF 2.0 text and returns an independent replayed board state on success. */
export function importKifText(text: string): KifImportResult {
  if (utf8ByteLength(text) > MAX_KIF_FILE_BYTES) return fail('file_too_large', 'KIFファイルが大きすぎます（上限32 MiB）。');
  if (text.trim().length === 0) return fail('invalid_encoding', 'KIFファイルが空です。');
  if (text.includes('\uFFFD')) return fail('invalid_encoding', 'KIFをUTF-8として正しく読み取れませんでした。');
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  let state = createInitialBoardState();
  let hasVersionDeclaration = false;
  let hasMoveTableHeader = false;
  let terminalSeen = false;

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index].trim();
    if (!line) continue;
    if (line.startsWith('#KIF')) {
      if (line !== KIF_VERSION_DECLARATION) {
        return fail('unsupported_kif_version', `${lineNumber}行目: 対応していないKIFバージョンまたは文字コードです。KIF 2.0 UTF-8を指定してください。`);
      }
      if (hasVersionDeclaration) {
        return fail('invalid_kif_structure', `${lineNumber}行目: KIFバージョン宣言が重複しています。`);
      }
      if (hasMoveTableHeader) {
        return fail('invalid_kif_structure', `${lineNumber}行目: KIFバージョン宣言は指し手表より前に必要です。`);
      }
      hasVersionDeclaration = true;
      continue;
    }
    if (line.startsWith('#')) continue;
    if (line === MOVE_TABLE_HEADER) {
      if (!hasVersionDeclaration) {
        return fail('invalid_kif_structure', `${lineNumber}行目: KIF 2.0のバージョン宣言がありません。`);
      }
      if (hasMoveTableHeader) return fail('invalid_kif_structure', `${lineNumber}行目: 指し手表ヘッダーが重複しています。`);
      hasMoveTableHeader = true;
      continue;
    }
    if (isInformationalLine(line)) continue;
    if (/^(手合割|手合|開始局面)\s*[：:]/.test(line)) {
      if (!/(平手|なし)$/.test(line)) return fail('unsupported_position', `${lineNumber}行目: 平手以外の開始局面には対応していません。`);
      continue;
    }
    if (line.startsWith('|') || /^(先手|後手)の持駒/.test(line) || /^変化[：:]/.test(line)) {
      return fail('unsupported_position', `${lineNumber}行目: 駒落ち・任意局面・変化手順には対応していません。`);
    }
    if (!hasVersionDeclaration) {
      return fail('invalid_kif_structure', `${lineNumber}行目: KIF 2.0のバージョン宣言がありません。`);
    }
    if (!hasMoveTableHeader) {
      return fail('invalid_kif_structure', `${lineNumber}行目: 指し手表ヘッダー「${MOVE_TABLE_HEADER}」がありません。`);
    }
    const numbered = /^(\d+)\s+(.+?)\s*$/.exec(line);
    if (!numbered) return fail('invalid_move', `${lineNumber}行目: 対局情報でも指し手でもない行があります。`);
    const moveNumber = Number(numbered[1]);
    const value = numbered[2].trim();
    if (!Number.isSafeInteger(moveNumber) || moveNumber < 1) return fail('invalid_move', `${lineNumber}行目: 手数が不正です。`);
    if (moveNumber !== state.moveNumber) return fail('invalid_move', `${lineNumber}行目: 手数${moveNumber}は連番ではありません（${state.moveNumber}手目が必要です）。`);
    const terminal = parseTerminal(removeConsumedTime(value));
    if (terminal) {
      if (terminalSeen) return fail('invalid_result', `${lineNumber}行目: 終局行が重複しています。`);
      const result = applyTerminal(state, terminal, lineNumber);
      if ('ok' in result) return result;
      state = result;
      terminalSeen = true;
      continue;
    }
    if (terminalSeen) return fail('invalid_move', `${lineNumber}行目: 終局行の後に指し手があります。`);
    if (state.status === 'ended') return fail('invalid_result', `${lineNumber}行目: 終局済みの局面に続く指し手があります。`);
    const parsed = parseMoveNotation(value, state.lastMove ?? null);
    if (typeof parsed === 'string') return fail('invalid_move', `${lineNumber}行目・${moveNumber}手目: ${parsed}`);
    const replayed = replayMove(state, parsed, lineNumber);
    if ('ok' in replayed) return replayed;
    state = replayed;
  }
  if (state.status === 'ended' && !terminalSeen) {
    return fail('invalid_result', '再実行により終局していますが、KIFに対応する終局行がありません。');
  }
  if (!hasVersionDeclaration) return fail('invalid_kif_structure', 'KIF 2.0のバージョン宣言がありません。');
  if (!hasMoveTableHeader) return fail('invalid_kif_structure', `指し手表ヘッダー「${MOVE_TABLE_HEADER}」がありません。`);
  return { ok: true, state, metadata: { moveCount: state.history.length, isEnded: state.status === 'ended' } };
}
