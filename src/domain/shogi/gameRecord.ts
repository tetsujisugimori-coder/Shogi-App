import type {
  BoardSquare,
  BoardState,
  BoardStatus,
  FoulRecord,
  GameResult,
  IllegalMoveReason,
  MovePromotion,
  MoveRecord,
  MoveLimitJishogiState,
  Piece,
  PieceType,
  Player,
  PositionRecord,
  PositionSnapshot,
  ProposerType,
} from '../../types/shogi';

export const SHOGI_GAME_RECORD_FORMAT = 'shogi-app-game-record' as const;
export const SHOGI_GAME_RECORD_VERSION = 1 as const;
export const SHOGI_GAME_RECORD_MIME_TYPE = 'application/json;charset=utf-8' as const;

export type SavedPlayerV1 = 'sente' | 'gote';

export type SavedPieceTypeV1 =
  | 'king'
  | 'rook'
  | 'bishop'
  | 'gold'
  | 'silver'
  | 'knight'
  | 'lance'
  | 'pawn';

export type SavedBoardStatusV1 =
  | 'preparation'
  | 'active'
  | 'check'
  | 'blunder'
  | 'evaluating'
  | 'ended';

export type SavedMovePromotionV1 = 'none' | 'promote' | 'decline';

export type SavedIllegalMoveReasonV1 =
  | 'out_of_bounds'
  | 'no_piece_at_source'
  | 'not_current_turn'
  | 'not_own_piece'
  | 'invalid_piece_move'
  | 'occupied_by_own_piece'
  | 'captured_king'
  | 'dead_piece'
  | 'promotion_choice_required'
  | 'invalid_promotion'
  | 'promotion_required'
  | 'king_suicide'
  | 'self_check_unresolved'
  | 'hand_piece_not_found'
  | 'not_own_hand_piece'
  | 'occupied_drop_square'
  | 'undroppable_piece'
  | 'invalid_hand_piece_state'
  | 'dead_piece_drop'
  | 'nifu'
  | 'pawn_drop_mate'
  | 'game_already_ended';

export type SavedProposerTypeV1 = 'human' | 'local_ai' | 'shogi_engine';
export type SavedFoulReasonV1 =
  | SavedIllegalMoveReasonV1
  | 'perpetual_check_repetition';

export interface SavedPieceV1 {
  id: string;
  type: SavedPieceTypeV1;
  player: SavedPlayerV1;
  isPromoted: boolean;
}

export interface SavedSquareV1 {
  row: number;
  col: number;
  piece: SavedPieceV1 | null;
}

interface SavedMoveRecordBaseV1 {
  moveNumber: number;
  player: SavedPlayerV1;
  to: { row: number; col: number };
  pieceType: SavedPieceTypeV1;
  promotion: SavedMovePromotionV1;
  notation: string;
}

export type SavedMoveRecordV1 =
  | (SavedMoveRecordBaseV1 & {
      kind: 'move';
      from: { row: number; col: number };
      capturedPieceType: SavedPieceTypeV1 | null;
    })
  | (SavedMoveRecordBaseV1 & {
      kind: 'drop';
      from: null;
      pieceId: string;
      capturedPieceType: null;
      promotion: 'none';
    });

interface SavedFoulRecordBaseV1 {
  moveNumber: number;
  player: SavedPlayerV1;
  to: { row: number; col: number };
  pieceType: SavedPieceTypeV1 | null;
  reason: SavedIllegalMoveReasonV1;
  message: string;
  proposer: SavedProposerTypeV1;
  engineName?: string;
  timestamp?: number;
}

export type SavedFoulRecordV1 =
  | (SavedFoulRecordBaseV1 & {
      kind: 'move';
      from: { row: number; col: number };
    })
  | (SavedFoulRecordBaseV1 & {
      kind: 'drop';
      from: null;
      pieceId: string;
    });

