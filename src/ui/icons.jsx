import React from 'react';

// Stroke icons shared by the recorder bar and the editor (24×24 grid, currentColor).

function Icon({ size = 18, strokeWidth = 2, children, className }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const make = (children) => (props) => <Icon {...props}>{children}</Icon>;

export const MonitorIcon = make(
  <>
    <rect width="20" height="14" x="2" y="3" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </>
);

export const WindowIcon = make(
  <>
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="M2 9h20M6 6.5h.01M9 6.5h.01" />
  </>
);

export const AreaIcon = make(
  <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
);

export const ChevronDownIcon = make(<path d="m6 9 6 6 6-6" />);

export const MicIcon = make(
  <>
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
  </>
);

export const MicOffIcon = make(
  <>
    <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33M9 9v3a3 3 0 0 0 5.12 2.12" />
    <path d="M16.95 16.95A7 7 0 0 1 5 12v-2M19 10v2a7 7 0 0 1-.11 1.23M12 19v3M2 2l20 20" />
  </>
);

export const CameraIcon = make(
  <>
    <path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.87a.5.5 0 0 0-.75-.43L16 10.5" />
    <rect x="2" y="6" width="14" height="12" rx="2" />
  </>
);

export const CameraOffIcon = make(
  <>
    <path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.25-3.06a.5.5 0 0 1 .75.43v8.25" />
    <path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2M2 2l20 20" />
  </>
);

export const TimerIcon = make(
  <>
    <path d="M10 2h4M12 14l3-3" />
    <circle cx="12" cy="14" r="8" />
  </>
);

export const SpeakerIcon = make(
  <>
    <path d="M11 5 6 9H2v6h4l5 4V5Z" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
  </>
);

export const MoreIcon = make(
  <>
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="19" r="1" />
  </>
);

export const GripIcon = make(
  <>
    <circle cx="9" cy="6" r="1" />
    <circle cx="9" cy="12" r="1" />
    <circle cx="9" cy="18" r="1" />
    <circle cx="15" cy="6" r="1" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="15" cy="18" r="1" />
  </>
);

export const MinusIcon = make(<path d="M5 12h14" />);

export const CloseIcon = make(<path d="M18 6 6 18M6 6l12 12" />);

export const PauseIcon = make(
  <>
    <rect x="14" y="4" width="4" height="16" rx="1" />
    <rect x="6" y="4" width="4" height="16" rx="1" />
  </>
);

export const PlayIcon = make(<path d="M6 3l14 9-14 9V3Z" />);

export const TrashIcon = make(
  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
);

export const FolderIcon = make(
  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
);

export const UploadIcon = make(<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />);

export const RecordIcon = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none" />
  </>
);

// Two frames handing over: clip transitions.
export const TransitionIcon = make(
  <>
    <rect width="9" height="12" x="2" y="6" rx="1.5" />
    <rect width="9" height="12" x="13" y="6" rx="1.5" />
    <path d="M9 3l3 3-3 3M15 15l-3 3 3 3" />
  </>
);

export const CheckIcon = make(<path d="M20 6 9 17l-5-5" />);

export const RefreshIcon = make(
  <path d="M3 12a9 9 0 0 1 15.74-6.26L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.74 6.26L3 16M8 16H3v5" />
);

export const StarIcon = make(
  <path d="M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.5l-5.87 3.08 1.12-6.54L2.5 9.41l6.56-.95L12 2.5Z" />
);

export const ShuffleIcon = make(
  <path d="M2 18h1.4a4 4 0 0 0 3.3-1.7l6.6-9.6A4 4 0 0 1 16.6 5H22M18 2l4 3-4 3M2 6h1.4a4 4 0 0 1 3.3 1.7l.9 1.3M13.4 15l.9 1.3a4 4 0 0 0 3.3 1.7H22M18 15l4 3-4 3" />
);

// --- editor ---

export const SparklesIcon = make(
  <path d="M9.94 15.5a2 2 0 0 0-1.44-1.44l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0l1.58 6.13a2 2 0 0 0 1.44 1.44l6.13 1.58a.5.5 0 0 1 0 .96l-6.13 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0ZM20 3v4M22 5h-4" />
);

export const PointerIcon = make(<path d="M4 3l7.07 17 2.51-7.39L21 10.07 4 3ZM13.5 13.5 19 19" />);

export const ZoomInIcon = make(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3M11 8v6M8 11h6" />
  </>
);

export const CaptionsIcon = make(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M10.5 10.2a2 2 0 1 0 0 3.6M16.5 10.2a2 2 0 1 0 0 3.6" />
  </>
);

export const ShapesIcon = make(
  <>
    <path d="M8.3 10a.7.7 0 0 1-.63-1.02l3.7-6.6a.7.7 0 0 1 1.26 0l3.7 6.6A.7.7 0 0 1 15.7 10Z" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <circle cx="17.5" cy="17.5" r="3.5" />
  </>
);

export const SettingsIcon = make(
  <>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
    <circle cx="12" cy="12" r="3" />
  </>
);

export const UndoIcon = make(<path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />);

export const RedoIcon = make(<path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />);

export const ScissorsIcon = make(
  <>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
  </>
);

export const WandIcon = make(
  <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72ZM14 7l3 3M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9" />
);

export const SkipBackIcon = make(<path d="M19 20 9 12l10-8v16ZM5 19V5" />);

export const SkipForwardIcon = make(<path d="m5 4 10 8-10 8V4ZM19 5v14" />);

export const PlusIcon = make(<path d="M5 12h14M12 5v14" />);

export const CropIcon = make(<path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2" />);

export const BookmarkIcon = make(<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z" />);

export const ExportIcon = make(<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />);

export const ArrowLeftIcon = make(<path d="m12 19-7-7 7-7M19 12H5" />);

export const CopyIcon = make(
  <>
    <rect width="14" height="14" x="8" y="8" rx="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </>
);

export const VolumeIcon = SpeakerIcon;

export const VolumeOffIcon = make(<path d="M11 5 6 9H2v6h4l5 4V5ZM22 9l-6 6M16 9l6 6" />);

export const FitIcon = make(<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />);

export const PhoneIcon = make(
  <>
    <rect width="12" height="20" x="6" y="2" rx="2" />
    <path d="M12 18h.01" />
  </>
);

export const CommandIcon = make(<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />);

export const TranscriptIcon = make(<path d="M4 6h16M4 10h10M4 14h16M4 18h7" />);

export const NotesIcon = make(
  <>
    <path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9Z" />
    <path d="M15 3v6h6M7 13h8M7 17h5" />
  </>
);

export const SearchIcon = make(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </>
);

export const GridIcon = make(
  <>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </>
);

export const ListIcon = make(<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />);

export const PencilIcon = make(<path d="M17 3a2.85 2.85 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />);

export const LockIcon = make(
  <>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </>
);

export const AlertIcon = make(<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />);
