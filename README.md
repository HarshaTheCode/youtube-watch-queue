# YouTube Watch Queue — Chrome Extension (Manifest V3)

A Chrome extension that lets you bookmark videos from your YouTube home page into a collapsible top shelf, tracks your real watch progress, and keeps your queue clean with 1-click cleanup actions.

---

## 🚀 Features

- **1-Click Capture Ribbon**: Hover over any video thumbnail on YouTube (Home, Subscriptions, Trending, Search) and click the ribbon icon in the top-right corner to instantly bookmark.
- **Collapsible Top Shelf**: Lives at the very top of YouTube's home page, above all recommendations.
  - **Collapsed State**: Slim 48px summary bar displaying total items, new items, and in-progress counts.
  - **Expanded State**: Horizontal scroller of video cards matching YouTube's native card aesthetic with smooth left/right navigation arrows.
- **Real-Time Watch Progress Tracking**:
  - Automatically records `currentTime` / `duration` on the watch page (`/watch?v=...`) every 5 seconds.
  - Displays red watch progress bar and percentage pill on saved cards.
  - Reaches **≥ 90%**? Automatically marked as **Watched** with a green checkmark `✓` and subtle thumbnail fade.
- **Queue Hygiene & Cleanup**:
  - **Clear Watched**: 1-click button in the shelf header to remove all finished videos.
  - **Individual Remove**: Quick `✕` button on hover.
  - **3-Second Undo Toast**: Accidental removal or clearing can be reversed instantly.
  - **Context Menu**: Right-click any card to manually mark as watched or reset progress.
- **Light & Dark Theme Matching**: Automatically matches YouTube's active color mode (`<html dark>`).
- **Extension Popup**: Click the extension icon in Chrome's toolbar for quick queue stats, direct links, and settings.

---

## 🛠️ How to Install in Google Chrome

1. Open Google Chrome.
2. In the URL bar, go to `chrome://extensions/`.
3. In the top-right corner, enable **Developer mode**.
4. Click the **Load unpacked** button in the top-left corner.
5. Select this directory:
   ```
   c:\Harsha space\Mock web site Demos\YT Bookmarker
   ```
6. The **YouTube Watch Queue** extension is now active!
7. Navigate to [youtube.com](https://www.youtube.com) to start bookmarking videos.

---

## 🧪 Offline Test Bench

You can also test all features locally without opening YouTube:
- Open `test/mock-youtube.html` directly in Google Chrome.
- Test hover bookmarks, collapsing/expanding the top shelf, horizontal scrolling, theme toggling, and undo toasts.

---

## 📁 Project Architecture

```
YT Bookmarker/
├── manifest.json              # Extension manifest (MV3)
├── package.json               # Package config & test scripts
├── jsconfig.json              # Path aliases and ES2022 setup
├── background/
│   ├── index.js               # Barrel export
│   └── service-worker.js      # Background Service Worker & storage hub
├── content/
│   ├── index.js               # Barrel export
│   ├── content.js             # Content Script (shelf, buttons, progress)
│   └── content.css            # Scoped styles (.ytq- prefix)
├── popup/
│   ├── index.js               # Barrel export
│   ├── popup.html             # Toolbar popup interface
│   ├── popup.css              # Popup styling
│   └── popup.js               # Popup controller
├── icons/
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-48.png
│   └── icon-128.png
├── data/
│   ├── index.js               # Barrel export
│   └── constants.js           # Shared constants, selectors & helpers
├── scripts/
│   ├── generate-icons.js      # Zero-dependency PNG icon generator
│   └── validate-syntax.js     # Code integrity and lint verification
└── test/
    └── mock-youtube.html      # Interactive offline test workbench
```

---

## ⚙️ Verification & Build Commands

```bash
# Run full syntax and architecture verification:
npm run test:check

# Regenerate icons:
npm run generate-icons
```
