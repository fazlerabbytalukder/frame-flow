// Reel mode: shades the parts of a 9:16 frame that TikTok, Instagram Reels
// and YouTube Shorts cover with their own interface (top bar, right-hand
// action buttons, bottom caption area), so important content stays clear.
// Drawn on the preview canvas only — never exported. Proportions are
// conservative approximations of the platforms' overlays.

const ZONES = [
  { label: 'Top bar', x: 0, y: 0, w: 1, h: 0.09 },
  { label: 'Buttons', x: 0.84, y: 0.42, w: 0.16, h: 0.4 },
  { label: 'Caption & audio', x: 0, y: 0.8, w: 1, h: 0.2 },
];

export function drawSafeZones(ctx, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(244, 63, 94, 0.22)';
  ctx.strokeStyle = 'rgba(244, 63, 94, 0.8)';
  ctx.lineWidth = Math.max(2, h * 0.002);
  ctx.setLineDash([h * 0.008, h * 0.006]);
  ctx.font = `600 ${Math.round(h * 0.016)}px "Segoe UI", system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  for (const z of ZONES) {
    const x = z.x * w;
    const y = z.y * h;
    ctx.fillRect(x, y, z.w * w, z.h * h);
    ctx.strokeRect(x, y, z.w * w, z.h * h);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillText(z.label, x + h * 0.01, y + h * 0.008);
    ctx.fillStyle = 'rgba(244, 63, 94, 0.22)';
  }
  ctx.restore();
}
