// ============================================================
// Popup Script
// Reads today's stats, shows tracking state, Live Visualization
// controls, and sub-toggles for mouse trail, heatmap, and scroll trail.
// ============================================================

import {
  getDailyStatistics,
  isTrackingEnabled,
  setTrackingEnabled,
  getOverlayConfig,
  setOverlayConfig,
} from '../storage/storage';
import { LiveOverlayConfig } from '../types/activity';

// ── Utility ────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getEl<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// ── DOM References ─────────────────────────────────────────────

// Tracking controls
const toggleEl = getEl<HTMLInputElement>('tracking-toggle');
const toggleLabel = getEl<HTMLElement>('toggle-label');
const statusDot = getEl<HTMLElement>('status-dot');
const statusText = getEl<HTMLElement>('status-text');
const currentSite = getEl<HTMLElement>('current-site');

// Stats
const activeTimeEl = getEl<HTMLElement>('active-time');
const totalVisitsEl = getEl<HTMLElement>('total-visits');
const totalClicksEl = getEl<HTMLElement>('total-clicks');
const currentPageSection = getEl<HTMLElement>('current-page-section');
const currentPageUrl = getEl<HTMLElement>('current-page-url');

// Live Overlay controls
const overlayToggleEl = getEl<HTMLInputElement>('overlay-toggle');
const overlayToggleLabel = getEl<HTMLElement>('overlay-toggle-label');
const overlaySubOptions = getEl<HTMLElement>('overlay-sub-options');
const toggleMouseTrail = getEl<HTMLInputElement>('toggle-mouse-trail');
const toggleClickHeatmap = getEl<HTMLInputElement>('toggle-click-heatmap');
const toggleScrollTrail = getEl<HTMLInputElement>('toggle-scroll-trail');
const clearPageOverlayBtn = getEl<HTMLButtonElement>('clear-page-overlay-btn');
const clearStatusMsg = getEl<HTMLElement>('clear-status-msg');

// Actions
const openDashboardBtn = getEl<HTMLElement>('open-dashboard');
const container = document.querySelector('.popup-container') as HTMLElement;

// ── Load Stats ─────────────────────────────────────────────────

async function loadStats(): Promise<void> {
  const stats = await getDailyStatistics('today');
  activeTimeEl.textContent = formatDuration(stats.totalActiveTime);
  totalVisitsEl.textContent = stats.totalPageVisits.toString();
  totalClicksEl.textContent = stats.totalClicks.toString();
}

// ── Load Tracking State ────────────────────────────────────────

async function loadTrackingState(): Promise<void> {
  const enabled = await isTrackingEnabled();

  toggleEl.checked = enabled;
  toggleLabel.textContent = enabled ? 'On' : 'Off';

  if (enabled) {
    statusDot.classList.remove('inactive');
    statusText.textContent = 'Tracking active';
    container.classList.remove('tracking-disabled');
  } else {
    statusDot.classList.add('inactive');
    statusText.textContent = 'Tracking paused';
    container.classList.add('tracking-disabled');
  }
}

// ── Load Live Overlay Config ───────────────────────────────────

async function loadOverlayConfig(): Promise<void> {
  const config = await getOverlayConfig();

  overlayToggleEl.checked = config.enabled;
  overlayToggleLabel.textContent = config.enabled ? 'On' : 'Off';

  toggleMouseTrail.checked = config.mouseTrail;
  toggleClickHeatmap.checked = config.clickHeatmap;
  toggleScrollTrail.checked = config.scrollTrail;

  if (!config.enabled) {
    overlaySubOptions.classList.add('collapsed');
  } else {
    overlaySubOptions.classList.remove('collapsed');
  }
}

// ── Load Current Tab Info ──────────────────────────────────────

async function loadCurrentTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  try {
    const hostname = new URL(tab.url).hostname;
    if (hostname) {
      currentSite.textContent = hostname;
      currentPageSection.style.display = 'block';
      currentPageUrl.textContent = tab.title || tab.url;
    }
  } catch {
    // ignore
  }
}

// ── Broadcast Config Update to Tabs ────────────────────────────

async function broadcastOverlayConfig(config: Partial<LiveOverlayConfig>): Promise<void> {
  const updated = await setOverlayConfig(config);

  // Send to active tab immediately
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id) {
    chrome.tabs.sendMessage(activeTab.id, {
      type: 'SET_OVERLAY_CONFIG',
      payload: updated,
    }).catch(() => {});
  }
}

// ── Event Handlers ─────────────────────────────────────────────

// Tracking master toggle
toggleEl.addEventListener('change', async () => {
  const enabled = toggleEl.checked;
  await setTrackingEnabled(enabled);

  toggleLabel.textContent = enabled ? 'On' : 'Off';

  if (enabled) {
    statusDot.classList.remove('inactive');
    statusText.textContent = 'Tracking active';
    container.classList.remove('tracking-disabled');
  } else {
    statusDot.classList.add('inactive');
    statusText.textContent = 'Tracking paused';
    container.classList.add('tracking-disabled');
  }

  // Notify content scripts on the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'SET_TRACKING', payload: { enabled } }).catch(() => {});
  }
});

// Live Visualization master toggle
overlayToggleEl.addEventListener('change', async () => {
  const enabled = overlayToggleEl.checked;
  overlayToggleLabel.textContent = enabled ? 'On' : 'Off';

  if (enabled) {
    overlaySubOptions.classList.remove('collapsed');
  } else {
    overlaySubOptions.classList.add('collapsed');
  }

  await broadcastOverlayConfig({ enabled });
});

// Sub-toggles
toggleMouseTrail.addEventListener('change', async () => {
  await broadcastOverlayConfig({ mouseTrail: toggleMouseTrail.checked });
});

toggleClickHeatmap.addEventListener('change', async () => {
  await broadcastOverlayConfig({ clickHeatmap: toggleClickHeatmap.checked });
});

toggleScrollTrail.addEventListener('change', async () => {
  await broadcastOverlayConfig({ scrollTrail: toggleScrollTrail.checked });
});

// Clear Page Activity button
clearPageOverlayBtn.addEventListener('click', async () => {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id) {
    chrome.tabs.sendMessage(activeTab.id, { type: 'CLEAR_PAGE_OVERLAY' }).catch(() => {});
  }

  clearStatusMsg.textContent = 'Cleared!';
  setTimeout(() => {
    clearStatusMsg.textContent = '';
  }, 1800);
});

// Dashboard Button
openDashboardBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  window.close();
});

// ── Init ───────────────────────────────────────────────────────

async function init(): Promise<void> {
  await Promise.all([loadStats(), loadTrackingState(), loadOverlayConfig(), loadCurrentTab()]);
}

init();
