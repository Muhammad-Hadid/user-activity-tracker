// ============================================================
// Dashboard Script
// Handles: section navigation, filter pills, stats rendering,
// top sites, recent activity, heatmap, scroll visualization.
// ============================================================

import {
  getDailyStatistics,
  getPageVisits,
  getClickEvents,
  getScrollEvents,
  isTrackingEnabled,
} from '../storage/storage';
import { renderHeatmap, getHeatmapStats } from '../heatmap/heatmap';
import { DateFilter, PageVisit, ClickEvent, ScrollEvent } from '../types/activity';

// ── Utility ────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function getEl<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function getDomainInitial(hostname: string): string {
  return hostname.replace('www.', '').charAt(0).toUpperCase();
}

// ── State ──────────────────────────────────────────────────────

let currentFilter: DateFilter = 'today';
let currentSection = 'overview';
let allVisits: PageVisit[] = [];
let allClicks: ClickEvent[] = [];
let allScrolls: ScrollEvent[] = [];

// ── Navigation ─────────────────────────────────────────────────

function activateSection(section: string): void {
  currentSection = section;

  document.querySelectorAll('.section').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.remove('active'));

  const sectionEl = getEl(`section-${section}`);
  const navEl = getEl(`nav-${section}`);

  if (sectionEl) sectionEl.classList.add('active');
  if (navEl) navEl.classList.add('active');

  const titles: Record<string, string> = {
    overview: 'Overview',
    heatmap: 'Click Heatmap',
    scroll: 'Scroll Analytics',
    activity: 'Recent Activity',
  };
  getEl('section-title').textContent = titles[section] || section;
}

document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const section = (item as HTMLElement).dataset.section || 'overview';
    activateSection(section);
    if (section === 'heatmap') populateHeatmapSiteSelect();
    if (section === 'scroll') populateScrollSiteSelect();
    if (section === 'activity') renderActivityList();
  });
});

// ── Filter Pills ───────────────────────────────────────────────

document.querySelectorAll('.pill').forEach((pill) => {
  pill.addEventListener('click', async () => {
    document.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    currentFilter = (pill as HTMLElement).dataset.filter as DateFilter || 'today';
    await loadData();
  });
});

// ── Load & Render ───────────────────────────────────────────────

async function loadData(): Promise<void> {
  const [visits, clicks, scrolls, stats] = await Promise.all([
    getPageVisits(currentFilter),
    getClickEvents(currentFilter),
    getScrollEvents(currentFilter),
    getDailyStatistics(currentFilter),
  ]);

  allVisits = visits;
  allClicks = clicks;
  allScrolls = scrolls;

  renderSummaryCards(stats);
  renderTopSites(stats);
  renderRecentActivityPreview();
}

function renderSummaryCards(stats: any): void {
  getEl('stat-active-time').textContent = formatDuration(stats.totalActiveTime);
  getEl('stat-visits').textContent = stats.totalPageVisits.toString();
  getEl('stat-clicks').textContent = stats.totalClicks.toString();

  const uniqueSites = new Set(allVisits.map((v) => v.hostname)).size;
  getEl('stat-sites').textContent = uniqueSites.toString();
}

function renderTopSites(stats: any): void {
  const container = getEl('top-sites-list');
  const empty = getEl('top-sites-empty');

  if (!stats.topDomains || stats.topDomains.length === 0) {
    container.innerHTML = '<div class="empty-state">No data yet for this period.</div>';
    return;
  }

  const maxVisits = Math.max(...stats.topDomains.map((d: any) => d.visits));

  container.innerHTML = stats.topDomains
    .map(
      (domain: any) => `
      <div class="site-row">
        <div class="site-favicon">${getDomainInitial(domain.hostname)}</div>
        <div class="site-info">
          <div class="site-hostname">${domain.hostname}</div>
          <div class="site-meta">${formatDuration(domain.activeTime)} active time</div>
        </div>
        <div class="site-bar-wrap">
          <div class="site-bar-track">
            <div class="site-bar-fill" style="width: ${Math.round((domain.visits / maxVisits) * 100)}%"></div>
          </div>
        </div>
        <div class="site-visits">${domain.visits}</div>
      </div>
    `
    )
    .join('<div style="height:1px;background:#F3F4F6;margin:0 20px;"></div>');
}

