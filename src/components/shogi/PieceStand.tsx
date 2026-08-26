import React from 'react';
import { Piece as PieceModel, Player } from '../../types/shogi';
import { Piece } from './Piece';

interface PieceStandProps {
  player: Player;
  pieces: PieceModel[];
  isActive?: boolean;
  className?: string;
}

export const PieceStand: React.FC<PieceStandProps> = ({
  player,
  pieces = [],
  isActive = false,
  className = '',
}) => {
  const isGote = player === 'gote';
  const label = isGote ? '後手の持ち駒' : '先手の持ち駒';

  return (
    <div
      id={`piece-stand-${player}`}
      data-player={player}
      className={`relative flex flex-col items-center select-none transition-all duration-200 ${className}`}
      role="region"
      aria-label={`${label} (現在 ${pieces.length} 枚)`}
    >
      {/* 3D Realistic Wooden Komadai Tray (高級桑・欅造り駒台) */}
      <div
        className="w-40 sm:w-48 rounded-[3px] p-2 sm:p-2.5 transition-all duration-200"
        style={{
          background:
            'linear-gradient(140deg, #5c3b1e 0%, #472b13 45%, #38200d 80%, #261406 100%)',
          boxShadow: `
            0 12px 24px -6px rgba(0, 0, 0, 0.75),
            inset 0 1px 1px rgba(255, 255, 255, 0.15),
            inset 0 -2px 4px rgba(0, 0, 0, 0.6)
          `,
          border: '1px solid rgba(130, 80, 40, 0.25)',
        }}
      >
        {/* Recessed Inner Tray (天面凹み) */}
        <div
          className="relative rounded-[2px] p-2 min-h-[44px] sm:min-h-[52px] flex flex-col justify-between"
          style={{
            background:
              'linear-gradient(180deg, #301a0a 0%, #3f2511 40%, #4a2c15 100%)',
            boxShadow: 'inset 0 2px 5px rgba(0, 0, 0, 0.8), inset 0 0 1px rgba(0, 0, 0, 0.9)',
          }}
        >
          {/* Header Label */}
          <div className="flex items-center justify-between gap-1 pb-1 border-b border-amber-900/30">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  player === 'sente'
                    ? 'bg-amber-300 shadow-[0_0_4px_rgba(251,191,36,0.6)]'
                    : 'bg-stone-500'
                }`}
              />
              <span className="font-serif text-[11px] font-bold text-amber-200/90 tracking-wider">
                {label}
              </span>
            </div>
            <span className="font-serif text-[10px] text-amber-200/50">
              {pieces.length === 0 ? '持駒なし' : `${pieces.length}枚`}
            </span>
          </div>

          {/* Captured Pieces Content */}
          <div className="pt-1.5 flex items-center justify-center">
            {pieces.length === 0 ? (
              <div className="text-[10px] text-amber-300/20 font-serif italic py-1">
                — 空 —
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-1 w-full">
                {pieces.map((piece) => (
                  <div key={piece.id} className="flex justify-center items-center aspect-square">
                    <Piece piece={piece} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Komadai Wooden Stand Feet (駒台の足) */}
      <div className="flex justify-between w-32 sm:w-40 px-2 -mt-[1px]">
        <div
          className="w-4 h-2 rounded-b-sm"
          style={{
            background: 'linear-gradient(180deg, #38200d 0%, #1a0c04 100%)',
            boxShadow: '0 3px 6px rgba(0,0,0,0.8)',
          }}
        />
        <div
          className="w-4 h-2 rounded-b-sm"
          style={{
            background: 'linear-gradient(180deg, #38200d 0%, #1a0c04 100%)',
            boxShadow: '0 3px 6px rgba(0,0,0,0.8)',
          }}
        />
      </div>
    </div>
  );
};
