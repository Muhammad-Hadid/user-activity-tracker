// ============================================================
// Background Service Worker
// Central hub for:
//   - Session management
//   - Tab tracking (active/inactive, focus/blur)
//   - Receiving messages from content scripts
//   - Batching and flushing events to storage
//   - Handling browser lifecycle events
// ============================================================

import {
  Session,
  PageVisit,
  ClickEvent,
  ScrollEvent,
  Message,
  PageVisitStartPayload,
  PageVisitEndPayload,
  PageTitleUpdatePayload,
} from '../types/activity';

import {
  saveSession,
  savePageVisit,
  bufferClickEvent,
  bufferScrollEvent,
  flushClickEvents,
  flushScrollEvents,
  isTrackingEnabled,
  setTrackingEnabled,
  getCurrentSessionId,
  setCurrentSessionId,
  getDailyStatistics,
  getOverlayConfig,
  setOverlayConfig,
} from '../storage/storage';

// ── Utility ───────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isTrackableUrl(url: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const blocked = ['chrome:', 'chrome-extension:', 'about:', 'edge:', 'moz-extension:', 'data:'];
    return !blocked.some((scheme) => u.protocol.startsWith(scheme.replace(':', '')));
  } catch {
    return false;
  }
}

// ── State ─────────────────────────────────────────────────────

// Maps tabId → current PageVisit id
const tabVisitMap = new Map<number, string>();
// Maps pageVisitId → visit object (in-memory, flushed periodically)
const activeVisits = new Map<string, PageVisit>();
// Track when a tab last became active
const tabActiveSince = new Map<number, number>();
// Currently focused tab
let focusedTabId: number | null = null;

// ── Session ───────────────────────────────────────────────────

async function ensureSession(): Promise<string> {
  const existingId = await getCurrentSessionId();
  if (existingId) return existingId;

  const session: Session = {
    id: generateId(),
    startedAt: Date.now(),
    browser: 'Chrome',
    userAgent: navigator.userAgent,
  };
  await saveSession(session);
  await setCurrentSessionId(session.id);
  return session.id;
}

// ── Page Visit Lifecycle ──────────────────────────────────────

async function startVisit(tabId: number, url: string, title: string): Promise<void> {
  const enabled = await isTrackingEnabled();
  if (!enabled || !isTrackableUrl(url)) return;

  // End any existing visit for this tab
  await endVisit(tabId);

  const sessionId = await ensureSession();
  const hostname = new URL(url).hostname;
  const visitId = generateId();

  const visit: PageVisit = {
    id: visitId,
    sessionId,
    url,
    hostname,
    title,
    startedAt: Date.now(),
    activeDuration: 0,
    isActive: true,
  };

  activeVisits.set(visitId, visit);
  tabVisitMap.set(tabId, visitId);
  tabActiveSince.set(tabId, Date.now());

  await savePageVisit(visit);
}

async function endVisit(tabId: number): Promise<void> {
  const visitId = tabVisitMap.get(tabId);
  if (!visitId) return;

  const visit = activeVisits.get(visitId);
  if (!visit) return;

  // Accumulate any remaining active time
  const activeSince = tabActiveSince.get(tabId);
  if (activeSince) {
    visit.activeDuration += Date.now() - activeSince;
    tabActiveSince.delete(tabId);
  }

  visit.endedAt = Date.now();
  visit.isActive = false;

  await savePageVisit(visit);
  activeVisits.delete(visitId);
  tabVisitMap.delete(tabId);
}

async function pauseVisit(tabId: number): Promise<void> {
  const visitId = tabVisitMap.get(tabId);
  if (!visitId) return;

  const visit = activeVisits.get(visitId);
  if (!visit) return;

  const activeSince = tabActiveSince.get(tabId);
  if (activeSince) {
    visit.activeDuration += Date.now() - activeSince;
    tabActiveSince.delete(tabId);
  }

  visit.isActive = false;
  await savePageVisit(visit);
}

async function resumeVisit(tabId: number): Promise<void> {
  const visitId = tabVisitMap.get(tabId);
  if (!visitId) return;

  const visit = activeVisits.get(visitId);
  if (!visit) return;

  if (!tabActiveSince.has(tabId)) {
    tabActiveSince.set(tabId, Date.now());
  }
  visit.isActive = true;
  await savePageVisit(visit);
}

async function updateVisitTitle(tabId: number, title: string): Promise<void> {
  const visitId = tabVisitMap.get(tabId);
  if (!visitId) return;

  const visit = activeVisits.get(visitId);
  if (visit && title) {
    visit.title = title;
    await savePageVisit(visit);
  }
}

