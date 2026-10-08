// ============================================================
// Main Content Script (tracker.ts)
// Entry point injected into every webpage.
// Orchestrates click tracking, scroll tracking, mouse movement,
// live activity visualization overlay, and handles SPA navigation.
//
// Resilience: All chrome.* API calls are guarded against
// invalidated extension contexts or unprivileged frames.
// ============================================================

import { initClickTracker, pauseClickTracker, resumeClickTracker, destroyClickTracker } from './click-tracker';
import { initScrollTracker, pauseScrollTracker, resumeScrollTracker, destroyScrollTracker } from './scroll-tracker';
import { initMouseTracker, pauseMouseTracker, resumeMouseTracker, destroyMouseTracker } from './mouse-tracker';
import { LiveOverlay } from './live-overlay';
import { isTrackingEnabled } from '../storage/storage';

// ── Helpers ───────────────────────────────────────────────────

function isContextValid(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

function safeSendMessage(message: any): Promise<any> {
  if (!isContextValid() || typeof chrome.runtime?.sendMessage !== 'function') {
    return Promise.resolve(null);
  }
  try {
    return chrome.runtime.sendMessage(message).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

function isTrackableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const blocked = ['chrome:', 'chrome-extension:', 'about:', 'edge:', 'moz-extension:', 'data:'];
    return !blocked.some((s) => u.protocol.startsWith(s.replace(':', '')));
  } catch {
    return false;
  }
}

// ── State ─────────────────────────────────────────────────────

let currentUrl = window.location.href;
let isTracking = false;
let spaObserver: MutationObserver | null = null;
let titleObserver: MutationObserver | null = null;
const liveOverlay = new LiveOverlay();

// ── Page Visit Notifications ──────────────────────────────────

function notifyPageStart(): void {
  safeSendMessage({
    type: 'PAGE_VISIT_START',
    payload: {
      url: window.location.href,
      hostname: window.location.hostname,
      title: document.title,
      timestamp: Date.now(),
    },
  });
}

function notifyPageEnd(): void {
  safeSendMessage({
    type: 'PAGE_VISIT_END',
    payload: { url: window.location.href, timestamp: Date.now() },
  });
}

function notifyTitleUpdate(title: string): void {
  safeSendMessage({
    type: 'PAGE_TITLE_UPDATE',
    payload: { title },
  });
}

// ── SPA Navigation Detection ──────────────────────────────────

function detectSPANavigation(): void {
  // Override pushState / replaceState
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = function (...args) {
    originalPushState(...args);
    handleUrlChange();
  };

  history.replaceState = function (...args) {
    originalReplaceState(...args);
    handleUrlChange();
  };

  window.addEventListener('popstate', handleUrlChange);
}

function handleUrlChange(): void {
  const newUrl = window.location.href;
  if (newUrl === currentUrl) return;

  // End old visit, start new one
  notifyPageEnd();
  currentUrl = newUrl;

  // Update live overlay page scope
  liveOverlay.setPage(newUrl);

  // Small delay to let the new page's title load
  setTimeout(() => {
    notifyPageStart();
    destroyScrollTracker();
    initScrollTracker((sy, vh, dh) => liveOverlay.recordScroll(sy, vh, dh));
  }, 100);
}

// ── Title Observer ────────────────────────────────────────────

function watchTitle(): void {
  const titleEl = document.querySelector('title');
  if (!titleEl) return;

  titleObserver = new MutationObserver(() => {
    notifyTitleUpdate(document.title);
  });

  titleObserver.observe(titleEl, { childList: true });
}

// ── Visibility ────────────────────────────────────────────────

function handleVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    pauseClickTracker();
    pauseScrollTracker();
    pauseMouseTracker();
  } else {
    resumeClickTracker();
    resumeScrollTracker();
    resumeMouseTracker();
  }
}

// ── Init ──────────────────────────────────────────────────────

async function init(): Promise<void> {
  if (!isTrackableUrl(window.location.href)) return;
  if (!isContextValid()) return;

  // Check if tracking is explicitly disabled in storage
  let trackingEnabled = true;
  try {
    trackingEnabled = await isTrackingEnabled();
  } catch {
    trackingEnabled = true;
  }

  if (trackingEnabled === false) return;

  isTracking = true;

  notifyPageStart();

  // Initialize trackers with live overlay callbacks
  initClickTracker((x, y) => liveOverlay.recordClick(x, y));
  initScrollTracker((sy, vh, dh) => liveOverlay.recordScroll(sy, vh, dh));
  initMouseTracker((x, y) => liveOverlay.recordMouseMove(x, y));

  // Initialize live visualization overlay
  await liveOverlay.init();

  detectSPANavigation();
  watchTitle();

  document.addEventListener('visibilitychange', handleVisibilityChange);

  // Notify page end on unload (best-effort)
  window.addEventListener('beforeunload', () => {
    notifyPageEnd();
  });
}

// ── Runtime Message Listener ──────────────────────────────────
// Allows popup/service worker to toggle tracking or overlay at runtime

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'SET_TRACKING') {
      if (message.payload.enabled && !isTracking) {
        init();
      } else if (!message.payload.enabled && isTracking) {
        pauseClickTracker();
        pauseScrollTracker();
        pauseMouseTracker();
        liveOverlay.updateConfig({ enabled: false });
        isTracking = false;
      }
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'SET_OVERLAY_CONFIG') {
      liveOverlay.updateConfig(message.payload);
      sendResponse({ success: true, config: liveOverlay.getConfig() });
      return true;
    }

    if (message.type === 'CLEAR_PAGE_OVERLAY') {
      liveOverlay.clearPageActivity().then(() => {
        sendResponse({ success: true });
      });
      return true;
    }

    if (message.type === 'GET_OVERLAY_CONFIG') {
      sendResponse({ config: liveOverlay.getConfig() });
      return true;
    }
  });
}

// ── Bootstrap ─────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    init();
  });
} else {
  init();
}
