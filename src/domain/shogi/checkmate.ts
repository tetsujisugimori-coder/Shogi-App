/** Pure check and checkmate queries for an arbitrary player. */
import { BoardState, Player } from '../../types/shogi';
import { isKingInCheck } from './attacks';
import { getLegalDropSquares } from './dropRules';
import { getLegalMoves } from './moves';

/** Returns whether the specified player is currently in check. */
export function isPlayerInCheck(state: BoardState, player: Player): boolean {
  return isKingInCheck(state.squares, player);
}

/** Returns whether the player has at least one legal on-board move. */
export function hasLegalBoardMove(state: BoardState, player: Player): boolean {
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const piece = state.squares[row][col].piece;
      if (
        piece?.player === player &&
        getLegalMoves(state.squares, { row, col }, player).length > 0
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Returns whether the player can legally drop any piece from hand. */
export function hasLegalDrop(state: BoardState, player: Player): boolean {
  const hand = player === 'sente' ? state.senteHand : state.goteHand;
  if (hand.length === 0) return false;

  // Drop validation is turn-aware. This shallow analysis view changes no input references.
  const analysisState: BoardState = {
    ...state,
    turn: player,
    status: 'active',
    result: null,
  };

  return hand.some(
    (piece) => getLegalDropSquares(analysisState, piece.id).length > 0
  );
}

/** Returns whether the player has any legal response, on board or from hand. */
export function hasLegalResponse(state: BoardState, player: Player): boolean {
  return hasLegalBoardMove(state, player) || hasLegalDrop(state, player);
}

/** A player is checkmated only when in check and no legal response exists. */
export function isCheckmate(state: BoardState, player: Player): boolean {
  return isPlayerInCheck(state, player) && !hasLegalResponse(state, player);
}
