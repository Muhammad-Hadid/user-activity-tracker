// ============================================================
// Core Data Types for User Activity Tracker
// All raw events are kept separate from derived statistics.
// ============================================================

export interface Session {
  id: string;
  startedAt: number; // unix ms
  endedAt?: number;
  browser: string;
  userAgent: string;
}

export interface PageVisit {
  id: string;
  sessionId: string;
  url: string;
  hostname: string;
  title: string;
  startedAt: number; // unix ms
  endedAt?: number;
  activeDuration: number; // ms of actual active time
  isActive: boolean;
}

export interface ClickEvent {
  id: string;
  pageVisitId: string;
  timestamp: number;
  // Viewport dimensions at time of click
  viewportWidth: number;
  viewportHeight: number;
  // Absolute position within the document
  x: number;
  y: number;
  // Normalized [0,1] relative to document dimensions
  normalizedX: number;
  normalizedY: number;
  // Scroll position at time of click
  scrollX: number;
  scrollY: number;
  // Element info
  elementTag: string;
  elementId: string;
  elementClasses: string[];
}

export interface ScrollEvent {
  id: string;
  pageVisitId: string;
  timestamp: number;
  scrollY: number;
  documentHeight: number;
  viewportHeight: number;
  scrollPercentage: number; // 0–100
}

// Derived / calculated types

export interface ScrollDepthSummary {
  pageVisitId: string;
  hostname: string;
  url: string;
  maxScrollPercentage: number;
  avgScrollPercentage: number;
  reachedQuartiles: {
    q25: boolean;
    q50: boolean;
    q75: boolean;
    q100: boolean;
  };
}

export interface DailyStatistics {
  date: string; // YYYY-MM-DD
  totalActiveTime: number; // ms
  totalPageVisits: number;
  totalClicks: number;
  totalScrollEvents: number;
  topDomains: { hostname: string; visits: number; activeTime: number }[];
}

export interface MouseMoveEvent {
  id: string;
  pageVisitId?: string;
  timestamp: number;
  documentX: number;
  documentY: number;
}

export interface LiveOverlayConfig {
  enabled: boolean;
  mouseTrail: boolean;
  clickHeatmap: boolean;
  scrollTrail: boolean;
}

export interface OverlayClickPoint {
  documentX: number;
  documentY: number;
  count: number;
  timestamp: number;
  recentPulse?: number; // timestamp of last click for animation
}

export interface OverlayScrollBand {
  top: number;
  bottom: number;
  visits: number;
}

export interface PageOverlayState {
  clicks: OverlayClickPoint[];
  scrollBands: OverlayScrollBand[];
}

// Messages passed between content scripts and service worker

export type MessageType =
  | 'PAGE_VISIT_START'
  | 'PAGE_VISIT_END'
  | 'CLICK_EVENT'
  | 'SCROLL_EVENT'
  | 'PAGE_TITLE_UPDATE'
  | 'GET_STATUS'
  | 'SET_TRACKING'
  | 'GET_STATS'
  | 'GET_OVERLAY_CONFIG'
  | 'SET_OVERLAY_CONFIG'
  | 'CLEAR_PAGE_OVERLAY';

export interface Message {
  type: MessageType;
  payload?: unknown;
}

export interface PageVisitStartPayload {
  url: string;
  hostname: string;
  title: string;
  timestamp: number;
}

export interface PageVisitEndPayload {
  url: string;
  timestamp: number;
}

export interface PageTitleUpdatePayload {
  title: string;
}

// Storage keys
export const STORAGE_KEYS = {
  SESSIONS: 'sessions',
  PAGE_VISITS: 'pageVisits',
  CLICK_EVENTS: 'clickEvents',
  SCROLL_EVENTS: 'scrollEvents',
  TRACKING_ENABLED: 'trackingEnabled',
  CURRENT_SESSION_ID: 'currentSessionId',
  OVERLAY_CONFIG: 'overlayConfig',
} as const;

// Filter range for dashboard queries
export type DateFilter = 'today' | 'yesterday' | 'last7days' | 'last30days';

