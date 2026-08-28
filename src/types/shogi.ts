/**
 * Shogi Domain Types & Constants
 * Fully unified piece definitions, accessible screen-reader labels, and symmetric board geometry.
 */

import { createPositionKey } from '../domain/shogi/repetition';

export type Player = 'sente' | 'gote';

export type PieceType =
  | 'king'
  | 'rook'
  | 'bishop'
  | 'gold'
  | 'silver'
  | 'knight'
  | 'lance'
  | 'pawn';

export interface Piece {
  id: string;
  type: PieceType;
  player: Player;
  isPromoted?: boolean;
}

export interface PieceDisplayInfo {
  topChar: string;
  bottomChar: string;
  fullName: string;
  ariaName: string;
  isPromoted: boolean;
  isPromotedColor: boolean;
}

export interface BoardSquare {
  row: number; // 0 to 8 (top to bottom: 0 = Rank 1, 8 = Rank 9)
  col: number; // 0 to 8 (left to right: 0 = File 9, 8 = File 1)
  file: number; // 9 to 1 (筋: right to left from sente's view; col 0 is 9, col 8 is 1)
  rank: number; // 1 to 9 (段: top to bottom; row 0 is 1, row 8 is 9)
  rankKanji: string; // '一' | '二' | ... | '九'
  coordinateLabel: string; // e.g. '7七', '5一'
  piece: Piece | null;
  hasBottomRightStarMarker: boolean; // True if this square's bottom-right intersection has a star marker (at 3/9 and 6/9)
}

export type BoardStatus = 'preparation' | 'active' | 'check' | 'blunder' | 'evaluating' | 'ended';

export type TableViewMode = 'research' | 'spectator' | 'analysis';

export type ExecutionMode = 'assist' | 'strict';

export type ProposerType = 'human' | 'local_ai' | 'shogi_engine';

export type PromotionChoice = 'promote' | 'decline';

export type MovePromotion = 'none' | PromotionChoice;

/**
 * Standardized English identifiers for illegal move reasons.
 */
export type IllegalMoveReason =
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

export type MoveValidationResult =
  | { isValid: true }
  | {
      isValid: false;
      reason: IllegalMoveReason;
      message: string;
    };

interface MoveRecordBase {
  moveNumber: number;
  player: Player;
  to: { row: number; col: number };
  pieceType: PieceType;
  promotion: MovePromotion;
  notation: string;
}

export interface NormalMoveRecord extends MoveRecordBase {
  kind: 'move';
  from: { row: number; col: number };
  capturedPieceType: PieceType | null;
}

export interface DropMoveRecord extends MoveRecordBase {
  kind: 'drop';
  from: null;
  pieceId: string;
  capturedPieceType: null;
  promotion: 'none';
}

export type MoveRecord = NormalMoveRecord | DropMoveRecord;

