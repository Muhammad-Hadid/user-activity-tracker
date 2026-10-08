// ============================================================
// Live Activity Visualization Overlay
// Renders personal browsing activity directly on webpages:
//   1. Mouse Movement Trail (fading dots, smooth trail, footprint density)
//   2. Scroll Visualization (subtle viewed page bands & depth rail)
//   3. Click Heatmap (merging heat spots, ripple feedback, teal palette)
//
// Key Principles:
//   - Document coordinates: marks stay attached to page content when scrolling
//   - pointer-events: none: original website is 100% interactable
//   - Teal identity (#34DED3): clean, modern, minimal, never neon/rainbow
//   - High performance: RAF loop, viewport culling, idle pausing
// ============================================================

import {
  LiveOverlayConfig,
  OverlayClickPoint,
  OverlayScrollBand,
  PageOverlayState,
} from '../types/activity';
import { getOverlayConfig, getPageOverlay, savePageOverlay, clearPageOverlay } from '../storage/storage';

// ── Trail & Footprint Types ────────────────────────────────────

interface TrailPoint {
  documentX: number;
  documentY: number;
  timestamp: number;
  intensity: number;
}

interface FootprintNode {
  documentX: number;
  documentY: number;
  visits: number;
  lastSeen: number;
}

interface ClickRipple {
  documentX: number;
  documentY: number;
  startTime: number;
  duration: number;
}

// ── Constants ──────────────────────────────────────────────────

const PRIMARY_TEAL = '#34DED3';
const TRAIL_MAX_AGE_MS = 3500;
const FOOTPRINT_MERGE_RADIUS_PX = 32;
const CLICK_MERGE_RADIUS_PX = 28;
const SCROLL_BAND_HEIGHT_PX = 60;
const RIPPLE_DURATION_MS = 600;

export class LiveOverlay {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private config: LiveOverlayConfig = {
    enabled: true,
    mouseTrail: true,
    clickHeatmap: true,
    scrollTrail: true,
  };

  private pageKey = '';
  private trailPoints: TrailPoint[] = [];
  private footprintNodes: FootprintNode[] = [];
  private clickPoints: OverlayClickPoint[] = [];
  private scrollBands: Map<number, OverlayScrollBand> = new Map();
  private ripples: ClickRipple[] = [];

  private isRunning = false;
  private rafId: number | null = null;
  private lastActivityTime = performance.now();
  private dirtyForStorage = false;
  private storageSaveTimer: ReturnType<typeof setTimeout> | null = null;

  // Viewport metrics
  private viewportWidth = window.innerWidth;
  private viewportHeight = window.innerHeight;
  private dpr = window.devicePixelRatio || 1;

  constructor() {
    this.pageKey = this.computePageKey(window.location.href);
  }

  // ── Page Identity ──────────────────────────────────────────

  private computePageKey(url: string): string {
    try {
      const u = new URL(url);
      return `${u.hostname}${u.pathname}`;
    } catch {
      return url.split('?')[0].split('#')[0];
    }
  }

  public async init(): Promise<void> {
    const storedConfig = await getOverlayConfig().catch(() => null);
    if (storedConfig) {
      this.config = storedConfig;
    }

    this.ensureCanvas();
    await this.loadPageData();

    // Record initial viewport view
    this.recordScroll(window.scrollY, window.innerHeight, this.getDocumentHeight());

    window.addEventListener('resize', this.handleResize, { passive: true });
    window.addEventListener('scroll', this.handleScroll, { passive: true });

    if (this.config.enabled) {
      this.startRenderLoop();
    }
  }

  // ── Canvas Setup ───────────────────────────────────────────

  private ensureCanvas(): void {
    if (this.canvas && document.contains(this.canvas)) return;

    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.id = 'uat-live-overlay-canvas';
      this.canvas.setAttribute('aria-hidden', 'true');
    }

