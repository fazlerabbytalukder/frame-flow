import React, { useEffect } from 'react';
import { useAppStore } from '../stores/app-store.js';
import LibraryView from '../features/library/LibraryView.jsx';
import RecorderHud from '../features/hud/RecorderHud.jsx';
import EditorView from '../features/editor/EditorView.jsx';

export const isHud = window.location.hash === '#hud';

export default function App() {
  const view = useAppStore((s) => s.view);
  const navigate = useAppStore((s) => s.navigate);

  useEffect(() => {
    if (!window.frameflow || isHud) return undefined;
    return window.frameflow.app.onNavigate(navigate);
  }, [navigate]);

  if (!window.frameflow) {
    return (
      <div className="h-screen flex items-center justify-center text-slate-400">
        Frame Studio must run inside its desktop shell (npm run dev).
      </div>
    );
  }

  if (isHud) return <RecorderHud />;

  return (
    <div className="h-screen flex flex-col">
      {view === 'library' && <LibraryView />}
      {view === 'editor' && <EditorView />}
    </div>
  );
}
