import React from 'react';
import { BoardSquare, BoardStatus, FILE_NUMBERS, RANK_KANJI, getSquareAriaLabel } from '../../types/shogi';
import { Piece } from './Piece';

interface ShogiBoardProps {
  squares: BoardSquare[][];
  status?: BoardStatus;
  className?: string;
  selectedSquare?: { row: number; col: number } | null;
  onSquareClick?: (square: BoardSquare) => void;
}

export const ShogiBoard: React.FC<ShogiBoardProps> = ({
  squares,
  status = 'preparation',
  className = '',
  selectedSquare = null,
  onSquareClick,
}) => {
  const isInteractive = typeof onSquareClick === 'function';

  const handleKeyDown = (e: React.KeyboardEvent, square: BoardSquare) => {
    if (!isInteractive) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSquareClick(square);
    }
  };

  return (
    <div
      id="shogi-board-wrapper"
      className={`relative inline-block select-none max-w-full ${className}`}
      data-board-status={status}
    >
      {/* Outer Container with Coordinate Labels */}
      <div className="flex flex-col items-center">
        {/* Top File Coordinates (9 to 1) */}
        <div
          aria-hidden="true"
          className="grid grid-cols-9 w-[min(82vw,510px)] sm:w-[510px] px-3 sm:px-4 mb-1 text-center font-serif text-[11px] sm:text-xs font-semibold text-amber-200/60 tracking-wider"
        >
          {FILE_NUMBERS.map((file) => (
            <div key={`file-coord-${file}`} className="flex justify-center items-center">
              <span>{file}</span>
            </div>
          ))}
        </div>

        {/* Board Main Body with Side Rank Coordinates */}
        <div className="flex items-stretch justify-center">
          {/* 3D Solid Wooden Board Chassis (厚みのある本榧盤) */}
          <div
            id="shogi-board-frame"
            className="relative rounded-sm transition-all duration-300"
            style={{
              boxShadow: `
                0 30px 60px -15px rgba(0, 0, 0, 0.9),
                0 15px 25px -5px rgba(0, 0, 0, 0.7),
                0 0 1px 1px rgba(255, 100, 50, 0.25)
              `,
            }}
          >
            {/* Ambient Warm Neon Rim Reflection (top edge glow as in reference image) */}
            <div
              aria-hidden="true"
              className="absolute -top-[1px] inset-x-0 h-[2px] bg-gradient-to-r from-rose-600/30 via-orange-500/80 to-rose-600/30 rounded-t-sm shadow-[0_0_12px_rgba(249,115,22,0.6)] z-20 pointer-events-none"
            />
            {/* Left & Right Rim Light Accents */}
            <div
              aria-hidden="true"
              className="absolute inset-y-0 -left-[1px] w-[1.5px] bg-gradient-to-b from-orange-500/70 via-rose-600/30 to-transparent pointer-events-none z-20"
            />
            <div
              aria-hidden="true"
              className="absolute inset-y-0 -right-[1px] w-[1.5px] bg-gradient-to-b from-orange-500/70 via-rose-600/30 to-transparent pointer-events-none z-20"
            />

            {/* Board Top Surface & Side Depth Wrapper */}
            <div className="relative flex flex-col rounded-sm overflow-hidden bg-[#b87d35]">
              {/* Top Playing Surface */}
              <div
                className="relative p-2.5 sm:p-3.5"
                style={{
                  background:
                    'linear-gradient(178deg, #deb06c 0%, #d49f55 30%, #c88f42 70%, #b87c2e 100%)',
                }}
              >
                {/* Natural Vertical Grain Fiber Lines (榧木目・天面) */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 pointer-events-none opacity-40 mix-blend-multiply"
                  style={{
                    backgroundImage: `
                      repeating-linear-gradient(90deg, transparent 0px, transparent 12px, rgba(120,55,10,0.14) 13px, transparent 14px),
                      repeating-linear-gradient(90.5deg, transparent 0px, transparent 27px, rgba(90,40,5,0.1) 28px, transparent 30px),
                      repeating-linear-gradient(89.5deg, transparent 0px, transparent 55px, rgba(160,80,20,0.12) 56px, transparent 59px),
                      linear-gradient(180deg, rgba(255,255,255,0.25) 0%, transparent 20%, rgba(60,25,5,0.15) 100%)
                    `,
                  }}
                />

                {/* 9x9 Grid Surface with Fine Lacquer Lines */}
                <div
                  id="shogi-grid"
                  role="grid"
                  aria-label="将棋盤 9×9マス"
                  className="relative flex flex-col w-[min(78vw,480px)] h-[min(78vw,480px)] sm:w-[480px] sm:h-[480px] rounded-[1px] overflow-hidden"
                  style={{
                    border: '1.5px solid rgba(40, 20, 5, 0.95)',
                    boxShadow: 'inset 0 0 4px rgba(60, 25, 5, 0.4)',
                  }}
                >
                  {squares.map((rowSquares, rowIndex) => (
                    <div
                      key={`grid-row-${rowIndex}`}
                      role="row"
                      aria-label={`${RANK_KANJI[rowIndex]}段目`}
                      className="grid grid-cols-9 flex-1"
                    >
                      {rowSquares.map((square, colIndex) => {
                        const isSelected =
                          selectedSquare?.row === rowIndex && selectedSquare?.col === colIndex;

                        return (
                          <div
                            key={`sq-${square.coordinateLabel}`}
                            id={`square-${square.coordinateLabel}`}
                            role="gridcell"
                            tabIndex={isInteractive ? 0 : undefined}
                            aria-label={getSquareAriaLabel(square)}
                            data-file={square.file}
                            data-rank={square.rank}
                            data-coordinate={square.coordinateLabel}
                            onClick={isInteractive ? () => onSquareClick(square) : undefined}
                            onKeyDown={isInteractive ? (e) => handleKeyDown(e, square) : undefined}
                            className={`relative flex items-center justify-center aspect-square select-none ${
                              isInteractive ? 'cursor-pointer hover:bg-amber-400/20' : 'cursor-default'
                            } ${
                              isSelected ? 'bg-amber-400/30 ring-1 ring-amber-300 z-20' : ''
                            }`}
                            style={{
                              borderRight:
                                colIndex < 8 ? '1px solid rgba(45, 22, 6, 0.9)' : 'none',
                              borderBottom:
                                rowIndex < 8 ? '1px solid rgba(45, 22, 6, 0.9)' : 'none',
                            }}
                          >
                            {/* Star Dot Marker (星 - 黒漆ドット) on intersections (3-3, 3-6, 6-3, 6-6) */}
                            {square.hasBottomRightStarMarker && (
                              <div
                                aria-hidden="true"
                                data-testid="star-marker"
                                className="absolute -bottom-[2.5px] -right-[2.5px] w-1.5 h-1.5 rounded-full bg-[#1e0e04] shadow-[0_0.5px_1px_rgba(0,0,0,0.9)] z-20 pointer-events-none"
                              />
                            )}

                            {/* Piece Display */}
                            {square.piece && (
                              <Piece
                                piece={square.piece}
                                squareCoordinate={square.coordinateLabel}
                                isSelected={isSelected}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              {/* 3D Front Board Thickness & End-Grain (木口 側面立体ブロック) */}
              <div
                aria-hidden="true"
                className="relative w-full h-5 sm:h-7 pointer-events-none border-t border-amber-950/60"
                style={{
                  background:
                    'linear-gradient(180deg, #996222 0%, #7d4d14 35%, #5d3609 80%, #3e2203 100%)',
                  boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.2), 0 8px 16px rgba(0,0,0,0.8)',
                }}
              >
                {/* Wood End-grain rings & vertical striations */}
                <div
                  className="absolute inset-0 opacity-40 mix-blend-multiply"
                  style={{
                    backgroundImage: `
                      repeating-linear-gradient(90deg, transparent 0px, transparent 6px, rgba(30,12,2,0.4) 7px, transparent 8px),
                      linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.7) 100%)
                    `,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Right Rank Coordinates (一 to 九) */}
          <div
            aria-hidden="true"
            className="flex flex-col justify-around py-3 sm:py-4 pl-1.5 sm:pl-2 font-serif text-[11px] sm:text-xs font-semibold text-amber-200/60"
          >
            {RANK_KANJI.map((kanji) => (
              <div
                key={`rank-coord-${kanji}`}
                className="flex items-center justify-center h-full text-center"
              >
                <span>{kanji}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