function renderRecentActivityPreview(): void {
  const container = getEl('recent-activity-list');
  const recent = allVisits
    .filter((v) => v.endedAt)
    .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))
    .slice(0, 10);

  if (recent.length === 0) {
    container.innerHTML = '<div class="empty-state">No recent activity.</div>';
    return;
  }

  container.innerHTML = recent
    .map(
      (visit, i) => `
      ${i > 0 ? '<div class="activity-divider"></div>' : ''}
      <div class="activity-row">
        <div class="activity-favicon">${getDomainInitial(visit.hostname)}</div>
        <div class="activity-info">
          <div class="activity-title">${visit.title || visit.hostname}</div>
          <div class="activity-url">${visit.hostname}</div>
        </div>
        <div class="activity-meta">
          <div class="activity-duration">${formatDuration(visit.activeDuration)}</div>
          <div class="activity-time">${timeAgo(visit.endedAt || visit.startedAt)}</div>
        </div>
      </div>
    `
    )
    .join('');
}

function renderActivityList(): void {
  const container = getEl('activity-list');
  const sorted = [...allVisits]
    .filter((v) => v.endedAt)
    .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));

  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty-state">No activity recorded yet.</div>';
    return;
  }

  container.innerHTML = sorted
    .map(
      (visit, i) => `
      ${i > 0 ? '<div class="activity-divider"></div>' : ''}
      <div class="activity-row">
        <div class="activity-favicon">${getDomainInitial(visit.hostname)}</div>
        <div class="activity-info">
          <div class="activity-title">${visit.title || visit.hostname}</div>
          <div class="activity-url">${visit.url}</div>
        </div>
        <div class="activity-meta">
          <div class="activity-duration">${formatDuration(visit.activeDuration)}</div>
          <div class="activity-time">${timeAgo(visit.endedAt || visit.startedAt)}</div>
        </div>
      </div>
    `
    )
    .join('');
}

// ── Heatmap ─────────────────────────────────────────────────────

function populateHeatmapSiteSelect(): void {
  const select = getEl<HTMLSelectElement>('heatmap-site-select');
  const hostnames = [...new Set(allVisits.map((v) => v.hostname))].sort();

  select.innerHTML = '<option value="">— Select a site —</option>';
  hostnames.forEach((h) => {
    const opt = document.createElement('option');
    opt.value = h;
    opt.textContent = h;
    select.appendChild(opt);
  });
}

getEl('heatmap-site-select').addEventListener('change', (e) => {
  const hostname = (e.target as HTMLSelectElement).value;
  if (!hostname) {
    getEl('heatmap-placeholder').style.display = 'flex';
    getEl('heatmap-canvas').style.display = 'none';
    getEl('heatmap-stats').style.display = 'none';
    return;
  }
  renderHeatmapForSite(hostname);
});

function renderHeatmapForSite(hostname: string): void {
  const clicks = allClicks.filter((c) => {
    try {
      return new URL(c.pageVisitId.includes('://') ? c.pageVisitId : `https://${hostname}`).hostname === hostname
        || allVisits.find(v => v.id === c.pageVisitId)?.hostname === hostname;
    } catch {
      return false;
    }
  });

  // Try matching by pageVisitId -> visit -> hostname
  const visitIds = new Set(allVisits.filter((v) => v.hostname === hostname).map((v) => v.id));
  const siteClicks = allClicks.filter((c) => visitIds.has(c.pageVisitId));

  const canvas = getEl<HTMLCanvasElement>('heatmap-canvas');
  const placeholder = getEl('heatmap-placeholder');
  const statsEl = getEl('heatmap-stats');

  if (siteClicks.length === 0) {
    placeholder.style.display = 'flex';
    (placeholder.querySelector('p') as HTMLElement).textContent = `No click data for ${hostname}`;
    canvas.style.display = 'none';
    statsEl.style.display = 'none';
    return;
  }

  placeholder.style.display = 'none';
  canvas.style.display = 'block';

  const wrapper = getEl('heatmap-wrapper');
  const width = wrapper.clientWidth || 800;
  const height = Math.round(width * 0.6);

  renderHeatmap(canvas, siteClicks, { width, height });
  canvas.style.width = '100%';
  canvas.style.height = 'auto';

  // Stats
  const hStats = getHeatmapStats(siteClicks);
  getEl('hstat-total').textContent = hStats.totalClicks.toString();

  const zonesEl = getEl('hstat-zones');
  zonesEl.innerHTML = hStats.topZones
    .filter((z) => z.count > 0)
    .map((z) => `<span class="zone-chip">${z.label} ${z.percentage}%</span>`)
    .join('');

  statsEl.style.display = 'flex';
}