interface SavedDecisiveGameResultBaseV1 {
  winner: SavedPlayerV1;
  loser: SavedPlayerV1;
  details?: string;
}

export type SavedGameResultV1 =
  | (SavedDecisiveGameResultBaseV1 & {
      endReason: 'foul_loss';
      foulReason: SavedFoulReasonV1;
    })
  | (SavedDecisiveGameResultBaseV1 & { endReason: 'checkmate' | 'resignation' })
  | {
      winner: null;
      loser: null;
      endReason: 'repetition' | 'five_hundred_move_jishogi';
      details?: string;
    }
  | {
      winner: null;
      loser: null;
      endReason: 'agreed_jishogi_draw';
      sentePoints: number;
      gotePoints: number;
      details?: string;
    }
  | (SavedDecisiveGameResultBaseV1 & {
      endReason: 'agreed_jishogi_point_loss';
      sentePoints: number;
      gotePoints: number;
    })
  | (SavedDecisiveGameResultBaseV1 & {
      endReason: 'entering_king_win' | 'entering_king_declaration_failure';
    })
  | {
      winner: null;
      loser: null;
      endReason: 'entering_king_draw';
      details?: string;
    };

export interface SavedPositionRecordV1 {
  key: string;
  historyIndex: number;
  movedBy: SavedPlayerV1 | null;
  gaveCheck: boolean;
}

export interface SavedMoveLimitJishogiStateV1 {
  kind: 'awaiting_continuous_check_end';
  checkingPlayer: SavedPlayerV1;
}

export interface SavedPositionSnapshotV1 {
  historyIndex: number;
  squares: SavedSquareV1[][];
  senteHand: SavedPieceV1[];
  goteHand: SavedPieceV1[];
  turn: SavedPlayerV1;
  moveNumber: number;
  status: SavedBoardStatusV1;
  lastMove: SavedMoveRecordV1 | null;
  result: SavedGameResultV1 | null;
}

export interface SavedLatestStateV1 {
  squares: SavedSquareV1[][];
  senteHand: SavedPieceV1[];
  goteHand: SavedPieceV1[];
  turn: SavedPlayerV1;
  moveNumber: number;
  status: SavedBoardStatusV1;
}

export interface ShogiGameRecordV1 {
  format: typeof SHOGI_GAME_RECORD_FORMAT;
  version: typeof SHOGI_GAME_RECORD_VERSION;
  exportedAt: string;
  initialPosition: 'hirate';
  latestState: SavedLatestStateV1;
  history: SavedMoveRecordV1[];
  lastMove: SavedMoveRecordV1 | null;
  result: SavedGameResultV1 | null;
  foulHistory: SavedFoulRecordV1[];
  positionHistory: SavedPositionRecordV1[];
  positionSnapshots: SavedPositionSnapshotV1[];
  moveLimitJishogi: SavedMoveLimitJishogiStateV1 | null;
}

function assertNever(value: never, valueName: string): never {
  const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
  throw new TypeError(`${valueName}にv1で未対応の値が含まれています: ${serialized}`);
}

function toSavedPlayerV1(player: Player): SavedPlayerV1 {
  switch (player) {
    case 'sente':
    case 'gote':
      return player;
    default:
      return assertNever(player, 'プレイヤー');
  }
}

function toSavedPieceTypeV1(pieceType: PieceType): SavedPieceTypeV1 {
  switch (pieceType) {
    case 'king':
    case 'rook':
    case 'bishop':
    case 'gold':
    case 'silver':
    case 'knight':
    case 'lance':
    case 'pawn':
      return pieceType;
    default:
      return assertNever(pieceType, '駒種');
  }
}

function toSavedBoardStatusV1(status: BoardStatus): SavedBoardStatusV1 {
  switch (status) {
    case 'preparation':
    case 'active':
    case 'check':
    case 'blunder':
    case 'evaluating':
    case 'ended':
      return status;
    default:
      return assertNever(status, '盤面状態');
  }
}

