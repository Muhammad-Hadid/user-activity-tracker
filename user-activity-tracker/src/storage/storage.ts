// ============================================================
// Storage Abstraction Layer
// All reads/writes go through here so swapping to a backend
// later only requires modifying this single file.
// ============================================================

import {
  Session,
  PageVisit,
  ClickEvent,
  ScrollEvent,
  STORAGE_KEYS,
  DateFilter,
  DailyStatistics,
  LiveOverlayConfig,
  PageOverlayState,
} from '../types/activity';




function getDateRange(filter: DateFilter): { start: number; end: number } {
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();

  switch (filter) {
    case 'today':
      return { start: todayMs, end: now };
    case 'yesterday':
      return { start: todayMs - 86_400_000, end: todayMs - 1 };
    case 'last7days':
      return { start: todayMs - 6 * 86_400_000, end: now };
    case 'last30days':
      return { start: todayMs - 29 * 86_400_000, end: now };
  }
}

// ── Context Validity Helper ────────────────────────────────────

function isContextValid(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id && !!chrome.storage?.local;
  } catch {
    return false;
  }
}

// ── Generic get/set ──────────────────────────────────────────

async function getAll<T>(key: string): Promise<T[]> {
  return new Promise((resolve) => {
    if (!isContextValid()) {
      resolve([]);
      return;
    }
    try {
      chrome.storage.local.get(key, (result) => {
        if (chrome.runtime?.lastError) {
          resolve([]);
          return;
        }
        resolve((result?.[key] as T[]) || []);
      });
    } catch {
      resolve([]);
    }
  });
}

async function setAll<T>(key: string, items: T[]): Promise<void> {
  return new Promise((resolve) => {
    if (!isContextValid()) {
      resolve();
      return;
    }
    try {
      chrome.storage.local.set({ [key]: items }, () => resolve());
    } catch {
      resolve();
    }
  });
}

async function getValue<T>(key: string, defaultValue: T): Promise<T> {
  return new Promise((resolve) => {
    if (!isContextValid()) {
      resolve(defaultValue);
      return;
    }
    try {
      chrome.storage.local.get(key, (result) => {
        if (chrome.runtime?.lastError) {
          resolve(defaultValue);
          return;
        }
        resolve(result && key in result ? (result[key] as T) : defaultValue);
      });
    } catch {
      resolve(defaultValue);
    }
  });
}

async function setValue<T>(key: string, value: T): Promise<void> {
  return new Promise((resolve) => {
    if (!isContextValid()) {
      resolve();
      return;
    }
    try {
      chrome.storage.local.set({ [key]: value }, () => resolve());
    } catch {
      resolve();
    }
  });
}

// ── Sessions ─────────────────────────────────────────────────

export async function saveSession(session: Session): Promise<void> {
  const sessions = await getAll<Session>(STORAGE_KEYS.SESSIONS);
  const idx = sessions.findIndex((s) => s.id === session.id);
  if (idx >= 0) sessions[idx] = session;
  else sessions.push(session);
  await setAll(STORAGE_KEYS.SESSIONS, sessions);
}

export async function getCurrentSessionId(): Promise<string | null> {
  return getValue<string | null>(STORAGE_KEYS.CURRENT_SESSION_ID, null);
}

export async function setCurrentSessionId(id: string): Promise<void> {
  return setValue(STORAGE_KEYS.CURRENT_SESSION_ID, id);
}

// ── Page Visits ───────────────────────────────────────────────

export async function savePageVisit(visit: PageVisit): Promise<void> {
  const visits = await getAll<PageVisit>(STORAGE_KEYS.PAGE_VISITS);
  const idx = visits.findIndex((v) => v.id === visit.id);
  if (idx >= 0) visits[idx] = visit;
  else visits.push(visit);
  await setAll(STORAGE_KEYS.PAGE_VISITS, visits);
}

export async function getPageVisits(filter?: DateFilter): Promise<PageVisit[]> {
  const visits = await getAll<PageVisit>(STORAGE_KEYS.PAGE_VISITS);
  if (!filter) return visits;
  const { start, end } = getDateRange(filter);
  return visits.filter((v) => v.startedAt >= start && v.startedAt <= end);
}

export async function getPageVisitById(id: string): Promise<PageVisit | null> {
  const visits = await getAll<PageVisit>(STORAGE_KEYS.PAGE_VISITS);
  return visits.find((v) => v.id === id) || null;
}

// ── Click Events ─────────────────────────────────────────────

const clickBuffer: ClickEvent[] = [];
let clickFlushTimer: ReturnType<typeof setTimeout> | null = null;

export function bufferClickEvent(event: ClickEvent): void {
  clickBuffer.push(event);
  scheduleClickFlush();
}

function scheduleClickFlush(): void {
  if (clickFlushTimer) return;
  clickFlushTimer = setTimeout(async () => {
    await flushClickEvents();
    clickFlushTimer = null;
  }, 5000);
}

export async function flushClickEvents(): Promise<void> {
  if (clickBuffer.length === 0) return;
  const toSave = clickBuffer.splice(0, clickBuffer.length);
  const existing = await getAll<ClickEvent>(STORAGE_KEYS.CLICK_EVENTS);
  await setAll(STORAGE_KEYS.CLICK_EVENTS, [...existing, ...toSave]);
}

export async function getClickEvents(filter?: DateFilter): Promise<ClickEvent[]> {
  const events = await getAll<ClickEvent>(STORAGE_KEYS.CLICK_EVENTS);
  if (!filter) return events;
  const { start, end } = getDateRange(filter);
  return events.filter((e) => e.timestamp >= start && e.timestamp <= end);
}

