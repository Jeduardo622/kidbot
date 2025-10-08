import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ColoringBook } from './components/ColoringBook.js';
import { ComicBoard } from './components/ComicBoard.js';
import { ScienceLab } from './components/ScienceLab.js';
import { VoiceBar } from './components/VoiceBar.js';
import './styles.css';

type TabKey = 'voice' | 'comics' | 'coloring' | 'science';

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'voice', label: 'Voice' },
  { key: 'comics', label: 'Comics' },
  { key: 'coloring', label: 'Coloring' },
  { key: 'science', label: 'Science Lab' }
];

declare global {
  interface Window {
    openai?: {
      callTool?: (name: string, input: unknown) => Promise<unknown>;
      setWidgetState?: (state: Record<string, unknown>) => void;
      getWidgetState?: () => Record<string, unknown> | undefined;
      requestDisplayMode?: (options: { mode: 'fullscreen' | 'windowed' }) => void;
    };
  }
}

const App = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('voice');

  useEffect(() => {
    const saved = window.openai?.getWidgetState?.();
    if (saved && typeof saved.tab === 'string' && tabs.some((tab) => tab.key === saved.tab)) {
      setActiveTab(saved.tab as TabKey);
    }
    window.openai?.requestDisplayMode?.({ mode: 'fullscreen' });
  }, []);

  useEffect(() => {
    window.openai?.setWidgetState?.({ tab: activeTab });
  }, [activeTab]);

  return (
    <div className="kidbot-app">
      <header className="kidbot-header">
        <h1>KidBot Play Studio</h1>
        <nav>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={activeTab === tab.key ? 'active' : ''}
              type="button"
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {activeTab === 'voice' && <VoiceBar />}
        {activeTab === 'comics' && <ComicBoard />}
        {activeTab === 'coloring' && <ColoringBook />}
        {activeTab === 'science' && <ScienceLab />}
      </main>
    </div>
  );
};

const container = document.getElementById('kidbot-root');

if (container) {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