function toSavedMovePromotionV1(promotion: MovePromotion): SavedMovePromotionV1 {
  switch (promotion) {
    case 'none':
    case 'promote':
    case 'decline':
      return promotion;
    default:
      return assertNever(promotion, '成り状態');
  }
}

function toSavedIllegalMoveReasonV1(
  reason: IllegalMoveReason
): SavedIllegalMoveReasonV1 {
  switch (reason) {
    case 'out_of_bounds':
    case 'no_piece_at_source':
    case 'not_current_turn':
    case 'not_own_piece':
    case 'invalid_piece_move':
    case 'occupied_by_own_piece':
    case 'captured_king':
    case 'dead_piece':
    case 'promotion_choice_required':
    case 'invalid_promotion':
    case 'promotion_required':
    case 'king_suicide':
    case 'self_check_unresolved':
    case 'hand_piece_not_found':
    case 'not_own_hand_piece':
    case 'occupied_drop_square':
    case 'undroppable_piece':
    case 'invalid_hand_piece_state':
    case 'dead_piece_drop':
    case 'nifu':
    case 'pawn_drop_mate':
    case 'game_already_ended':
      return reason;
    default:
      return assertNever(reason, '反則理由');
  }
}

function toSavedProposerTypeV1(proposer: ProposerType): SavedProposerTypeV1 {
  switch (proposer) {
    case 'human':
    case 'local_ai':
    case 'shogi_engine':
      return proposer;
    default:
      return assertNever(proposer, '提案者種別');
  }
}

function toSavedMoveLimitKindV1(
  kind: MoveLimitJishogiState['kind']
): SavedMoveLimitJishogiStateV1['kind'] {
  switch (kind) {
    case 'awaiting_continuous_check_end':
      return kind;
    default:
      return assertNever(kind, '500手持将棋待機種別');
  }
}

function toSavedFoulReasonV1(
  reason: Extract<GameResult, { endReason: 'foul_loss' }>['foulReason']
): SavedFoulReasonV1 {
  if (reason === 'perpetual_check_repetition') return reason;
  return toSavedIllegalMoveReasonV1(reason);
}

function clonePiece(piece: Piece): SavedPieceV1 {
  return {
    id: piece.id,
    type: toSavedPieceTypeV1(piece.type),
    player: toSavedPlayerV1(piece.player),
    isPromoted: piece.isPromoted === true,
  };
}

function clonePieces(pieces: readonly Piece[]): SavedPieceV1[] {
  return pieces.map(clonePiece);
}

function cloneSquares(squares: readonly (readonly BoardSquare[])[]): SavedSquareV1[][] {
  return squares.map((row) =>
    row.map((square) => ({
      row: square.row,
      col: square.col,
      piece: square.piece ? clonePiece(square.piece) : null,
    }))
  );
}

function cloneMoveRecord(move: MoveRecord): SavedMoveRecordV1 {
  const common: SavedMoveRecordBaseV1 = {
    moveNumber: move.moveNumber,
    player: toSavedPlayerV1(move.player),
    to: { row: move.to.row, col: move.to.col },
    pieceType: toSavedPieceTypeV1(move.pieceType),
    promotion: toSavedMovePromotionV1(move.promotion),
    notation: move.notation,
  };

  const kind = move.kind;
  switch (kind) {
    case 'move':
      return {
        ...common,
        kind: 'move',
        from: { row: move.from.row, col: move.from.col },
        capturedPieceType:
          move.capturedPieceType === null
            ? null
            : toSavedPieceTypeV1(move.capturedPieceType),
      };
    case 'drop':
      if (common.promotion !== 'none') {
        throw new TypeError('駒打ちの成り状態はnoneである必要があります。');
      }
      return {
        ...common,
        kind: 'drop',
        from: null,
        pieceId: move.pieceId,
        capturedPieceType: null,
        promotion: 'none',
      };
    default:
      return assertNever(kind, '着手種別');
  }
}

