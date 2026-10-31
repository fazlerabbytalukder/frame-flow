import { create } from 'zustand';

// Main-window navigation: library (project list) <-> editor. Recording lives
// in the separate recorder bar window (#hud); the main window's initial view
// comes from its URL hash (#library or #editor=<projectId>).

function initialRoute() {
  const m = /^#editor=([\w-]+)$/.exec(window.location.hash);
  return m ? { view: 'editor', editorProjectId: m[1] } : { view: 'library', editorProjectId: null };
}

export const useAppStore = create((set) => ({
  ...initialRoute(),
  openRecorder: () => window.frameflow.app.showRecorder(),
  openLibrary: () => set({ view: 'library' }),
  openEditor: (projectId) => set({ view: 'editor', editorProjectId: projectId }),
  navigate: (target) =>
    set(
      target.view === 'editor'
        ? { view: 'editor', editorProjectId: target.projectId }
        : { view: 'library' }
    ),
}));