// ── Tab Event Listeners ───────────────────────────────────────

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  // Pause the previously focused tab
  if (focusedTabId !== null && focusedTabId !== tabId) {
    await pauseVisit(focusedTabId);
  }

  focusedTabId = tabId;

  // Resume (or start) the newly focused tab
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.url) return;

  if (tabVisitMap.has(tabId)) {
    await resumeVisit(tabId);
  } else if (isTrackableUrl(tab.url)) {
    await startVisit(tabId, tab.url, tab.title || '');
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    await startVisit(tabId, changeInfo.url, tab.title || '');
  }
  if (changeInfo.title && tabVisitMap.has(tabId)) {
    await updateVisitTitle(tabId, changeInfo.title);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await endVisit(tabId);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus — pause current tab
    if (focusedTabId !== null) {
      await pauseVisit(focusedTabId);
    }
  } else {
    // Browser regained focus — resume current tab
    const [activeTab] = await chrome.tabs.query({ active: true, windowId });
    if (activeTab?.id) {
      focusedTabId = activeTab.id;
      if (tabVisitMap.has(activeTab.id)) {
        await resumeVisit(activeTab.id);
      } else if (activeTab.url && isTrackableUrl(activeTab.url)) {
        await startVisit(activeTab.id, activeTab.url, activeTab.title || '');
      }
    }
  }
});

// ── Message Handler ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  (async () => {
    switch (message.type) {
      case 'PAGE_VISIT_START': {
        const payload = message.payload as PageVisitStartPayload;
        if (tabId !== undefined) {
          await startVisit(tabId, payload.url, payload.title);
        }
        sendResponse({ success: true });
        break;
      }

      case 'PAGE_VISIT_END': {
        if (tabId !== undefined) {
          await endVisit(tabId);
        }
        sendResponse({ success: true });
        break;
      }

      case 'PAGE_TITLE_UPDATE': {
        const payload = message.payload as PageTitleUpdatePayload;
        if (tabId !== undefined) {
          await updateVisitTitle(tabId, payload.title);
        }
        sendResponse({ success: true });
        break;
      }

      case 'CLICK_EVENT': {
        const enabled = await isTrackingEnabled();
        if (!enabled) { sendResponse({ success: false }); break; }

        const clickEvent = message.payload as ClickEvent;
        // Attach the pageVisitId from the tab's current visit
        if (tabId !== undefined) {
          const visitId = tabVisitMap.get(tabId);
          if (visitId) clickEvent.pageVisitId = visitId;
        }
        bufferClickEvent(clickEvent);
        sendResponse({ success: true });
        break;
      }

      case 'SCROLL_EVENT': {
        const enabled = await isTrackingEnabled();
        if (!enabled) { sendResponse({ success: false }); break; }

        const scrollEvent = message.payload as ScrollEvent;
        if (tabId !== undefined) {
          const visitId = tabVisitMap.get(tabId);
          if (visitId) scrollEvent.pageVisitId = visitId;
        }
        bufferScrollEvent(scrollEvent);
        sendResponse({ success: true });
        break;
      }

      case 'GET_STATUS': {
        const enabled = await isTrackingEnabled();
        const currentVisitId = tabId !== undefined ? tabVisitMap.get(tabId) : undefined;
        const currentVisit = currentVisitId ? activeVisits.get(currentVisitId) : null;
        sendResponse({
          enabled,
          currentUrl: currentVisit?.url || null,
          currentTitle: currentVisit?.title || null,
        });
        break;
      }

      case 'SET_TRACKING': {
        const { enabled } = message.payload as { enabled: boolean };
        await setTrackingEnabled(enabled);
        sendResponse({ success: true });
        break;
      }

      case 'GET_STATS': {
        const { filter } = message.payload as { filter: string };
        const stats = await getDailyStatistics(filter as any);
        sendResponse({ stats });
        break;
      }

      case 'GET_OVERLAY_CONFIG': {
        const config = await getOverlayConfig();
        sendResponse({ config });
        break;
      }

      case 'SET_OVERLAY_CONFIG': {
        const updated = await setOverlayConfig(message.payload as any);
        const tabs = await chrome.tabs.query({});
        for (const t of tabs) {
          if (t.id) {
            chrome.tabs.sendMessage(t.id, { type: 'SET_OVERLAY_CONFIG', payload: updated }).catch(() => {});
          }
        }
        sendResponse({ success: true, config: updated });
        break;
      }

      case 'CLEAR_PAGE_OVERLAY': {
        if (tabId !== undefined) {
          chrome.tabs.sendMessage(tabId, { type: 'CLEAR_PAGE_OVERLAY' }).catch(() => {});
        }
        sendResponse({ success: true });
        break;
      }

      default:
        sendResponse({ error: 'Unknown message type' });
    }
  })();

  // Return true to indicate async response
  return true;
});

// ── Periodic Flush ────────────────────────────────────────────

// Flush buffered events to storage every 10 seconds
setInterval(async () => {
  await Promise.all([flushClickEvents(), flushScrollEvents()]);

  // Also persist in-memory active visits
  for (const visit of activeVisits.values()) {
    const activeSince = tabActiveSince.get(
      [...tabVisitMap.entries()].find(([, vid]) => vid === visit.id)?.[0] || -1
    );
    if (activeSince) {
      const snapshot = {
        ...visit,
        activeDuration: visit.activeDuration + (Date.now() - activeSince),
      };
      await savePageVisit(snapshot);
    }
  }
}, 10_000);

// ── Startup ───────────────────────────────────────────────────

chrome.runtime.onStartup.addListener(async () => {
  // Start a new session on browser startup
  await setCurrentSessionId('');
  await ensureSession();
});

chrome.runtime.onInstalled.addListener(async () => {
  await ensureSession();
  console.log('[UAT] User Activity Tracker installed.');
});

export {};
