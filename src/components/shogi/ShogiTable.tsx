import React from 'react';
import { BoardSquare, BoardStatus, Piece as PieceModel, TableViewMode } from '../../types/shogi';
import { ShogiBoard } from './ShogiBoard';
import { PieceStand } from './PieceStand';

interface ShogiTableProps {
  squares: BoardSquare[][];
  senteHand?: PieceModel[];
  goteHand?: PieceModel[];
  status?: BoardStatus;
  viewMode?: TableViewMode;
  className?: string;
  selectedSquare?: { row: number; col: number } | null;
  onSquareClick?: (square: BoardSquare) => void;
  topPlayerSlot?: React.ReactNode;
  bottomPlayerSlot?: React.ReactNode;
  leftPanelSlot?: React.ReactNode;
  rightPanelSlot?: React.ReactNode;
}

export const ShogiTable: React.FC<ShogiTableProps> = ({
  squares,
  senteHand = [],
  goteHand = [],
  status = 'preparation',
  viewMode = 'research',
  className = '',
  selectedSquare = null,
  onSquareClick,
  topPlayerSlot,
  bottomPlayerSlot,
  leftPanelSlot,
  rightPanelSlot,
}) => {
  return (
    <div
      id="shogi-match-table"
      data-view={viewMode}
      data-board-status={status}
      className={`relative w-full max-w-4xl mx-auto rounded-2xl p-4 sm:p-8 md:p-10 transition-all duration-300 ${className}`}
      style={{
        // Deep dark matte studio table texture matching the reference image
        background:
          'radial-gradient(ellipse at 50% 50%, #1e1b18 0%, #141210 50%, #0d0c0a 100%)',
        boxShadow: `
          0 25px 50px -12px rgba(0, 0, 0, 0.9),
          inset 0 1px 1px rgba(255, 255, 255, 0.05),
          inset 0 0 80px rgba(0, 0, 0, 0.7)
        `,
        border: '1px solid rgba(70, 55, 45, 0.25)',
      }}
    >
      {/* Studio Lighting Vignette Overlay */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none rounded-2xl opacity-40"
        style={{
          backgroundImage:
            'radial-gradient(circle at 50% 48%, rgba(245, 180, 100, 0.08) 0%, transparent 65%)',
        }}
      />

      {/* Future Top Player Slot */}
      {topPlayerSlot && <div className="mb-3 w-full flex justify-center">{topPlayerSlot}</div>}

      {/* Main Board & Komadai Layout (Centered vertically, matching reference image) */}
      <div className="relative z-10 flex flex-col items-center gap-5 sm:gap-7">
        {/* Top: Gote's Piece Stand (Centered above the board as in the image) */}
        <div className="w-full flex justify-center">
          <PieceStand player="gote" pieces={goteHand} isActive={false} />
        </div>

        {/* Center: The Shogi Board (Slight top-down perspective, high clarity) */}
        <div
          id="shogi-board-perspective-container"
          className="flex justify-center items-center w-full transition-transform duration-300"
          style={{
            perspective: '1400px',
          }}
        >
          <div
            className="transform-gpu transition-all duration-300"
            style={{
              transform:
                viewMode === 'research'
                  ? 'rotateX(2.5deg)'
                  : viewMode === 'spectator'
                  ? 'rotateX(8deg) rotateY(-4deg)'
                  : 'none',
              transformOrigin: 'center bottom',
            }}
          >
            <ShogiBoard
              squares={squares}
              status={status}
              selectedSquare={selectedSquare}
              onSquareClick={onSquareClick}
            />
          </div>
        </div>

        {/* Bottom: Sente's Piece Stand (Centered below the board as in the image) */}
        <div className="w-full flex justify-center">
          <PieceStand player="sente" pieces={senteHand} isActive={true} />
        </div>
      </div>

      {/* Future Bottom Player Slot */}
      {bottomPlayerSlot && <div className="mt-3 w-full flex justify-center">{bottomPlayerSlot}</div>}

      {/* Future Side Panel Slots */}
      {leftPanelSlot && (
        <div className="hidden lg:block absolute left-4 top-1/2 -translate-y-1/2">
          {leftPanelSlot}
        </div>
      )}
      {rightPanelSlot && (
        <div className="hidden lg:block absolute right-4 top-1/2 -translate-y-1/2">
          {rightPanelSlot}
        </div>
      )}
    </div>
  );
};