// ── Scroll Visualization ────────────────────────────────────────

function populateScrollSiteSelect(): void {
  const select = getEl<HTMLSelectElement>('scroll-site-select');
  const hostnames = [...new Set(allVisits.map((v) => v.hostname))].sort();

  select.innerHTML = '<option value="">— Select a site —</option>';
  hostnames.forEach((h) => {
    const opt = document.createElement('option');
    opt.value = h;
    opt.textContent = h;
    select.appendChild(opt);
  });
}

getEl('scroll-site-select').addEventListener('change', (e) => {
  const hostname = (e.target as HTMLSelectElement).value;
  if (!hostname) {
    getEl('scroll-placeholder').style.display = 'flex';
    getEl('scroll-viz-content').style.display = 'none';
    return;
  }
  renderScrollVizForSite(hostname);
});

function renderScrollVizForSite(hostname: string): void {
  const visitIds = new Set(allVisits.filter((v) => v.hostname === hostname).map((v) => v.id));
  const siteScrolls = allScrolls.filter((s) => visitIds.has(s.pageVisitId));

  const placeholder = getEl('scroll-placeholder');
  const content = getEl('scroll-viz-content');

  if (siteScrolls.length === 0) {
    placeholder.style.display = 'flex';
    (placeholder.querySelector('p') as HTMLElement).textContent = `No scroll data for ${hostname}`;
    content.style.display = 'none';
    return;
  }

  placeholder.style.display = 'none';
  content.style.display = 'flex';

  // Per-visit max scroll
  const visitMaxScrollMap = new Map<string, number>();
  for (const scroll of siteScrolls) {
    const existing = visitMaxScrollMap.get(scroll.pageVisitId) || 0;
    if (scroll.scrollPercentage > existing) {
      visitMaxScrollMap.set(scroll.pageVisitId, scroll.scrollPercentage);
    }
  }

  const visitMaxScrollValues = Array.from(visitMaxScrollMap.values());
  const totalVisits = visitMaxScrollValues.length;
  const avgScroll = Math.round(visitMaxScrollValues.reduce((a, b) => a + b, 0) / totalVisits);
  const maxScroll = Math.max(...visitMaxScrollValues);

  getEl('scroll-avg').textContent = `${avgScroll}%`;
  getEl('scroll-max').textContent = `${maxScroll}%`;
  getEl('scroll-visits').textContent = totalVisits.toString();

  // Bar chart: % of sessions reaching each 10% bucket
  const bars = getEl('scroll-bars');
  const buckets = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const rows = buckets.map((bucket) => {
    const reached = visitMaxScrollValues.filter((v) => v >= bucket).length;
    const pct = totalVisits > 0 ? Math.round((reached / totalVisits) * 100) : 0;
    return { bucket, pct };
  });

  bars.innerHTML = rows
    .map(
      (row) => `
      <div class="scroll-bar-row">
        <span class="scroll-bar-label">${row.bucket}%</span>
        <div class="scroll-bar-track">
          <div class="scroll-bar-fill" style="width: ${row.pct}%"></div>
        </div>
        <span class="scroll-bar-pct">${row.pct}%</span>
      </div>
    `
    )
    .join('');

  // Quartile cards
  const quartiles = [25, 50, 75, 100];
  const quartileEl = getEl('quartile-grid');
  quartileEl.innerHTML = quartiles
    .map((q) => {
      const reached = visitMaxScrollValues.filter((v) => v >= q).length;
      const pct = totalVisits > 0 ? Math.round((reached / totalVisits) * 100) : 0;
      const isReached = pct > 50;
      return `
        <div class="quartile-card ${isReached ? 'reached' : ''}">
          <div class="quartile-pct">${q}%</div>
          <div class="quartile-reach">${pct}%</div>
          <div class="quartile-label">of sessions</div>
        </div>
      `;
    })
    .join('');
}

// ── Tracking Status ────────────────────────────────────────────

async function loadTrackingStatus(): Promise<void> {
  const enabled = await isTrackingEnabled();
  const dot = getEl('sidebar-status-dot');
  const text = getEl('sidebar-status-text');
  if (enabled) {
    dot.classList.remove('off');
    text.textContent = 'Tracking on';
  } else {
    dot.classList.add('off');
    text.textContent = 'Tracking off';
  }
}

// ── Init ────────────────────────────────────────────────────────

async function init(): Promise<void> {
  await Promise.all([loadData(), loadTrackingStatus()]);
}

init();
