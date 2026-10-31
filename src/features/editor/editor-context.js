import { createContext, useContext } from 'react';

// Canvas presets. The project's width/height are the export's aspect; export
// resolutions scale the short side (see export-planner resolutionOptions).
export const ASPECTS = [
  { id: 'landscape', label: '16:9', hint: 'YouTube, slides', width: 1920, height: 1080 },
  { id: 'classic', label: '4:3', hint: 'Docs, presentations', width: 1440, height: 1080 },
  { id: 'square', label: '1:1', hint: 'Feeds', width: 1080, height: 1080 },
  { id: 'feed', label: '4:5', hint: 'Instagram, LinkedIn', width: 1080, height: 1350 },
  { id: 'portrait', label: '9:16', hint: 'Reels, Shorts, TikTok', width: 1080, height: 1920 },
];

// How the screen fills a canvas of a different shape (style.framing; see
// framingFor in the composition engine).
export const FRAMING_OPTIONS = [
  { id: 'auto', label: 'Auto', hint: 'Fill tall and square posts' },
  { id: 'fill', label: 'Fill & follow cursor', hint: 'Crop in' },
  { id: 'fit', label: 'Fit whole screen', hint: 'Show all' },
];

export function aspectOf(project) {
  return ASPECTS.find((a) => a.width === project.project.width && a.height === project.project.height) || null;
}

// Editor actions the side panels and toolbars share (provided by EditorView):
// seek(t), addZoomAtPlayhead(), addCaptionAtPlayhead(), addAnnotation(type),
// addLayout(type), runAutoZoom(), copyFrame(), flash(message).
export const EditorActions = createContext(null);

export function useEditorActions() {
  return useContext(EditorActions);
}
