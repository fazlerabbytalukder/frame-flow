const { spawn, spawnSync } = require('child_process');

// Windows desktop helpers for recording: resize the window being recorded to
// an exact size, and hide the desktop icons while recording. Both call user32
// through a short PowerShell script (no native module to ship). Nothing here
// changes a persistent setting: icons are hidden with ShowWindow on the
// desktop's list view, which Explorer resets on restart anyway.

const WIN32 = `
using System;
using System.Runtime.InteropServices;
public static class FFWin {
  public struct RECT { public int L, T, R, B; }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  // Visible bounds (without the invisible resize borders of Windows 10/11).
  public static RECT Visible(IntPtr h) {
    RECT r;
    if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out r);
    return r;
  }
  // The desktop icon list: under Progman, or under a WorkerW once a
  // wallpaper slideshow has run.
  public static IntPtr DesktopIcons() {
    IntPtr view = FindWindowEx(FindWindow("Progman", null), IntPtr.Zero, "SHELLDLL_DefView", null);
    if (view == IntPtr.Zero) {
      EnumWindows(delegate (IntPtr h, IntPtr p) {
        IntPtr v = FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (v != IntPtr.Zero) { view = v; return false; }
        return true;
      }, IntPtr.Zero);
    }
    return view == IntPtr.Zero ? IntPtr.Zero : FindWindowEx(view, IntPtr.Zero, "SysListView32", null);
  }
}
`;

function psScript(body) {
  return `$ErrorActionPreference = 'Stop'\nAdd-Type -TypeDefinition @'\n${WIN32}\n'@\n[void][FFWin]::SetProcessDPIAware()\n${body}`;
}

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'];

// Runs a script and parses its last output line as JSON.
function runPs(body) {
  if (process.platform !== 'win32') return Promise.reject(new Error('Only available on Windows'));
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', PS_ARGS, { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      const line = out.trim().split(/\r?\n/).pop() || '';
      try {
        if (code !== 0) throw new Error(err.trim().split(/\r?\n/)[0] || `PowerShell exited with ${code}`);
        resolve(JSON.parse(line));
      } catch (e) {
        reject(new Error(e.message || 'Window helper failed'));
      }
    });
    child.stdin.end(psScript(body));
  });
}

// "window:<hwnd>:<n>" (Electron desktopCapturer id) -> hwnd number.
function hwndFromSourceId(sourceId) {
  const m = /^window:(\d+):\d+$/.exec(String(sourceId || ''));
  if (!m) throw new Error('Pick a window to resize');
  const hwnd = Number(m[1]);
  if (!Number.isSafeInteger(hwnd) || hwnd <= 0) throw new Error('Pick a window to resize');
  return hwnd;
}

const MIN_SIZE = 320;
const MAX_SIZE = 7680;

function checkSize(width, height) {
  for (const v of [width, height]) {
    if (!Number.isInteger(v) || v < MIN_SIZE || v > MAX_SIZE) throw new Error('Invalid window size');
  }
}

// Resizes a window so its VISIBLE area (what gets recorded) is width x height
// physical pixels. A maximized window is restored first. The window keeps its
// top-left corner unless it would run off its monitor's work area, in which
// case it moves back inside. Resolves with the new visible size.
async function resizeWindow(hwnd, width, height) {
  checkSize(width, height);
  return runPs(`
$h = [IntPtr]::new(${hwnd})
if (-not [FFWin]::IsWindow($h)) { throw 'That window is no longer open' }
if ([FFWin]::IsZoomed($h) -or [FFWin]::IsIconic($h)) { [void][FFWin]::ShowWindow($h, 9); Start-Sleep -Milliseconds 150 }
$outer = New-Object FFWin+RECT; [void][FFWin]::GetWindowRect($h, [ref]$outer)
$vis = [FFWin]::Visible($h)
$bl = $vis.L - $outer.L; $bt = $vis.T - $outer.T; $br = $outer.R - $vis.R; $bb = $outer.B - $vis.B
$w = ${width} + $bl + $br; $hh = ${height} + $bt + $bb
Add-Type -AssemblyName System.Windows.Forms
$area = [System.Windows.Forms.Screen]::FromHandle($h).WorkingArea
$x = $outer.L; $y = $outer.T
if ($vis.L + ${width} -gt $area.Right) { $x = $area.Right - ${width} - $bl }
if ($vis.T + ${height} -gt $area.Bottom) { $y = $area.Bottom - ${height} - $bt }
if ($x + $bl -lt $area.Left) { $x = $area.Left - $bl }
if ($y + $bt -lt $area.Top) { $y = $area.Top - $bt }
[void][FFWin]::SetWindowPos($h, [IntPtr]::Zero, $x, $y, $w, $hh, 0x0014)
Start-Sleep -Milliseconds 100
$v = [FFWin]::Visible($h)
@{ width = $v.R - $v.L; height = $v.B - $v.T; x = $v.L; y = $v.T } | ConvertTo-Json -Compress
`);
}

// { found, hidden } for the desktop icon list.
function desktopIconsState() {
  return runPs(`
$lv = [FFWin]::DesktopIcons()
@{ found = ($lv -ne [IntPtr]::Zero); hidden = ($lv -ne [IntPtr]::Zero -and -not [FFWin]::IsWindowVisible($lv)) } | ConvertTo-Json -Compress
`);
}

const setIconsBody = (hidden) => `
$lv = [FFWin]::DesktopIcons()
if ($lv -eq [IntPtr]::Zero) { @{ found = $false; hidden = $false } | ConvertTo-Json -Compress; return }
[void][FFWin]::ShowWindow($lv, ${hidden ? 0 : 5})
@{ found = $true; hidden = -not [FFWin]::IsWindowVisible($lv) } | ConvertTo-Json -Compress
`;

// Desktop icons we hid (and so must show again). Never touches icons the
// user had hidden themselves.
let iconsHiddenByUs = false;

async function hideDesktopIcons() {
  const state = await desktopIconsState();
  if (!state.found || state.hidden) return state;
  const next = await runPs(setIconsBody(true));
  iconsHiddenByUs = next.hidden;
  return next;
}

async function restoreDesktopIcons() {
  if (!iconsHiddenByUs) return { restored: false };
  iconsHiddenByUs = false;
  await runPs(setIconsBody(false));
  return { restored: true };
}

// Quit path: must finish before the process exits.
function restoreDesktopIconsSync() {
  if (!iconsHiddenByUs || process.platform !== 'win32') return;
  iconsHiddenByUs = false;
  spawnSync('powershell.exe', PS_ARGS, { input: psScript(setIconsBody(false)), windowsHide: true, timeout: 8000 });
}

module.exports = {
  resizeWindow, hwndFromSourceId, desktopIconsState, hideDesktopIcons, restoreDesktopIcons, restoreDesktopIconsSync,
  setDesktopIconsForTest: (hidden) => runPs(setIconsBody(hidden)),
};
