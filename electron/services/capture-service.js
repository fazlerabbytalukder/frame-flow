const { BrowserWindow, desktopCapturer, screen } = require('electron');

// Lists screens/windows for the recorder UI and remembers which source the
// user picked so the display-media request handler can resolve to it.

let lastSources = [];
let selectedSourceId = null;
let selectedArea = null; // { x, y, w, h } in 0..1 of the display, or null

async function listSources() {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: true,
  });
  // Frame Studio's own windows (the recorder bar, library/editor) are never
  // worth recording.
  const own = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()));
  lastSources = sources.filter((s) => !own.has(s.id));

  return lastSources.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.id.startsWith('screen:') ? 'screen' : 'window',
    displayId: s.display_id || null,
    thumbnail: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : null,
    appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
  }));
}

function selectSource(sourceId) {
  const found = lastSources.find((s) => s.id === sourceId);
  if (!found) throw new Error('Unknown capture source; refresh the source list');
  if (sourceId !== selectedSourceId) selectedArea = null;
  selectedSourceId = sourceId;
  return describeSelectedSource();
}

function getSelectedSource() {
  return lastSources.find((s) => s.id === selectedSourceId) || null;
}

// Bounds of the display being recorded (or the display the recorded window is
// on). Used to normalize global cursor coordinates into 0..1 capture space.
function describeSelectedSource() {
  const source = getSelectedSource();
  if (!source) return null;

  let display = null;
  if (source.display_id) {
    display = screen.getAllDisplays().find((d) => String(d.id) === String(source.display_id));
  }
  if (!display) display = screen.getPrimaryDisplay();

  return {
    id: source.id,
    name: source.name,
    kind: source.id.startsWith('screen:') ? 'screen' : 'window',
    displayBounds: display.bounds,
    scaleFactor: display.scaleFactor,
  };
}

function setArea(area) {
  selectedArea = area || null;
}

function getArea() {
  return selectedArea;
}

module.exports = { listSources, selectSource, getSelectedSource, describeSelectedSource, setArea, getArea };
