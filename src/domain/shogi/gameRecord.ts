import type {
  BoardSquare,
  BoardState,
  BoardStatus,
  FoulRecord,
  GameResult,
  IllegalMoveReason,
  MovePromotion,
  MoveRecord,
  Piece,
  PieceType,
  Player,
  PositionSnapshot,
  ProposerType,
} from '../../types/shogi';

export const SHOGI_GAME_RECORD_FORMAT = 'shogi-app-game-record' as const;
export const SHOGI_GAME_RECORD_VERSION = 1 as const;
export const SHOGI_GAME_RECORD_MIME_TYPE = 'application/json;charset=utf-8' as const;

export interface SavedPieceV1 {
  id: string;
  type: PieceType;
  player: Player;
  isPromoted: boolean;
}

export interface SavedSquareV1 {
  row: number;
  col: number;
  piece: SavedPieceV1 | null;
}

interface SavedMoveRecordBaseV1 {
  moveNumber: number;
  player: Player;
  to: { row: number; col: number };
  pieceType: PieceType;
  promotion: MovePromotion;
  notation: string;
}

export type SavedMoveRecordV1 =
  | (SavedMoveRecordBaseV1 & {
      kind: 'move';
      from: { row: number; col: number };
      capturedPieceType: PieceType | null;
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
  player: Player;
  to: { row: number; col: number };
  pieceType: PieceType | null;
  reason: IllegalMoveReason;
  message: string;
  proposer: ProposerType;
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
  winner: Player;
  loser: Player;
  details?: string;
}

export type SavedGameResultV1 =
  | (SavedDecisiveGameResultBaseV1 & {
      endReason: 'foul_loss';
      foulReason: IllegalMoveReason | 'perpetual_check_repetition';
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
  movedBy: Player | null;
  gaveCheck: boolean;
}

export interface SavedMoveLimitJishogiStateV1 {
  kind: 'awaiting_continuous_check_end';
  checkingPlayer: Player;
}

export interface SavedPositionSnapshotV1 {
  historyIndex: number;
  squares: SavedSquareV1[][];
  senteHand: SavedPieceV1[];
  goteHand: SavedPieceV1[];
  turn: Player;
  moveNumber: number;
  status: BoardStatus;
  lastMove: SavedMoveRecordV1 | null;
  result: SavedGameResultV1 | null;
}

export interface SavedLatestStateV1 {
  squares: SavedSquareV1[][];
  senteHand: SavedPieceV1[];
  goteHand: SavedPieceV1[];
  turn: Player;
  moveNumber: number;
  status: BoardStatus;
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

function clonePiece(piece: Piece): SavedPieceV1 {
  return {
    id: piece.id,
    type: piece.type,
    player: piece.player,
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
  const common = {
    moveNumber: move.moveNumber,
    player: move.player,
    to: { row: move.to.row, col: move.to.col },
    pieceType: move.pieceType,
    promotion: move.promotion,
    notation: move.notation,
  };

  return move.kind === 'move'
    ? {
        ...common,
        kind: 'move',
        from: { row: move.from.row, col: move.from.col },
        capturedPieceType: move.capturedPieceType,
      }
    : {
        ...common,
        kind: 'drop',
        from: null,
        pieceId: move.pieceId,
        capturedPieceType: null,
        promotion: 'none',
      };
}

function cloneOptionalMoveRecord(move: MoveRecord | null | undefined): SavedMoveRecordV1 | null {
  return move ? cloneMoveRecord(move) : null;
}

function cloneFoulRecord(foul: FoulRecord): SavedFoulRecordV1 {
  const common: SavedFoulRecordBaseV1 = {
    moveNumber: foul.moveNumber,
    player: foul.player,
    to: { row: foul.to.row, col: foul.to.col },
    pieceType: foul.pieceType,
    reason: foul.reason,
    message: foul.message,
    proposer: foul.proposer,
    ...(foul.engineName === undefined ? {} : { engineName: foul.engineName }),
    ...(foul.timestamp === undefined ? {} : { timestamp: foul.timestamp }),
  };

  return foul.kind === 'move'
    ? { ...common, kind: 'move', from: { row: foul.from.row, col: foul.from.col } }
    : { ...common, kind: 'drop', from: null, pieceId: foul.pieceId };
}

function cloneGameResult(result: GameResult | null | undefined): SavedGameResultV1 | null {
  if (!result) return null;

  switch (result.endReason) {
    case 'foul_loss':
      return {
        winner: result.winner,
        loser: result.loser,
        endReason: result.endReason,
        foulReason: result.foulReason,
        ...(result.details === undefined ? {} : { details: result.details }),
      };
    case 'agreed_jishogi_draw':
      return {
        winner: null,
        loser: null,
        endReason: result.endReason,
        sentePoints: result.sentePoints,
        gotePoints: result.gotePoints,
        ...(result.details === undefined ? {} : { details: result.details }),
      };
    case 'agreed_jishogi_point_loss':
      return {
        winner: result.winner,
        loser: result.loser,
        endReason: result.endReason,
        sentePoints: result.sentePoints,
        gotePoints: result.gotePoints,
        ...(result.details === undefined ? {} : { details: result.details }),
      };
    case 'checkmate':
    case 'resignation':
    case 'repetition':
    case 'five_hundred_move_jishogi':
    case 'entering_king_win':
    case 'entering_king_draw':
    case 'entering_king_declaration_failure':
      return {
        winner: result.winner,
        loser: result.loser,
        endReason: result.endReason,
        ...(result.details === undefined ? {} : { details: result.details }),
      } as SavedGameResultV1;
  }
}

function clonePositionSnapshot(snapshot: PositionSnapshot): SavedPositionSnapshotV1 {
  return {
    historyIndex: snapshot.historyIndex,
    squares: cloneSquares(snapshot.squares),
    senteHand: clonePieces(snapshot.senteHand),
    goteHand: clonePieces(snapshot.goteHand),
    turn: snapshot.turn,
    moveNumber: snapshot.moveNumber,
    status: snapshot.status,
    lastMove: cloneOptionalMoveRecord(snapshot.lastMove),
    result: cloneGameResult(snapshot.result),
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
      turn: state.turn,
      moveNumber: state.moveNumber,
      status: state.status,
    },
    history: state.history.map(cloneMoveRecord),
    lastMove: cloneOptionalMoveRecord(state.lastMove),
    result: cloneGameResult(state.result),
    foulHistory: (state.foulHistory ?? []).map(cloneFoulRecord),
    positionHistory: (state.positionHistory ?? []).map((position) => ({ ...position })),
    positionSnapshots: (state.positionSnapshots ?? []).map(clonePositionSnapshot),
    moveLimitJishogi: state.moveLimitJishogi ? { ...state.moveLimitJishogi } : null,
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
