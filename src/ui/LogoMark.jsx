import React from 'react';
import logoUrl from '../assets/logo.png';

// The Frame Studio app icon. Source art: assets/brand/logo-1024.png (the
// Windows .ico in electron/assets is generated from the same file).
export default function LogoMark({ size = 22, className }) {
  return <img src={logoUrl} width={size} height={size} alt="" draggable={false} className={className} />;
}