    this.canvas.style.setProperty('position', 'fixed', 'important');
    this.canvas.style.setProperty('top', '0px', 'important');
    this.canvas.style.setProperty('left', '0px', 'important');
    this.canvas.style.setProperty('width', '100%', 'important');
    this.canvas.style.setProperty('height', '100%', 'important');
    this.canvas.style.setProperty('pointer-events', 'none', 'important');
    this.canvas.style.setProperty('z-index', '2147483647', 'important');
    this.canvas.style.setProperty('margin', '0px', 'important');
    this.canvas.style.setProperty('padding', '0px', 'important');
    this.canvas.style.setProperty('border', 'none', 'important');
    this.canvas.style.setProperty('outline', 'none', 'important');
    this.canvas.style.setProperty('background', 'transparent', 'important');
    this.canvas.style.setProperty('display', this.config.enabled ? 'block' : 'none', 'important');

    const mountTarget = document.documentElement || document.body;
    if (mountTarget && !mountTarget.contains(this.canvas)) {
      mountTarget.appendChild(this.canvas);
    }

    this.ctx = this.canvas.getContext('2d');
    this.resizeCanvas();
  }

  private resizeCanvas = (): void => {
    if (!this.canvas || !this.ctx) return;
    this.viewportWidth = window.innerWidth;
    this.viewportHeight = window.innerHeight;
    this.dpr = window.devicePixelRatio || 1;

    this.canvas.width = Math.floor(this.viewportWidth * this.dpr);
    this.canvas.height = Math.floor(this.viewportHeight * this.dpr);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
    this.ctx.scale(this.dpr, this.dpr);
    this.triggerRender();
  };

  private handleResize = (): void => {
    this.resizeCanvas();
  };

  private handleScroll = (): void => {
    this.lastActivityTime = performance.now();
    this.recordScroll(window.scrollY, window.innerHeight, this.getDocumentHeight());
    this.triggerRender();
  };

  private getDocumentHeight(): number {
    return Math.max(
      document.body?.scrollHeight || 0,
      document.documentElement?.scrollHeight || 0,
      document.body?.offsetHeight || 0,
      document.documentElement?.offsetHeight || 0,
      window.innerHeight
    );
  }

  // ── Persistence ────────────────────────────────────────────

  private async loadPageData(): Promise<void> {
    try {
      const data: PageOverlayState = await getPageOverlay(this.pageKey);
      if (data && Array.isArray(data.clicks)) {
        this.clickPoints = data.clicks;
      }
      if (data && Array.isArray(data.scrollBands)) {
        this.scrollBands.clear();
        for (const band of data.scrollBands) {
          this.scrollBands.set(band.top, band);
        }
      }
      this.triggerRender();
    } catch {
      // Ignore storage errors
    }
  }

  private scheduleStorageSave(): void {
    this.dirtyForStorage = true;
    if (this.storageSaveTimer) return;

    this.storageSaveTimer = setTimeout(async () => {
      this.storageSaveTimer = null;
      if (!this.dirtyForStorage) return;

      const state: PageOverlayState = {
        clicks: this.clickPoints.slice(-150), // keep recent 150 points
        scrollBands: Array.from(this.scrollBands.values()),
      };
      await savePageOverlay(this.pageKey, state).catch(() => {});
      this.dirtyForStorage = false;
    }, 2500);
  }

  // ── Public Event API ───────────────────────────────────────

  public recordMouseMove(documentX: number, documentY: number): void {
    if (!this.config.enabled || !this.config.mouseTrail) return;

    const now = performance.now();
    this.lastActivityTime = now;

    // 1. Add trail point
    this.trailPoints.push({
      documentX,
      documentY,
      timestamp: now,
      intensity: 1.0,
    });

    // Keep trail buffer bounded
    if (this.trailPoints.length > 250) {
      this.trailPoints.shift();
    }

    // 2. Update footprint density node
    let matchedNode: FootprintNode | null = null;
    for (const node of this.footprintNodes) {
      const dx = node.documentX - documentX;
      const dy = node.documentY - documentY;
      if (dx * dx + dy * dy < FOOTPRINT_MERGE_RADIUS_PX * FOOTPRINT_MERGE_RADIUS_PX) {
        matchedNode = node;
        break;
      }
    }

    if (matchedNode) {
      matchedNode.visits = Math.min(matchedNode.visits + 1, 20);
      matchedNode.lastSeen = now;
      // Slightly drift towards current position for natural centroid
      matchedNode.documentX = matchedNode.documentX * 0.8 + documentX * 0.2;
      matchedNode.documentY = matchedNode.documentY * 0.8 + documentY * 0.2;
    } else {
      this.footprintNodes.push({
        documentX,
        documentY,
        visits: 1,
        lastSeen: now,
      });
      // Cap footprint nodes
      if (this.footprintNodes.length > 120) {
        this.footprintNodes.shift();
      }
    }

    this.startRenderLoop();
  }

  public recordClick(documentX: number, documentY: number): void {
    if (!this.config.enabled) return;

    const now = performance.now();
    this.lastActivityTime = now;

    // Ripple animation
    this.ripples.push({
      documentX,
      documentY,
      startTime: now,
      duration: RIPPLE_DURATION_MS,
    });

    if (this.config.clickHeatmap) {
      // Merge into nearby click point or create new one
      let matchedClick: OverlayClickPoint | null = null;
      for (const p of this.clickPoints) {
        const dx = p.documentX - documentX;
        const dy = p.documentY - documentY;
        if (dx * dx + dy * dy < CLICK_MERGE_RADIUS_PX * CLICK_MERGE_RADIUS_PX) {
          matchedClick = p;
          break;
        }
      }

      if (matchedClick) {
        matchedClick.count += 1;
        matchedClick.timestamp = Date.now();
        matchedClick.recentPulse = now;
        matchedClick.documentX = matchedClick.documentX * 0.7 + documentX * 0.3;
        matchedClick.documentY = matchedClick.documentY * 0.7 + documentY * 0.3;
      } else {
        this.clickPoints.push({
          documentX,
          documentY,
          count: 1,
          timestamp: Date.now(),
          recentPulse: now,
        });
        if (this.clickPoints.length > 200) {
          this.clickPoints.shift();
        }
      }
      this.scheduleStorageSave();
    }

    this.startRenderLoop();
  }

  public recordScroll(scrollY: number, viewportHeight: number, docHeight: number): void {
    if (!this.config.enabled || !this.config.scrollTrail) return;

    const top = Math.max(0, scrollY);
    const bottom = Math.min(docHeight, scrollY + viewportHeight);

    const startBand = Math.floor(top / SCROLL_BAND_HEIGHT_PX) * SCROLL_BAND_HEIGHT_PX;
    const endBand = Math.ceil(bottom / SCROLL_BAND_HEIGHT_PX) * SCROLL_BAND_HEIGHT_PX;

    let changed = false;
    for (let bandTop = startBand; bandTop < endBand; bandTop += SCROLL_BAND_HEIGHT_PX) {
      const existing = this.scrollBands.get(bandTop);
      if (existing) {
        if (existing.visits < 15) {
          existing.visits += 1;
          changed = true;
        }
      } else {
        this.scrollBands.set(bandTop, {
          top: bandTop,
          bottom: bandTop + SCROLL_BAND_HEIGHT_PX,
          visits: 1,
        });
        changed = true;
      }
    }

    if (changed) {
      this.scheduleStorageSave();
      this.triggerRender();
    }
  }

  // ── Page Switch (SPA Navigation) ───────────────────────────

  public async setPage(newUrl: string): Promise<void> {
    const newKey = this.computePageKey(newUrl);
    if (newKey === this.pageKey) return;

    // Flush current page before switching
    if (this.dirtyForStorage) {
      const state: PageOverlayState = {
        clicks: this.clickPoints,
        scrollBands: Array.from(this.scrollBands.values()),
      };
      await savePageOverlay(this.pageKey, state).catch(() => {});
      this.dirtyForStorage = false;
    }

    this.pageKey = newKey;
    this.trailPoints = [];
    this.footprintNodes = [];
    this.clickPoints = [];
    this.scrollBands.clear();
    this.ripples = [];

    await this.loadPageData();
    this.recordScroll(window.scrollY, window.innerHeight, this.getDocumentHeight());
  }

  // ── Clear Current Page ─────────────────────────────────────

  public async clearPageActivity(): Promise<void> {
    this.trailPoints = [];
    this.footprintNodes = [];
    this.clickPoints = [];
    this.scrollBands.clear();
    this.ripples = [];
    this.dirtyForStorage = false;

    await clearPageOverlay(this.pageKey).catch(() => {});

    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.viewportWidth, this.viewportHeight);
    }
    this.triggerRender();
  }

  // ── Configuration Update ───────────────────────────────────

  public updateConfig(newConfig: Partial<LiveOverlayConfig>): void {
    this.config = { ...this.config, ...newConfig };
    if (this.canvas) {
      this.canvas.style.display = this.config.enabled ? 'block' : 'none';
    }
    if (this.config.enabled) {
      this.triggerRender();
    } else {
      this.stopRenderLoop();
      if (this.ctx) {
        this.ctx.clearRect(0, 0, this.viewportWidth, this.viewportHeight);
      }
    }
  }

  public getConfig(): LiveOverlayConfig {
    return { ...this.config };
  }

  // ── Render Loop Management ─────────────────────────────────

  private triggerRender(): void {
    if (!this.config.enabled) return;
    this.lastActivityTime = performance.now();
    this.startRenderLoop();
  }

  private startRenderLoop(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.renderFrame();
  }

  private stopRenderLoop(): void {
    this.isRunning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private renderFrame = (): void => {
    if (!this.isRunning || !this.config.enabled || !this.ctx) return;

    const now = performance.now();
    this.render();

    // Check if we still have active animations or fading trails
    const hasActiveTrail = this.trailPoints.length > 0;
    const hasActiveRipples = this.ripples.length > 0;
    const isRecentActivity = now - this.lastActivityTime < 3000;

    if (hasActiveTrail || hasActiveRipples || isRecentActivity) {
      this.rafId = requestAnimationFrame(this.renderFrame);
    } else {
      // Pause loop when quiet to preserve CPU
      this.isRunning = false;
      this.rafId = null;
    }
  };

  // ── Core Renderer ──────────────────────────────────────────

  private render(): void {
    this.ensureCanvas();
    if (!this.ctx) return;

    const ctx = this.ctx;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const now = performance.now();

    ctx.clearRect(0, 0, this.viewportWidth, this.viewportHeight);

    // 1. Render Scroll Visited Bands
    if (this.config.scrollTrail) {
      this.renderScrollVisits(ctx, scrollX, scrollY);
    }

    // 2. Render Footprint Nodes (Repeated Mouse Lingering Areas)
    if (this.config.mouseTrail) {
      this.renderFootprintNodes(ctx, scrollX, scrollY, now);
    }

    // 3. Render Click Heatmap
    if (this.config.clickHeatmap) {
      this.renderClickHeatmap(ctx, scrollX, scrollY, now);
    }

    // 4. Render Active Mouse Trail
    if (this.config.mouseTrail) {
      this.renderMouseTrail(ctx, scrollX, scrollY, now);
    }

    // 5. Render Click Ripples
    this.renderRipples(ctx, scrollX, scrollY, now);

    // 6. Render Subtle Scroll Activity Indicator Rail (Right Edge)
    if (this.config.scrollTrail) {
      this.renderScrollRail(ctx, scrollY);
    }
  }

  // ── Sub-Renderers ──────────────────────────────────────────

  private renderScrollVisits(
    ctx: CanvasRenderingContext2D,
    _scrollX: number,
    scrollY: number
  ): void {
    const vHeight = this.viewportHeight;

    for (const band of this.scrollBands.values()) {
      const screenY = band.top - scrollY;
      const bandHeight = band.bottom - band.top;

      // Frustum culling
      if (screenY + bandHeight < 0 || screenY > vHeight) continue;

      // Density-based subtle opacity: 0.02 base up to 0.05 max
      const intensity = Math.min(band.visits / 10, 1);
      const alpha = 0.02 + intensity * 0.035;

      ctx.fillStyle = `rgba(52, 222, 211, ${alpha.toFixed(4)})`;
      ctx.fillRect(0, screenY, this.viewportWidth, bandHeight);

      // Subtle left edge indicator bar (2px width)
      ctx.fillStyle = `rgba(52, 222, 211, ${(alpha * 4).toFixed(4)})`;
      ctx.fillRect(0, screenY, 2, bandHeight);
    }
  }

  private renderFootprintNodes(
    ctx: CanvasRenderingContext2D,
    scrollX: number,
    scrollY: number,
    now: number
  ): void {
    const vWidth = this.viewportWidth;
    const vHeight = this.viewportHeight;

    for (const node of this.footprintNodes) {
      const sx = node.documentX - scrollX;
      const sy = node.documentY - scrollY;

      if (sx < -40 || sx > vWidth + 40 || sy < -40 || sy > vHeight + 40) continue;

      const density = Math.min(node.visits / 12, 1);
      const radius = 16 + density * 18;
      const baseAlpha = 0.06 + density * 0.16;

      // Faint subtle breathing pulse if seen recently
      const age = now - node.lastSeen;
      const pulse = age < 2000 ? Math.sin((now / 400) % (Math.PI * 2)) * 0.02 : 0;
      const alpha = Math.max(0.04, Math.min(0.24, baseAlpha + pulse));

      const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
      grad.addColorStop(0, `rgba(52, 222, 211, ${alpha.toFixed(3)})`);
      grad.addColorStop(0.6, `rgba(52, 222, 211, ${(alpha * 0.45).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(52, 222, 211, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderMouseTrail(
    ctx: CanvasRenderingContext2D,
    scrollX: number,
    scrollY: number,
    now: number
  ): void {
    // Prune expired points
    this.trailPoints = this.trailPoints.filter((p) => now - p.timestamp < TRAIL_MAX_AGE_MS);
    if (this.trailPoints.length < 2) return;

    const len = this.trailPoints.length;

    // 1. Draw smooth connecting trail line
    for (let i = 0; i < len - 1; i++) {
      const p1 = this.trailPoints[i];
      const p2 = this.trailPoints[i + 1];

      const s1x = p1.documentX - scrollX;
      const s1y = p1.documentY - scrollY;
      const s2x = p2.documentX - scrollX;
      const s2y = p2.documentY - scrollY;

      // Frustum check
      if (
        (s1x < -20 && s2x < -20) ||
        (s1x > this.viewportWidth + 20 && s2x > this.viewportWidth + 20) ||
        (s1y < -20 && s2y < -20) ||
        (s1y > this.viewportHeight + 20 && s2y > this.viewportHeight + 20)
      ) {
        continue;
      }

      const age = now - p2.timestamp;
      const progress = Math.max(0, 1 - age / TRAIL_MAX_AGE_MS);
      const alpha = (progress * 0.85).toFixed(3);
      const lineWidth = Math.max(1.5, progress * 4.5);

      ctx.strokeStyle = `rgba(52, 222, 211, ${alpha})`;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      ctx.moveTo(s1x, s1y);
      ctx.lineTo(s2x, s2y);
      ctx.stroke();
    }

    // 2. Draw subtle trailing dots at sample intervals
    for (let i = 0; i < len; i += 2) {
      const p = this.trailPoints[i];
      const sx = p.documentX - scrollX;
      const sy = p.documentY - scrollY;
      if (sx < 0 || sx > this.viewportWidth || sy < 0 || sy > this.viewportHeight) continue;

      const age = now - p.timestamp;
      const progress = Math.max(0, 1 - age / TRAIL_MAX_AGE_MS);
      const dotRadius = Math.max(2, progress * 4.5);
      const dotAlpha = (progress * 0.95).toFixed(3);

      ctx.fillStyle = `rgba(52, 222, 211, ${dotAlpha})`;
      ctx.beginPath();
      ctx.arc(sx, sy, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Draw head pointer glow dot at cursor
    const latest = this.trailPoints[len - 1];
    const headSx = latest.documentX - scrollX;
    const headSy = latest.documentY - scrollY;

    if (
      headSx >= 0 &&
      headSx <= this.viewportWidth &&
      headSy >= 0 &&
      headSy <= this.viewportHeight
    ) {
      const headGrad = ctx.createRadialGradient(headSx, headSy, 0, headSx, headSy, 9);
      headGrad.addColorStop(0, 'rgba(52, 222, 211, 1)');
      headGrad.addColorStop(0.5, 'rgba(20, 180, 170, 0.7)');
      headGrad.addColorStop(1, 'rgba(52, 222, 211, 0)');

      ctx.fillStyle = headGrad;
      ctx.beginPath();
      ctx.arc(headSx, headSy, 9, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderClickHeatmap(
    ctx: CanvasRenderingContext2D,
    scrollX: number,
    scrollY: number,
    now: number
  ): void {
    const vWidth = this.viewportWidth;
    const vHeight = this.viewportHeight;

    for (const click of this.clickPoints) {
      const sx = click.documentX - scrollX;
      const sy = click.documentY - scrollY;

      // Frustum culling
      if (sx < -60 || sx > vWidth + 60 || sy < -60 || sy > vHeight + 60) continue;

      // Density-based tiers
      const count = click.count;
      let radius = 22;
      let innerAlpha = 0.45;
      let outerAlpha = 0.15;
      let coreColor = 'rgba(52, 222, 211, 0.85)';

      if (count === 1) {
        radius = 18;
        innerAlpha = 0.32;
        outerAlpha = 0.08;
      } else if (count <= 3) {
        radius = 26;
        innerAlpha = 0.52;
        outerAlpha = 0.18;
        coreColor = 'rgba(30, 200, 190, 0.9)';
      } else if (count <= 7) {
        radius = 34;
        innerAlpha = 0.68;
        outerAlpha = 0.25;
        coreColor = 'rgba(10, 170, 160, 0.95)';
      } else {
        radius = 42;
        innerAlpha = 0.82;
        outerAlpha = 0.32;
        coreColor = 'rgba(0, 140, 130, 1.0)';
      }

      // If clicked recently, boost intensity slightly
      if (click.recentPulse && now - click.recentPulse < 1000) {
        const pulse = 1 - (now - click.recentPulse) / 1000;
        radius += pulse * 6;
        innerAlpha = Math.min(0.95, innerAlpha + pulse * 0.2);
      }

      // Radial Heat Aura
      const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
      grad.addColorStop(0, coreColor);
      grad.addColorStop(0.35, `rgba(52, 222, 211, ${innerAlpha.toFixed(3)})`);
      grad.addColorStop(0.7, `rgba(52, 222, 211, ${outerAlpha.toFixed(3)})`);
      grad.addColorStop(1, 'rgba(52, 222, 211, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fill();

      // Sharp central focal dot
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fill();

      // Soft teal outline around the center
      ctx.strokeStyle = PRIMARY_TEAL;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private renderRipples(
    ctx: CanvasRenderingContext2D,
    scrollX: number,
    scrollY: number,
    now: number
  ): void {
    this.ripples = this.ripples.filter((r) => now - r.startTime < r.duration);

    for (const r of this.ripples) {
      const elapsed = now - r.startTime;
      const progress = elapsed / r.duration; // 0 to 1
      const ease = Math.sin((progress * Math.PI) / 2); // ease out

      const sx = r.documentX - scrollX;
      const sy = r.documentY - scrollY;
      const radius = 8 + ease * 34;
      const alpha = ((1 - progress) * 0.65).toFixed(3);

      ctx.strokeStyle = `rgba(52, 222, 211, ${alpha})`;
      ctx.lineWidth = Math.max(1, (1 - progress) * 2.5);
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private renderScrollRail(ctx: CanvasRenderingContext2D, scrollY: number): void {
    const docHeight = this.getDocumentHeight();
    if (docHeight <= this.viewportHeight) return;

    const railWidth = 3;
    const railX = this.viewportWidth - railWidth - 3;
    const railHeight = this.viewportHeight;

    // Draw slim background rail
    ctx.fillStyle = 'rgba(52, 222, 211, 0.08)';
    ctx.fillRect(railX, 0, railWidth, railHeight);

    // Draw visited band notches on the rail
    for (const band of this.scrollBands.values()) {
      const topPct = band.top / docHeight;
      const bottomPct = band.bottom / docHeight;
      const y = topPct * railHeight;
      const h = Math.max(2, (bottomPct - topPct) * railHeight);

      const intensity = Math.min(band.visits / 8, 1);
      ctx.fillStyle = `rgba(52, 222, 211, ${(0.3 + intensity * 0.45).toFixed(3)})`;
      ctx.fillRect(railX, y, railWidth, h);
    }

    // Current viewport position marker on the rail
    const curTop = (scrollY / docHeight) * railHeight;
    const curHeight = Math.max(8, (this.viewportHeight / docHeight) * railHeight);

    ctx.fillStyle = 'rgba(52, 222, 211, 0.9)';
    ctx.fillRect(railX - 1, curTop, railWidth + 2, curHeight);
  }

  // ── Destroy ────────────────────────────────────────────────

  public destroy(): void {
    this.stopRenderLoop();
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('scroll', this.handleScroll);
    if (this.storageSaveTimer) {
      clearTimeout(this.storageSaveTimer);
    }
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
      this.canvas = null;
    }
  }
}
