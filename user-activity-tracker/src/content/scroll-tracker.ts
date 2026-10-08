// ============================================================
// Scroll Tracker Content Script Module
// Throttles scroll events and only records meaningful changes.
// Tracks max scroll depth and quartile milestones.
// ============================================================

import { ScrollEvent } from '../types/activity';

let scrollTrackingActive = false;
let throttleTimer: ReturnType<typeof setTimeout> | null = null;
let maxScrollPercentage = 0;
let lastRecordedScrollPercentage = -1;
const THROTTLE_MS = 500;
const MIN_CHANGE_THRESHOLD = 2; // Only record if scroll % changed by ≥ 2%

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getScrollPercentage(): number {
  const scrollTop = window.scrollY;
  const docHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight
  );
  const viewportHeight = window.innerHeight;
  const scrollableHeight = docHeight - viewportHeight;

  if (scrollableHeight <= 0) return 100;
  return Math.min(100, Math.round((scrollTop / scrollableHeight) * 100));
}

type ScrollCallback = (scrollY: number, viewportHeight: number, docHeight: number) => void;
let scrollCallback: ScrollCallback | null = null;

function recordScrollEvent(): void {
  if (!scrollTrackingActive) return;

  const scrollY = window.scrollY;
  const viewportHeight = window.innerHeight;
  const documentHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight
  );
  const scrollPercentage = getScrollPercentage();

  // Only record if meaningful change
  if (Math.abs(scrollPercentage - lastRecordedScrollPercentage) < MIN_CHANGE_THRESHOLD) {
    return;
  }

  // Update max scroll depth
  if (scrollPercentage > maxScrollPercentage) {
    maxScrollPercentage = scrollPercentage;
  }

  lastRecordedScrollPercentage = scrollPercentage;

  const scrollEvent: ScrollEvent = {
    id: generateId(),
    pageVisitId: '', // filled by service worker
    timestamp: Date.now(),
    scrollY,
    documentHeight,
    viewportHeight,
    scrollPercentage,
  };

  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id && typeof chrome.runtime?.sendMessage === 'function') {
      chrome.runtime.sendMessage({ type: 'SCROLL_EVENT', payload: scrollEvent }).catch(() => {});
    }
  } catch {
    // Extension context invalidated
  }
}

function handleScroll(): void {
  if (!scrollTrackingActive) return;

  if (scrollCallback) {
    const docHeight = Math.max(
      document.body?.scrollHeight || 0,
      document.documentElement?.scrollHeight || 0,
      window.innerHeight
    );
    scrollCallback(window.scrollY, window.innerHeight, docHeight);
  }

  if (throttleTimer) return;

  throttleTimer = setTimeout(() => {
    recordScrollEvent();
    throttleTimer = null;
  }, THROTTLE_MS);
}

export function initScrollTracker(callback?: ScrollCallback): void {
  scrollTrackingActive = true;
  if (callback) scrollCallback = callback;
  // Record initial scroll position
  setTimeout(recordScrollEvent, 100);
  window.addEventListener('scroll', handleScroll, { passive: true });
}

export function pauseScrollTracker(): void {
  scrollTrackingActive = false;
}

export function resumeScrollTracker(): void {
  scrollTrackingActive = true;
}

export function getMaxScrollPercentage(): number {
  return maxScrollPercentage;
}

export function destroyScrollTracker(): void {
  scrollTrackingActive = false;
  scrollCallback = null;
  if (throttleTimer) {
    clearTimeout(throttleTimer);
    throttleTimer = null;
  }
  window.removeEventListener('scroll', handleScroll);
}