function cloneOptionalMoveRecord(move: MoveRecord | null | undefined): SavedMoveRecordV1 | null {
  return move ? cloneMoveRecord(move) : null;
}

function cloneFoulRecord(foul: FoulRecord): SavedFoulRecordV1 {
  const common: SavedFoulRecordBaseV1 = {
    moveNumber: foul.moveNumber,
    player: toSavedPlayerV1(foul.player),
    to: { row: foul.to.row, col: foul.to.col },
    pieceType: foul.pieceType === null ? null : toSavedPieceTypeV1(foul.pieceType),
    reason: toSavedIllegalMoveReasonV1(foul.reason),
    message: foul.message,
    proposer: toSavedProposerTypeV1(foul.proposer),
    ...(foul.engineName === undefined ? {} : { engineName: foul.engineName }),
    ...(foul.timestamp === undefined ? {} : { timestamp: foul.timestamp }),
  };

  const kind = foul.kind;
  switch (kind) {
    case 'move':
      return { ...common, kind: 'move', from: { row: foul.from.row, col: foul.from.col } };
    case 'drop':
      return { ...common, kind: 'drop', from: null, pieceId: foul.pieceId };
    default:
      return assertNever(kind, '反則記録種別');
  }
}

function cloneGameResult(result: GameResult | null | undefined): SavedGameResultV1 | null {
  if (!result) return null;

  switch (result.endReason) {
    case 'foul_loss':
      return {
        winner: toSavedPlayerV1(result.winner),
        loser: toSavedPlayerV1(result.loser),
        endReason: 'foul_loss',
        foulReason: toSavedFoulReasonV1(result.foulReason),
        ...(result.details === undefined ? {} : { details: result.details }),
      };
    case 'checkmate':
      return {
        winner: toSavedPlayerV1(result.winner),
        loser: toSavedPlayerV1(result.loser),
        endReason: 'checkmate',
        ...(result.details === undefined ? {} : { details: result.details }),
      };
    case 'resignation':
      return {
        winner: toSavedPlayerV1(result.winner),
        loser: toSavedPlayerV1(result.loser),
        endReason: 'resignation',
        ...(result.details === undefined ? {} : { details: result.details }),
      };
    case 'repetition':
      return {
        winner: null,
        loser: null,
        endReason: 'repetition',
        ...(result.details === undefined ? {} : { details: result.details }),
      };
    case 'five_hundred_move_jishogi':
      return {
        winner: null,
        loser: null,
        endReason: 'five_hundred_move_jishogi',
        ...(result.details === undefined ? {} : { details: result.details }),
      };
    case 'agreed_jishogi_draw':
      return {
        winner: null,
        loser: null,
        endReason: 'agreed_jishogi_draw',
        sentePoints: result.sentePoints,
        gotePoints: result.gotePoints,
        ...(result.details === undefined ? {} : { details: result.details }),
      };
    case 'agreed_jishogi_point_loss':
      return {
        winner: toSavedPlayerV1(result.winner),
        loser: toSavedPlayerV1(result.loser),
        endReason: 'agreed_jishogi_point_loss',
        sentePoints: result.sentePoints,
        gotePoints: result.gotePoints,
        ...(result.details === undefined ? {} : { details: result.details }),
      };
    case 'entering_king_win':
      return {
        winner: toSavedPlayerV1(result.winner),
        loser: toSavedPlayerV1(result.loser),
        endReason: 'entering_king_win',
        ...(result.details === undefined ? {} : { details: result.details }),
      };
    case 'entering_king_draw':
      return {
        winner: null,
        loser: null,
        endReason: 'entering_king_draw',
        ...(result.details === undefined ? {} : { details: result.details }),
      };
    case 'entering_king_declaration_failure':
      return {
        winner: toSavedPlayerV1(result.winner),
        loser: toSavedPlayerV1(result.loser),
        endReason: 'entering_king_declaration_failure',
        ...(result.details === undefined ? {} : { details: result.details }),
      };
    default:
      return assertNever(result, '終局結果');
  }
}