export async function getClickEventsForPage(url: string): Promise<ClickEvent[]> {
  const events = await getAll<ClickEvent>(STORAGE_KEYS.CLICK_EVENTS);
  return events.filter((e) => {
    try {
      return new URL(e.pageVisitId).hostname === new URL(url).hostname;
    } catch {
      return false;
    }
  });
}

export async function getClickEventsForVisit(pageVisitId: string): Promise<ClickEvent[]> {
  const events = await getAll<ClickEvent>(STORAGE_KEYS.CLICK_EVENTS);
  return events.filter((e) => e.pageVisitId === pageVisitId);
}

// ── Scroll Events ─────────────────────────────────────────────

const scrollBuffer: ScrollEvent[] = [];
let scrollFlushTimer: ReturnType<typeof setTimeout> | null = null;

export function bufferScrollEvent(event: ScrollEvent): void {
  scrollBuffer.push(event);
  scheduleScrollFlush();
}

function scheduleScrollFlush(): void {
  if (scrollFlushTimer) return;
  scrollFlushTimer = setTimeout(async () => {
    await flushScrollEvents();
    scrollFlushTimer = null;
  }, 5000);
}

export async function flushScrollEvents(): Promise<void> {
  if (scrollBuffer.length === 0) return;
  const toSave = scrollBuffer.splice(0, scrollBuffer.length);
  const existing = await getAll<ScrollEvent>(STORAGE_KEYS.SCROLL_EVENTS);
  await setAll(STORAGE_KEYS.SCROLL_EVENTS, [...existing, ...toSave]);
}

export async function getScrollEvents(filter?: DateFilter): Promise<ScrollEvent[]> {
  const events = await getAll<ScrollEvent>(STORAGE_KEYS.SCROLL_EVENTS);
  if (!filter) return events;
  const { start, end } = getDateRange(filter);
  return events.filter((e) => e.timestamp >= start && e.timestamp <= end);
}

export async function getScrollEventsForVisit(pageVisitId: string): Promise<ScrollEvent[]> {
  const events = await getAll<ScrollEvent>(STORAGE_KEYS.SCROLL_EVENTS);
  return events.filter((e) => e.pageVisitId === pageVisitId);
}

// ── Tracking Enabled ──────────────────────────────────────────

export async function isTrackingEnabled(): Promise<boolean> {
  return getValue<boolean>(STORAGE_KEYS.TRACKING_ENABLED, true);
}

export async function setTrackingEnabled(enabled: boolean): Promise<void> {
  return setValue(STORAGE_KEYS.TRACKING_ENABLED, enabled);
}

// ── Derived Statistics ────────────────────────────────────────

export async function getDailyStatistics(filter: DateFilter): Promise<DailyStatistics> {
  const [visits, clicks, scrolls] = await Promise.all([
    getPageVisits(filter),
    getClickEvents(filter),
    getScrollEvents(filter),
  ]);

  const totalActiveTime = visits.reduce((sum, v) => sum + (v.activeDuration || 0), 0);

  // Group by hostname
  const domainMap = new Map<string, { visits: number; activeTime: number }>();
  for (const v of visits) {
    const existing = domainMap.get(v.hostname) || { visits: 0, activeTime: 0 };
    domainMap.set(v.hostname, {
      visits: existing.visits + 1,
      activeTime: existing.activeTime + (v.activeDuration || 0),
    });
  }

  const topDomains = Array.from(domainMap.entries())
    .map(([hostname, stats]) => ({ hostname, ...stats }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 10);

  return {
    date: new Date().toISOString().slice(0, 10),
    totalActiveTime,
    totalPageVisits: visits.length,
    totalClicks: clicks.length,
    totalScrollEvents: scrolls.length,
    topDomains,
  };
}

export async function getRecentVisits(limit = 20): Promise<PageVisit[]> {
  const visits = await getAll<PageVisit>(STORAGE_KEYS.PAGE_VISITS);
  return visits
    .filter((v) => v.endedAt)
    .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))
    .slice(0, limit);
}

// ── Live Overlay Configuration & State ────────────────────────

export const DEFAULT_OVERLAY_CONFIG: LiveOverlayConfig = {
  enabled: true,
  mouseTrail: true,
  clickHeatmap: true,
  scrollTrail: true,
};

export async function getOverlayConfig(): Promise<LiveOverlayConfig> {
  return getValue<LiveOverlayConfig>(STORAGE_KEYS.OVERLAY_CONFIG, DEFAULT_OVERLAY_CONFIG);
}

export async function setOverlayConfig(config: Partial<LiveOverlayConfig>): Promise<LiveOverlayConfig> {
  const current = await getOverlayConfig();
  const updated: LiveOverlayConfig = { ...current, ...config };
  await setValue(STORAGE_KEYS.OVERLAY_CONFIG, updated);
  return updated;
}

export async function getPageOverlay(pageKey: string): Promise<PageOverlayState> {
  const key = `uat_overlay_${pageKey}`;
  return getValue<PageOverlayState>(key, { clicks: [], scrollBands: [] });
}

export async function savePageOverlay(pageKey: string, state: PageOverlayState): Promise<void> {
  const key = `uat_overlay_${pageKey}`;
  await setValue(key, state);
}

export async function clearPageOverlay(pageKey: string): Promise<void> {
  const key = `uat_overlay_${pageKey}`;
  return new Promise((resolve) => {
    if (!isContextValid()) {
      resolve();
      return;
    }
    try {
      chrome.storage.local.remove(key, () => resolve());
    } catch {
      resolve();
    }
  });
}

export { getDateRange };