interface FoulRecordBase {
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

export interface MoveFoulRecord extends FoulRecordBase {
  kind: 'move';
  from: { row: number; col: number };
}

export interface DropFoulRecord extends FoulRecordBase {
  kind: 'drop';
  from: null;
  pieceId: string;
}

export type FoulRecord = MoveFoulRecord | DropFoulRecord;

export type GameEndReason = 'foul_loss' | 'resignation' | 'checkmate' | 'repetition';

interface DecisiveGameResultBase {
  winner: Player;
  loser: Player;
  details?: string;
}

export interface FoulLossGameResult extends DecisiveGameResultBase {
  endReason: 'foul_loss';
  foulReason: IllegalMoveReason | 'perpetual_check_repetition';
}

export interface CheckmateGameResult extends DecisiveGameResultBase {
  endReason: 'checkmate';
}

export interface ResignationGameResult extends DecisiveGameResultBase {
  endReason: 'resignation';
}

export interface RepetitionGameResult {
  winner: null;
  loser: null;
  endReason: 'repetition';
  details?: string;
}

export type GameResult =
  | FoulLossGameResult
  | CheckmateGameResult
  | ResignationGameResult
  | RepetitionGameResult;

export interface PositionRecord {
  key: string;
  historyIndex: number;
  movedBy: Player | null;
  gaveCheck: boolean;
}

export interface BoardState {
  squares: BoardSquare[][]; // 9x9 grid
  senteHand: Piece[];
  goteHand: Piece[];
  turn: Player;
  moveNumber: number;
  status: BoardStatus;
  viewMode: TableViewMode;
  history: MoveRecord[];
  lastMove?: MoveRecord | null;
  result?: GameResult | null;
  foulHistory?: FoulRecord[];
  positionHistory?: PositionRecord[];
}

export const RANK_KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;
export const FILE_NUMBERS = [9, 8, 7, 6, 5, 4, 3, 2, 1] as const;

/**
 * Checks if a piece type can be promoted.
 * Note: King (王将/玉将) and Gold (金将) cannot promote.
 */
export function canPromote(type: PieceType): boolean {
  return type !== 'king' && type !== 'gold';
}

/**
 * Unified getter for piece display characters, formal name, and ARIA label.
 * Single source of truth for both visual rendering and accessibility.
 */
export function getPieceDisplayInfo(
  type: PieceType,
  player: Player,
  isPromoted: boolean = false
): PieceDisplayInfo {
  const isActualPromoted = isPromoted && canPromote(type);
  const playerLabel = player === 'sente' ? '先手' : '後手';

  if (type === 'king') {
    const kanjiTop = player === 'sente' ? '王' : '玉';
    const fullName = player === 'sente' ? '王将' : '玉将';
    return {
      topChar: kanjiTop,
      bottomChar: '将',
      fullName,
      ariaName: `${playerLabel}の${fullName}`,
      isPromoted: false,
      isPromotedColor: false,
    };
  }

  if (type === 'gold') {
    return {
      topChar: '金',
      bottomChar: '将',
      fullName: '金将',
      ariaName: `${playerLabel}の金将`,
      isPromoted: false,
      isPromotedColor: false,
    };
  }

  if (isActualPromoted) {
    switch (type) {
      case 'rook':
        return {
          topChar: '竜',
          bottomChar: '王',
          fullName: '竜王',
          ariaName: `${playerLabel}の竜王`,
          isPromoted: true,
          isPromotedColor: true,
        };
      case 'bishop':
        return {
          topChar: '竜',
          bottomChar: '馬',
          fullName: '竜馬',
          ariaName: `${playerLabel}の竜馬`,
          isPromoted: true,
          isPromotedColor: true,
        };
      case 'silver':
        return {
          topChar: '成',
          bottomChar: '銀',
          fullName: '成銀',
          ariaName: `${playerLabel}の成銀`,
          isPromoted: true,
          isPromotedColor: true,
        };
      case 'knight':
        return {
          topChar: '成',
          bottomChar: '桂',
          fullName: '成桂',
          ariaName: `${playerLabel}の成桂`,
          isPromoted: true,
          isPromotedColor: true,
        };
      case 'lance':
        return {
          topChar: '成',
          bottomChar: '香',
          fullName: '成香',
          ariaName: `${playerLabel}の成香`,
          isPromoted: true,
          isPromotedColor: true,
        };
      case 'pawn':
        return {
          topChar: 'と',
          bottomChar: '金',
          fullName: 'と金',
          ariaName: `${playerLabel}のと金`,
          isPromoted: true,
          isPromotedColor: true,
        };
      default:
        break;
    }
  }

  // Standard non-promoted pieces
  switch (type) {
    case 'rook':
      return {
        topChar: '飛',
        bottomChar: '車',
        fullName: '飛車',
        ariaName: `${playerLabel}の飛車`,
        isPromoted: false,
        isPromotedColor: false,
      };
    case 'bishop':
      return {
        topChar: '角',
        bottomChar: '行',
        fullName: '角行',
        ariaName: `${playerLabel}の角行`,
        isPromoted: false,
        isPromotedColor: false,
      };
    case 'silver':
      return {
        topChar: '銀',
        bottomChar: '将',
        fullName: '銀将',
        ariaName: `${playerLabel}の銀将`,
        isPromoted: false,
        isPromotedColor: false,
      };
    case 'knight':
      return {
        topChar: '桂',
        bottomChar: '馬',
        fullName: '桂馬',
        ariaName: `${playerLabel}の桂馬`,
        isPromoted: false,
        isPromotedColor: false,
      };
    case 'lance':
      return {
        topChar: '香',
        bottomChar: '車',
        fullName: '香車',
        ariaName: `${playerLabel}の香車`,
        isPromoted: false,
        isPromotedColor: false,
      };
    case 'pawn':
      return {
        topChar: '歩',
        bottomChar: '兵',
        fullName: '歩兵',
        ariaName: `${playerLabel}の歩兵`,
        isPromoted: false,
        isPromotedColor: false,
      };
  }
}

/**
 * Standard Hirate (平手) initial board setup.
 *
 * Sente (先手 - Bottom):
 *  - Rank 7 (row 6): Pawns (歩兵) on all 9 files
 *  - Rank 8 (row 7): 88 Bishop (角行), 28 Rook (飛車)
 *  - Rank 9 (row 8): 99 Lance, 89 Knight, 79 Silver, 69 Gold, 59 King (王将), 49 Gold, 39 Silver, 29 Knight, 19 Lance
 *
 * Gote (後手 - Top):
 *  - Rank 1 (row 0): 91 Lance, 81 Knight, 71 Silver, 61 Gold, 51 King (玉将), 41 Gold, 31 Silver, 21 Knight, 11 Lance
 *  - Rank 2 (row 1): 82 Rook (飛車), 22 Bishop (角行)
 *  - Rank 3 (row 2): Pawns (歩兵) on all 9 files
 */
export function createInitialBoardState(): BoardState {
  const squares: BoardSquare[][] = [];

  for (let row = 0; row < 9; row++) {
    const rowSquares: BoardSquare[] = [];
    const rank = row + 1;
    const rankKanji = RANK_KANJI[row];

    for (let col = 0; col < 9; col++) {
      const file = 9 - col;
      const coordinateLabel = `${file}${rankKanji}`;

      // Star markers on intersections at exactly 3/9 and 6/9 of board dimensions.
      // When rendered at the bottom-right of square (row, col), the valid 0-indexed indices are:
      // (row 2, col 2) -> intersection between rank 3/4 & file 7/6 (3/9 width, 3/9 height)
      // (row 2, col 5) -> intersection between rank 3/4 & file 4/3 (6/9 width, 3/9 height)
      // (row 5, col 2) -> intersection between rank 6/7 & file 7/6 (3/9 width, 6/9 height)
      // (row 5, col 5) -> intersection between rank 6/7 & file 4/3 (6/9 width, 6/9 height)
      const hasBottomRightStarMarker = (row === 2 || row === 5) && (col === 2 || col === 5);

      let piece: Piece | null = null;

      // Rank 1 (row 0): Gote base line
      if (row === 0) {
        if (file === 9 || file === 1) {
          piece = { id: `gote-lance-${file}`, type: 'lance', player: 'gote' };
        } else if (file === 8 || file === 2) {
          piece = { id: `gote-knight-${file}`, type: 'knight', player: 'gote' };
        } else if (file === 7 || file === 3) {
          piece = { id: `gote-silver-${file}`, type: 'silver', player: 'gote' };
        } else if (file === 6 || file === 4) {
          piece = { id: `gote-gold-${file}`, type: 'gold', player: 'gote' };
        } else if (file === 5) {
          piece = { id: `gote-king-5`, type: 'king', player: 'gote' };
        }
      }
      // Rank 2 (row 1): Gote special pieces
      else if (row === 1) {
        if (file === 8) {
          piece = { id: `gote-rook-8`, type: 'rook', player: 'gote' };
        } else if (file === 2) {
          piece = { id: `gote-bishop-2`, type: 'bishop', player: 'gote' };
        }
      }
      // Rank 3 (row 2): Gote pawns
      else if (row === 2) {
        piece = { id: `gote-pawn-${file}`, type: 'pawn', player: 'gote' };
      }
      // Rank 7 (row 6): Sente pawns
      else if (row === 6) {
        piece = { id: `sente-pawn-${file}`, type: 'pawn', player: 'sente' };
      }
      // Rank 8 (row 7): Sente special pieces
      else if (row === 7) {
        if (file === 8) {
          piece = { id: `sente-bishop-8`, type: 'bishop', player: 'sente' };
        } else if (file === 2) {
          piece = { id: `sente-rook-2`, type: 'rook', player: 'sente' };
        }
      }
      // Rank 9 (row 8): Sente base line
      else if (row === 8) {
        if (file === 9 || file === 1) {
          piece = { id: `sente-lance-${file}`, type: 'lance', player: 'sente' };
        } else if (file === 8 || file === 2) {
          piece = { id: `sente-knight-${file}`, type: 'knight', player: 'sente' };
        } else if (file === 7 || file === 3) {
          piece = { id: `sente-silver-${file}`, type: 'silver', player: 'sente' };
        } else if (file === 6 || file === 4) {
          piece = { id: `sente-gold-${file}`, type: 'gold', player: 'sente' };
        } else if (file === 5) {
          piece = { id: `sente-king-5`, type: 'king', player: 'sente' };
        }
      }

      rowSquares.push({
        row,
        col,
        file,
        rank,
        rankKanji,
        coordinateLabel,
        piece,
        hasBottomRightStarMarker,
      });
    }

    squares.push(rowSquares);
  }

  const state: BoardState = {
    squares,
    senteHand: [],
    goteHand: [],
    turn: 'sente',
    moveNumber: 1,
    status: 'active',
    viewMode: 'research',
    history: [],
    lastMove: null,
    result: null,
    foulHistory: [],
  };

  state.positionHistory = [
    {
      key: createPositionKey(state),
      historyIndex: 0,
      movedBy: null,
      gaveCheck: false,
    },
  ];
  return state;
}

/**
 * Generates an accessible screen-reader description for a square and piece.
 * E.g. "5筋 9段、先手の王将", "5筋 1段、後手の玉将", "4筋 5段、空のマス"
 */
export function getSquareAriaLabel(square: BoardSquare): string {
  const positionStr = `${square.file}筋 ${square.rank}段`;
  if (!square.piece) {
    return `${positionStr}、空のマス`;
  }

  const displayInfo = getPieceDisplayInfo(
    square.piece.type,
    square.piece.player,
    square.piece.isPromoted
  );

  return `${positionStr}、${displayInfo.ariaName}`;
}
