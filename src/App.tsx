import { useState } from 'react';
import { AppHeader } from './components/layout/AppHeader';
import { ShogiResearchScreen } from './components/shogi/ShogiResearchScreen';
import { AppView } from './types/navigation';

export default function App() {
  const [currentView, setCurrentView] = useState<AppView>('shogi');

  return (
    <div className="min-h-screen flex flex-col bg-[#0f1115] text-stone-200 font-sans selection:bg-amber-900 selection:text-amber-100">
      <AppHeader currentView={currentView} onSelectView={setCurrentView} />

      <div className="flex-1 flex flex-col">
        {currentView === 'shogi' && <ShogiResearchScreen />}
      </div>
    </div>
  );
}
