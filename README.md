# User Activity Tracker

A personal browsing activity tracker built as a Manifest V3 Chrome extension. It tracks your own browsing habits locally on your device without sending any data to external servers.

---

## Key Features

- **Live Activity Visualization Overlay**:
  - **Mouse Movement Trail**: Smooth, subtle `#34DED3` digital footprint trailing behind your cursor that gradually fades. Repeated movements linger and gain density in visited areas.
  - **Scroll Path Visualization**: Visually highlights page bands you have read/scrolled through with subtle transparency, plus a sleek vertical depth rail.
  - **Click Heatmap Overlay**: Real-time tactile teal heat spots where you click, merging nearby clicks into higher-density heat points.
  - **Document-Attached Coordinates**: All visualizations stay strictly locked to page content across scrolling.
  - **Non-Intrusive**: Layer uses `pointer-events: none` and does not alter site layout, fonts, or usability.
  - **Popup Controls**: Toggle Live Visualization on/off independently from data recording, control individual sub-layers (Mouse Trail, Click Heatmap, Scroll Trail), or clear the current page's overlay.

- **Website Activity Tracking**: Logs active time, visit start/end timestamps, domain, page titles, and session IDs.
- **Interaction Logging**: Captures click coordinates and quartile scroll depth for analytics.
- **Privacy First**: All data is stored purely in local storage (`chrome.storage.local`). Never captures passwords, inputs, form text, or cookies.
- **Analytics Dashboard**: Full breakdown of page visits, domain aggregations, click heatmaps, scroll depth, and CSV/JSON export.

---

## How to Install & Run

### 1. Build the Extension (if needed)

If you haven't built the files yet or make code modifications:

```bash
cd user-activity-tracker
npm install
npm run build
```

This compiles the TypeScript source code into the `user-activity-tracker/dist/` directory.

---

### 2. Load into Google Chrome

1. Open **Google Chrome** and navigate to:
   ```text
   chrome://extensions
   ```
2. Enable **Developer mode** using the toggle switch in the top-right corner.
3. Click the **Load unpacked** button in the top-left corner.
4. Select the **`dist`** folder located at:
   ```text
   user-activity-tracker/dist
   ```
   *(Important: Select the `dist` folder inside `user-activity-tracker`, not the root project folder)*

---

### 3. Usage

- Visit any regular website (e.g., Wikipedia, GitHub, documentation sites).
- Move your cursor, scroll, and click to see your real-time browsing trail and heat spots appear.
- Click the extension icon in the toolbar:
  - Toggle **Tracking** ON/OFF
  - Toggle **Live Visualization** ON/OFF
  - Customize sub-layers (Mouse Trail, Click Heatmap, Scroll Trail)
  - Click **Clear Page Activity** to wipe the current page's overlay
  - Click **Open Dashboard** to view historical analytics and session stats
