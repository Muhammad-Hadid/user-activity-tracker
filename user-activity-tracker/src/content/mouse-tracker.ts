// ============================================================
// Mouse Tracker Content Script Module
// Captures cursor movements for live visualization.
// Privacy: Captures only coordinates (pageX, pageY) — never
// input values, text selection, passwords, or form data.
// Performance: Throttles sampling using distance & time thresholds.
// ============================================================

type MouseMoveCallback = (documentX: number, documentY: number) => void;

let mouseTrackingActive = false;
let moveListener: MouseMoveCallback | null = null;
let lastX = -1;
let lastY = -1;
let lastTime = 0;

const MIN_DISTANCE_PX = 3;
const MIN_INTERVAL_MS = 16; // ~60fps max sampling

function handleMouseMove(e: MouseEvent): void {
  if (!mouseTrackingActive || !moveListener) return;

  const now = performance.now();
  const pageX = e.pageX;
  const pageY = e.pageY;

  // Throttle by time
  if (now - lastTime < MIN_INTERVAL_MS) return;

  // Throttle by distance
  if (lastX !== -1) {
    const dx = pageX - lastX;
    const dy = pageY - lastY;
    if (dx * dx + dy * dy < MIN_DISTANCE_PX * MIN_DISTANCE_PX) return;
  }

  lastX = pageX;
  lastY = pageY;
  lastTime = now;

  moveListener(pageX, pageY);
}

export function initMouseTracker(callback: MouseMoveCallback): void {
  moveListener = callback;
  mouseTrackingActive = true;
  window.addEventListener('mousemove', handleMouseMove, { capture: true, passive: true });
  document.addEventListener('mousemove', handleMouseMove, { capture: true, passive: true });
}

export function pauseMouseTracker(): void {
  mouseTrackingActive = false;
}

export function resumeMouseTracker(): void {
  mouseTrackingActive = true;
}

export function destroyMouseTracker(): void {
  mouseTrackingActive = false;
  moveListener = null;
  window.removeEventListener('mousemove', handleMouseMove, { capture: true } as EventListenerOptions);
  document.removeEventListener('mousemove', handleMouseMove, { capture: true } as EventListenerOptions);
}
