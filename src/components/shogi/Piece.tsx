import React from 'react';
import { Piece as PieceModel, PieceType, getPieceDisplayInfo } from '../../types/shogi';

interface PieceProps {
  piece: PieceModel;
  squareCoordinate?: string;
  isSelected?: boolean;
  isLegalTarget?: boolean;
  isLastMove?: boolean;
  className?: string;
}

// Proportional scale factor for authentic Shogi piece hierarchy
const PIECE_SIZE_SCALE: Record<PieceType, { width: string; height: string; textScale: string }> = {
  king: { width: 'w-[88%]', height: 'h-[92%]', textScale: 'text-[clamp(11px,1.9vw,15px)]' },
  rook: { width: 'w-[86%]', height: 'h-[90%]', textScale: 'text-[clamp(10.5px,1.8vw,14px)]' },
  bishop: { width: 'w-[86%]', height: 'h-[90%]', textScale: 'text-[clamp(10.5px,1.8vw,14px)]' },
  gold: { width: 'w-[84%]', height: 'h-[88%]', textScale: 'text-[clamp(10px,1.75vw,13.5px)]' },
  silver: { width: 'w-[84%]', height: 'h-[88%]', textScale: 'text-[clamp(10px,1.75vw,13.5px)]' },
  knight: { width: 'w-[81%]', height: 'h-[85%]', textScale: 'text-[clamp(9.5px,1.7vw,13px)]' },
  lance: { width: 'w-[78%]', height: 'h-[84%]', textScale: 'text-[clamp(9px,1.65vw,12.5px)]' },
  pawn: { width: 'w-[76%]', height: 'h-[80%]', textScale: 'text-[clamp(9px,1.6vw,12px)]' },
};

export const Piece: React.FC<PieceProps> = ({
  piece,
  squareCoordinate,
  isSelected = false,
  isLegalTarget = false,
  isLastMove = false,
  className = '',
}) => {
  const isGote = piece.player === 'gote';
  const displayInfo = getPieceDisplayInfo(piece.type, piece.player, piece.isPromoted);
  const sizeConfig = PIECE_SIZE_SCALE[piece.type] || PIECE_SIZE_SCALE.pawn;

  return (
    <div
      id={`piece-${piece.id}`}
      data-piece-id={piece.id}
      data-piece-type={piece.type}
      data-player={piece.player}
      data-promoted={displayInfo.isPromoted}
      data-square={squareCoordinate}
      aria-hidden="true" // Screen readers read the parent square's aria-label
      className={`relative flex items-center justify-center ${sizeConfig.width} ${sizeConfig.height} transition-transform duration-200 select-none ${
        isGote ? 'rotate-180' : ''
      } ${isSelected ? 'scale-110 -translate-y-1 z-30' : 'z-10'} ${className}`}
    >
      {/* 3D Realistic Cast Shadow onto Kaya Board */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          clipPath: 'polygon(50% 0%, 88% 22%, 100% 100%, 0% 100%, 12% 22%)',
          transform: isGote ? 'translate(0px, -4px) scale(0.98)' : 'translate(0px, 4px) scale(0.98)',
          background: 'rgba(25, 12, 4, 0.65)',
          filter: 'blur(3px)',
        }}
      />

      {/* Realistic 3D Side Thickness Layer (側面・底面木口) */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          clipPath: 'polygon(50% 0%, 88% 22%, 100% 100%, 0% 100%, 12% 22%)',
          transform: isGote ? 'translateY(-2px)' : 'translateY(2.5px)',
          background:
            'linear-gradient(180deg, #7c4b18 0%, #61380e 40%, #462507 100%)',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.4)',
        }}
      />

      {/* Main Pentagonal Wooden Face (本黄楊 彫駒) */}
      <div
        className="w-full h-full relative flex items-center justify-center"
        style={{
          clipPath: 'polygon(50% 0%, 88% 22%, 100% 100%, 0% 100%, 12% 22%)',
          background:
            'linear-gradient(175deg, #fcedd0 0%, #f4dda9 25%, #e8c682 65%, #d6ad62 100%)',
          boxShadow: 'inset 0 1px 1.5px rgba(255, 255, 255, 0.8), inset 0 -2px 3px rgba(100, 50, 10, 0.35)',
        }}
      >
        {/* Subtle Tsuge Woodgrain Streaks (柾目・木目テクスチャ) */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none opacity-45 mix-blend-multiply"
          style={{
            backgroundImage: `
              repeating-linear-gradient(92deg, transparent 0px, transparent 4px, rgba(140, 90, 30, 0.1) 5px, transparent 7px),
              repeating-linear-gradient(88deg, transparent 0px, transparent 9px, rgba(110, 70, 20, 0.08) 10px, transparent 13px),
              linear-gradient(180deg, rgba(255,255,255,0.4) 0%, transparent 40%, rgba(90,45,10,0.15) 100%)
            `,
          }}
        />

        {/* Top-edge Bevel Light Reflection */}
        <div
          aria-hidden="true"
          className="absolute inset-[1px] pointer-events-none"
          style={{
            clipPath: 'polygon(50% 1%, 87% 22%, 98% 98%, 2% 98%, 13% 22%)',
            background:
              'linear-gradient(180deg, rgba(255, 255, 255, 0.6) 0%, rgba(255, 255, 255, 0.05) 35%, transparent 70%)',
            borderTop: '1px solid rgba(255, 255, 255, 0.7)',
          }}
        />

        {/* Outer Chamfer Edge Border */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none border border-amber-900/30"
          style={{
            clipPath: 'polygon(50% 0%, 88% 22%, 100% 100%, 0% 100%, 12% 22%)',
          }}
        />

        {/* Unified Two-Character Vertical Japanese Calligraphy (黒漆 / 朱漆 彫駒文字) */}
        <div
          className={`relative z-10 flex flex-col items-center justify-center leading-none select-none ${
            displayInfo.isPromotedColor ? 'text-[#b91c1c]' : 'text-[#120f0c]'
          } ${sizeConfig.textScale}`}
          style={{
            fontFamily:
              '"Shippori Mincho", "Yuji Boku", "Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN", serif',
            fontWeight: 800,
            textShadow: displayInfo.isPromotedColor
              ? '0 0.5px 0.5px rgba(255, 255, 255, 0.6), 0 1px 1px rgba(80, 20, 10, 0.25)'
              : '0 0.5px 0.5px rgba(255, 255, 255, 0.5), 0 1px 1px rgba(60, 30, 5, 0.25)',
            transform: 'translateY(2%)',
          }}
        >
          <div className="flex flex-col items-center justify-center gap-[0.5px] py-0.5">
            <span className="leading-[1.05] tracking-tight block scale-y-[1.02]">{displayInfo.topChar}</span>
            <span className="leading-[1.05] tracking-tight block scale-y-[1.02]">{displayInfo.bottomChar}</span>
          </div>
        </div>
      </div>

      {/* Highlight glow for legal move target / check */}
      {isLastMove && (
        <div
          aria-hidden="true"
          className="absolute -bottom-1 w-2.5 h-0.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]"
        />
      )}
      {isLegalTarget && (
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-sm border-2 border-emerald-400/70 pointer-events-none"
        />
      )}
    </div>
  );
};
