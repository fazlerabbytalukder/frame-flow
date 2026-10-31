// Preset helpers shared by the Presets menu. A preset is { name, style,
// canvas? }; the main process decides which style fields it keeps
// (THEME_FIELDS in electron/ipc/projects.js).

// Deep equality that ignores key order (presets come back from JSON).
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => same(a[k], b[k]));
}

// True when applying the preset would change nothing: every setting it holds
// equals the project's, and so does its canvas size, if it has one.
export function presetMatches(preset, project) {
  if (!preset || !project) return false;
  for (const [key, value] of Object.entries(preset.style || {})) {
    if (!same(value, project.style[key])) return false;
  }
  const c = preset.canvas;
  return !c || (c.width === project.project.width && c.height === project.project.height);
}

// What "Create new preset" / "Update" saves from the current project.
export function presetFromProject(project) {
  return {
    style: project.style,
    canvas: { width: project.project.width, height: project.project.height },
  };
}
