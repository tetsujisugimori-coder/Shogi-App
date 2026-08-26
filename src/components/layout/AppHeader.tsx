import React from 'react';
import { Swords } from 'lucide-react';

interface AppHeaderProps {
  currentView: string;
  onSelectView: (view: string) => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({ currentView, onSelectView }) => {
  return (
    <header
      id="app-main-header"
      className="w-full bg-[#16191f] border-b border-stone-800 text-stone-200 px-4 sm:px-6 py-2.5 flex items-center justify-between shadow-md"
    >
      {/* Brand Logo & Name */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-700 to-amber-900 flex items-center justify-center shadow-inner border border-amber-600/30">
          <span className="font-serif font-black text-amber-200 text-base select-none">将</span>
        </div>
        <div className="flex flex-col">
          <span className="font-semibold text-sm sm:text-base tracking-wide text-stone-100 flex items-center gap-1.5">
            SHOGI-APP
            <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-amber-950/60 text-amber-400 border border-amber-800/40">
              Lab
            </span>
          </span>
          <span className="text-[11px] text-stone-400 hidden sm:inline">
            研究・対局・ナレッジ管理
          </span>
        </div>
      </div>

      {/* Navigation items / Links */}
      <nav className="flex items-center gap-1 sm:gap-2">
        <button
          id="nav-btn-shogi"
          onClick={() => onSelectView('shogi')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors ${
            currentView === 'shogi'
              ? 'bg-amber-950/80 text-amber-200 border border-amber-700/50 shadow-sm'
              : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800/60'
          }`}
        >
          <Swords className="w-4 h-4 text-amber-400" />
          <span>将棋研究</span>
        </button>
      </nav>
    </header>
  );
};
