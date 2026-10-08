// ============================================================
// Click Tracker Content Script Module
// Captures click events on webpages and sends them to the
// service worker via message passing.
//
// Privacy: Does NOT capture passwords, input values,
// form data, page text, or sensitive content.
// ============================================================

import { ClickEvent } from '../types/activity';

let clickTrackingActive = false;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getSafeElementInfo(el: EventTarget | null): {
  elementTag: string;
  elementId: string;
  elementClasses: string[];
} {
  if (!(el instanceof Element)) {
    return { elementTag: '', elementId: '', elementClasses: [] };
  }

  // Never capture input values or sensitive content
  const tag = el.tagName.toLowerCase();

  // Return only structural metadata — never values/content
  return {
    elementTag: tag,
    elementId: el.id || '',
    elementClasses: Array.from(el.classList).slice(0, 5), // cap at 5 classes
  };
}

type ClickCallback = (documentX: number, documentY: number) => void;
let clickCallback: ClickCallback | null = null;

function handleClick(event: MouseEvent): void {
  if (!clickTrackingActive) return;

  // Skip right-clicks
  if (event.button !== 0) return;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  // Absolute position within the document
  const x = event.pageX;
  const y = event.pageY;

  // Forward immediately to live overlay renderer if connected
  if (clickCallback) {
    clickCallback(x, y);
  }

  // Document dimensions for normalization
  const docWidth = Math.max(
    document.body.scrollWidth,
    document.documentElement.scrollWidth,
    document.body.offsetWidth,
    document.documentElement.offsetWidth
  );
  const docHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight,
    document.body.offsetHeight,
    document.documentElement.offsetHeight
  );

  const normalizedX = docWidth > 0 ? x / docWidth : 0;
  const normalizedY = docHeight > 0 ? y / docHeight : 0;

  const { elementTag, elementId, elementClasses } = getSafeElementInfo(event.target);

  const clickEvent: ClickEvent = {
    id: generateId(),
    pageVisitId: '', // will be filled in by service worker
    timestamp: Date.now(),
    viewportWidth,
    viewportHeight,
    x,
    y,
    normalizedX: parseFloat(normalizedX.toFixed(4)),
    normalizedY: parseFloat(normalizedY.toFixed(4)),
    scrollX,
    scrollY,
    elementTag,
    elementId,
    elementClasses,
  };

  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id && typeof chrome.runtime?.sendMessage === 'function') {
      chrome.runtime.sendMessage({ type: 'CLICK_EVENT', payload: clickEvent }).catch(() => {
        // Service worker may be inactive; ignore silently
      });
    }
  } catch {
    // Extension context invalidated
  }
}

export function initClickTracker(callback?: ClickCallback): void {
  clickTrackingActive = true;
  if (callback) clickCallback = callback;
  window.addEventListener('click', handleClick, { capture: true, passive: true });
  document.addEventListener('click', handleClick, { capture: true, passive: true });
}

export function pauseClickTracker(): void {
  clickTrackingActive = false;
}

export function resumeClickTracker(): void {
  clickTrackingActive = true;
}

export function destroyClickTracker(): void {
  clickTrackingActive = false;
  clickCallback = null;
  window.removeEventListener('click', handleClick, { capture: true } as EventListenerOptions);
  document.removeEventListener('click', handleClick, { capture: true } as EventListenerOptions);
}

