# User Activity Tracker

A personal Chrome browser extension to track your own browsing activity — page visits, clicks, scroll depth — with a built-in heatmap and analytics dashboard.

## Features

- **Live Activity Visualization Overlay** — Real-time `#34DED3` transparent canvas layer directly on visited websites (`pointer-events: none`):
  - **Mouse Movement Trail** — Smooth, fading cursor trail with lingering footprint density in frequented areas
  - **Scroll Visualization** — Subtle visited bands indicating viewed page sections plus an ambient depth rail
  - **Click Heatmap** — Real-time teal heat spots with ripple feedback, merging repeated clicks
  - **Document Attachment** — Marks remain locked to page elements when scrolling
  - **Popup Controls** — Independent toggles for Live Overlay, Mouse Trail, Click Heatmap, Scroll Trail, and Clear Page Activity
- **Page Visit Tracking** — URL, hostname, title, active duration, session ID
- **Click Tracking** — position, normalized coords, viewport, scroll offset, element metadata
- **Scroll Tracking** — throttled, records meaningful depth changes, quartile milestones
- **Click Heatmap (Dashboard)** — teal-identity heatmap, density grid, top click zones
- **Scroll Visualization (Dashboard)** — depth distribution bars, quartile reach cards
- **Dashboard** — summary cards, top sites, recent activity, filter by today/yesterday/7d/30d
- **Popup** — quick status, today's stats, tracking toggle, overlay controls

## Privacy

- All data stays on your device (`chrome.storage.local`)
- No passwords, form values, page text, or cookies collected
- Only structural metadata about elements is stored (tag, id, classes)
- Tracking can be disabled at any time via the popup toggle

## Tech Stack

- Chrome Extension Manifest V3
- TypeScript
- Webpack 5
- Vanilla CSS (no frameworks)

## Build & Install

### 1. Install dependencies

```bash
npm install
```

### 2. Build the extension

```bash
npm run build
```

This outputs the compiled extension to the `dist/` directory.

### 3. Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder

The extension icon appears in your Chrome toolbar.

### 4. Development mode (watch)

```bash
npm run dev
```

Watches for TypeScript changes and rebuilds automatically. Reload the extension in `chrome://extensions` after each build.

## Project Structure

```
user-activity-tracker/
├── manifest.json           # Chrome Extension Manifest V3
├── webpack.config.js       # Build configuration
├── tsconfig.json           # TypeScript configuration
├── package.json
├── icons/                  # SVG icons (16, 32, 48, 128px)
├── scripts/
│   └── generate-icons.js  # Icon generation script
└── src/
    ├── types/
    │   └── activity.ts     # All TypeScript interfaces
    ├── storage/
    │   └── storage.ts      # chrome.storage.local abstraction
    ├── background/
    │   └── service-worker.ts  # Tab tracking, session management
    ├── content/
    │   ├── tracker.ts      # Content script entry point
    │   ├── click-tracker.ts   # Click capture module
    │   ├── scroll-tracker.ts  # Scroll capture module
    │   └── styles.css
    ├── popup/
    │   ├── popup.html
    │   ├── popup.ts
    │   └── popup.css
    ├── dashboard/
    │   ├── dashboard.html
    │   ├── dashboard.ts
    │   └── dashboard.css
    └── heatmap/
        └── heatmap.ts      # Canvas heatmap renderer
```

## Data Architecture

| Type | Key fields |
|------|-----------|
| `Session` | id, startedAt, endedAt |
| `PageVisit` | id, sessionId, url, hostname, title, startedAt, endedAt, activeDuration |
| `ClickEvent` | id, pageVisitId, timestamp, x, y, normalizedX/Y, viewport, elementTag/id/classes |
| `ScrollEvent` | id, pageVisitId, timestamp, scrollY, documentHeight, viewportHeight, scrollPercentage |
| `DailyStatistics` | derived: totalActiveTime, totalVisits, totalClicks, topDomains |

## Adding a Backend Later

The storage abstraction in `src/storage/storage.ts` is the only file that needs to change:
- Replace `chrome.storage.local.get/set` calls with API calls
- Implement the same function signatures pointing to your backend
- The rest of the codebase remains unchanged
