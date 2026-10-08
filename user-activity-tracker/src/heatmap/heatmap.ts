// ============================================================
// Heatmap Renderer
// Renders click heatmaps using the teal visual identity.
// Uses normalized coordinates for viewport-agnostic rendering.
// ============================================================

import { ClickEvent } from '../types/activity';

interface HeatmapOptions {
  width: number;
  height: number;
  radius: number;
  maxOpacity: number;
  minOpacity: number;
}

interface HeatmapCell {
  nx: number; // normalized x
  ny: number; // normalized y
  count: number;
}

const DEFAULT_OPTIONS: HeatmapOptions = {
  width: 800,
  height: 500,
  radius: 28,
  maxOpacity: 0.85,
  minOpacity: 0.08,
};

// Teal palette (no red/yellow/blue traditional heatmap)
const TEAL_GRADIENT: [number, string][] = [
  [0.0, 'rgba(52, 222, 211, 0.0)'],
  [0.2, 'rgba(52, 222, 211, 0.15)'],
  [0.4, 'rgba(52, 222, 211, 0.35)'],
  [0.6, 'rgba(52, 222, 211, 0.55)'],
  [0.8, 'rgba(20, 180, 170, 0.72)'],
  [1.0, 'rgba(0, 140, 130, 0.90)'],
];

function interpolateColor(t: number): string {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < TEAL_GRADIENT.length; i++) {
    const [stop, color] = TEAL_GRADIENT[i];
    const [prevStop, prevColor] = TEAL_GRADIENT[i - 1];
    if (t <= stop) {
      const localT = (t - prevStop) / (stop - prevStop);
      return blendColors(prevColor, color, localT);
    }
  }
  return TEAL_GRADIENT[TEAL_GRADIENT.length - 1][1];
}

function parseRgba(color: string): [number, number, number, number] {
  const m = color.match(/rgba?\((\d+\.?\d*),\s*(\d+\.?\d*),\s*(\d+\.?\d*),?\s*(\d+\.?\d*)?\)/);
  if (!m) return [0, 0, 0, 0];
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4] ?? '1')];
}

function blendColors(a: string, b: string, t: number): string {
  const [r1, g1, b1, a1] = parseRgba(a);
  const [r2, g2, b2, a2] = parseRgba(b);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bl = Math.round(b1 + (b2 - b1) * t);
  const al = parseFloat((a1 + (a2 - a1) * t).toFixed(3));
  return `rgba(${r}, ${g}, ${bl}, ${al})`;
}

// ── Core Rendering ─────────────────────────────────────────────

export function renderHeatmap(
  canvas: HTMLCanvasElement,
  clicks: ClickEvent[],
  options: Partial<HeatmapOptions> = {}
): void {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = opts.width;
  canvas.height = opts.height;

  ctx.clearRect(0, 0, opts.width, opts.height);

  if (clicks.length === 0) return;

  // Build density grid
  const cellSize = 10;
  const cols = Math.ceil(opts.width / cellSize);
  const rows = Math.ceil(opts.height / cellSize);
  const grid = new Float32Array(cols * rows);

  for (const click of clicks) {
    const px = click.normalizedX * opts.width;
    const py = click.normalizedY * opts.height;
    const col = Math.floor(px / cellSize);
    const row = Math.floor(py / cellSize);
    if (col >= 0 && col < cols && row >= 0 && row < rows) {
      grid[row * cols + col] += 1;
    }
  }

  const maxDensity = Math.max(...Array.from(grid));
  if (maxDensity === 0) return;

  // Draw heat blobs
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const density = grid[row * cols + col];
      if (density === 0) continue;

      const intensity = density / maxDensity;
      const px = col * cellSize + cellSize / 2;
      const py = row * cellSize + cellSize / 2;
      const radius = opts.radius * (0.5 + intensity * 0.5);

      const gradient = ctx.createRadialGradient(px, py, 0, px, py, radius);

      // Teal-based gradient, no alpha at edge
      gradient.addColorStop(0, interpolateColor(intensity));
      gradient.addColorStop(0.4, interpolateColor(intensity * 0.7));
      gradient.addColorStop(1, 'rgba(52, 222, 211, 0)');

      ctx.globalAlpha = 1;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Draw individual click dots on top
  ctx.globalAlpha = 0.6;
  for (const click of clicks) {
    const px = click.normalizedX * opts.width;
    const py = click.normalizedY * opts.height;

    ctx.fillStyle = 'rgba(52, 222, 211, 0.5)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

// ── URL-Specific Heatmap ───────────────────────────────────────

export function filterClicksForUrl(clicks: ClickEvent[], hostname: string): ClickEvent[] {
  return clicks.filter((c) => {
    try {
      return new URL(c.pageVisitId).hostname === hostname;
    } catch {
      return false;
    }
  });
}

// ── Stats overlay ──────────────────────────────────────────────

export function getHeatmapStats(clicks: ClickEvent[]): {
  totalClicks: number;
  densityGrid: { x: number; y: number; count: number }[];
  topZones: { label: string; count: number; percentage: number }[];
} {
  const totalClicks = clicks.length;

  // 3x3 zone grid
  const zones = Array.from({ length: 9 }, () => 0);
  for (const click of clicks) {
    const col = Math.floor(click.normalizedX * 3);
    const row = Math.floor(click.normalizedY * 3);
    const idx = Math.min(row, 2) * 3 + Math.min(col, 2);
    zones[idx]++;
  }

  const zoneLabels = [
    'Top-Left', 'Top-Center', 'Top-Right',
    'Mid-Left', 'Mid-Center', 'Mid-Right',
    'Bottom-Left', 'Bottom-Center', 'Bottom-Right',
  ];

  const topZones = zones
    .map((count, i) => ({
      label: zoneLabels[i],
      count,
      percentage: totalClicks > 0 ? Math.round((count / totalClicks) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { totalClicks, densityGrid: [], topZones };
}