function clonePositionSnapshot(snapshot: PositionSnapshot): SavedPositionSnapshotV1 {
  return {
    historyIndex: snapshot.historyIndex,
    squares: cloneSquares(snapshot.squares),
    senteHand: clonePieces(snapshot.senteHand),
    goteHand: clonePieces(snapshot.goteHand),
    turn: toSavedPlayerV1(snapshot.turn),
    moveNumber: snapshot.moveNumber,
    status: toSavedBoardStatusV1(snapshot.status),
    lastMove: cloneOptionalMoveRecord(snapshot.lastMove),
    result: cloneGameResult(snapshot.result),
  };
}

function clonePositionRecord(position: PositionRecord): SavedPositionRecordV1 {
  return {
    key: position.key,
    historyIndex: position.historyIndex,
    movedBy: position.movedBy === null ? null : toSavedPlayerV1(position.movedBy),
    gaveCheck: position.gaveCheck,
  };
}

function cloneMoveLimitJishogiState(
  state: MoveLimitJishogiState
): SavedMoveLimitJishogiStateV1 {
  return {
    kind: toSavedMoveLimitKindV1(state.kind),
    checkingPlayer: toSavedPlayerV1(state.checkingPlayer),
  };
}

function assertJsonSafe(value: unknown, path = '$', ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} に有限でない数値が含まれています。`);
    return;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${path} にJSONへ保存できない値が含まれています。`);
  }
  if (ancestors.has(value)) throw new TypeError(`${path} に循環参照が含まれています。`);

  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonSafe(item, `${path}[${index}]`, ancestors));
  } else {
    for (const [key, item] of Object.entries(value)) {
      assertJsonSafe(item, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

/** Creates a versioned, UI-free, independent snapshot of the live game state. */
export function createShogiGameRecordV1(
  state: BoardState,
  exportedAt: Date
): ShogiGameRecordV1 {
  const record: ShogiGameRecordV1 = {
    format: SHOGI_GAME_RECORD_FORMAT,
    version: SHOGI_GAME_RECORD_VERSION,
    exportedAt: exportedAt.toISOString(),
    initialPosition: 'hirate',
    latestState: {
      squares: cloneSquares(state.squares),
      senteHand: clonePieces(state.senteHand),
      goteHand: clonePieces(state.goteHand),
      turn: toSavedPlayerV1(state.turn),
      moveNumber: state.moveNumber,
      status: toSavedBoardStatusV1(state.status),
    },
    history: state.history.map(cloneMoveRecord),
    lastMove: cloneOptionalMoveRecord(state.lastMove),
    result: cloneGameResult(state.result),
    foulHistory: (state.foulHistory ?? []).map(cloneFoulRecord),
    positionHistory: (state.positionHistory ?? []).map(clonePositionRecord),
    positionSnapshots: (state.positionSnapshots ?? []).map(clonePositionSnapshot),
    moveLimitJishogi: state.moveLimitJishogi
      ? cloneMoveLimitJishogiState(state.moveLimitJishogi)
      : null,
  };

  assertJsonSafe(record);
  return record;
}

export function serializeShogiGameRecordV1(state: BoardState, exportedAt: Date): string {
  return `${JSON.stringify(createShogiGameRecordV1(state, exportedAt), null, 2)}\n`;
}

export function createShogiGameRecordFilename(exportedAt: Date): string {
  const timestamp = exportedAt.toISOString().replace(/[-:]/g, '').replace('T', '-');
  return `shogi-game-${timestamp}.json`;
}

/** Starts a browser download and releases all temporary browser resources. */
export function downloadShogiGameRecord(json: string, filename: string): void {
  const blob = new Blob([json], { type: SHOGI_GAME_RECORD_MIME_TYPE });
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
