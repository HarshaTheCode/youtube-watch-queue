/**
 * YouTube Watch Queue - Content Script
 * Responsible for UI injection (Shelf, Bookmark Buttons, Toasts) and Watch Progress Tracking.
 * Fully compatible with classic YouTube Polymer and modern 2024-2026 ViewModel/Wiz architecture.
 */

(function () {
  'use strict';

  // Fallback constants
  const CONSTANTS = (typeof window.YTQ_CONSTANTS !== 'undefined' ? window.YTQ_CONSTANTS : (typeof YTQ_CONSTANTS !== 'undefined' ? YTQ_CONSTANTS : null)) || {
    STORAGE_KEYS: { WATCH_QUEUE: 'watchQueue', SETTINGS: 'ytqSettings' },
    DEFAULT_SETTINGS: { shelfExpanded: true, watchedThreshold: 90, sortOrder: 'newest' },
    MESSAGE_TYPES: {
      GET_QUEUE: 'YTQ_GET_QUEUE',
      ADD_VIDEO: 'YTQ_ADD_VIDEO',
      REMOVE_VIDEO: 'YTQ_REMOVE_VIDEO',
      UPDATE_PROGRESS: 'YTQ_UPDATE_PROGRESS',
      CLEAR_WATCHED: 'YTQ_CLEAR_WATCHED',
      RESTORE_VIDEOS: 'YTQ_RESTORE_VIDEOS',
      GET_SETTINGS: 'YTQ_GET_SETTINGS',
      UPDATE_SETTINGS: 'YTQ_UPDATE_SETTINGS',
      QUEUE_UPDATED: 'YTQ_QUEUE_UPDATED',
    },
    TIMINGS: {
      PROGRESS_POLL_INTERVAL_MS: 5000,
      TOAST_DURATION_MS: 3000,
      MUTATION_DEBOUNCE_MS: 100,
      BUTTON_CLICK_DEBOUNCE_MS: 250,
    },
    SELECTORS: {
      VIDEO_CARD: 'ytd-rich-item-renderer, yt-lockup-view-model, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-rich-grid-media',
      THUMBNAIL_CONTAINER: 'yt-thumbnail-view-model, a.yt-lockup-view-model-wiz__content-image, a[class*="content-image"], ytd-thumbnail, #thumbnail, a#thumbnail, .ytd-thumbnail',
      TITLE: '#video-title, #video-title-link, a.yt-simple-endpoint#video-title, .yt-lockup-metadata-view-model-wiz__title, [class*="metadata-view-model"] h3, [class*="metadata-view-model"] a, h3.title-style, h3',
      CHANNEL_NAME: 'ytd-channel-name #text, #channel-name #text, .yt-lockup-metadata-view-model-wiz__text-container a, [class*="channel-name"], ytd-channel-name yt-formatted-string, #channel-info ytd-channel-name, a[href^="/@"]',
      DURATION_BADGE: 'badge-shape .badge-shape-wiz__text, span.ytd-thumbnail-overlay-time-status-renderer, ytd-thumbnail-overlay-time-status-renderer #text, [class*="thumbnail-overlay-time-status"], [class*="badge-shape-wiz__text"], #time-status span',
      SHELF_MOUNT_PARENT: [
        'ytd-browse[page-subtype="home"] ytd-rich-grid-renderer #contents',
        'ytd-browse[page-subtype="home"] #primary ytd-rich-grid-renderer',
        'ytd-browse[page-subtype="home"] #primary',
        'ytd-browse ytd-rich-grid-renderer #contents',
        'ytd-browse ytd-rich-grid-renderer',
        '#primary #contents',
        '#primary',
        '#content'
      ],
      PLAYER_VIDEO: 'video.html5-main-video, video',
    },
    extractVideoId: function (urlOrStr) {
      if (!urlOrStr) return null;
      try {
        const parsed = new URL(urlOrStr, window.location.origin || 'https://www.youtube.com');
        const v = parsed.searchParams.get('v');
        if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
        if (parsed.pathname.startsWith('/shorts/')) {
          const sid = parsed.pathname.split('/')[2];
          if (sid && /^[a-zA-Z0-9_-]{11}$/.test(sid)) return sid;
        }
      } catch (e) {}
      const m = urlOrStr.match(/(?:v=|youtu\.be\/|embed\/|\/watch\?v=|\/watch\?.+&v=|\/shorts\/)([a-zA-Z0-9_-]{11})/);
      return m ? m[1] : null;
    },
    formatDuration: function (sec) {
      if (!sec || isNaN(sec) || sec <= 0) return '0:00';
      const s = Math.floor(sec % 60);
      const m = Math.floor((sec / 60) % 60);
      const h = Math.floor(sec / 3600);
      const pad = (n) => (n < 10 ? '0' + n : '' + n);
      return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
    },
    parseDurationString: function (str) {
      if (!str) return 0;
      const parts = str.trim().split(':').map((p) => parseInt(p, 10));
      if (parts.some(isNaN)) return 0;
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parts[0] || 0;
    },
    getThumbnailUrl: function (id) {
      return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
    }
  };

  // State
  let currentQueue = [];
  let currentSettings = { ...CONSTANTS.DEFAULT_SETTINGS };
  let isProgressPolling = false;
  let progressPollTimer = null;
  let currentWatchVideoId = null;
  let lastRecordedProgress = -1;
  let toastTimeout = null;
  let undoAction = null;
  let mutationObserver = null;
  let debounceTimeout = null;

  // SVG Icons
  const ICONS = {
    BOOKMARK: '<svg viewBox="0 0 24 24"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>',
    CHEVRON_DOWN: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    CLOSE: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    CHECK: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    ARROW_LEFT: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    ARROW_RIGHT: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    SHELF_LOGO: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/></svg>',
    EMPTY_ICON: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="18" x2="12" y2="21"/><polygon points="10 8 15 11 10 14" fill="currentColor"/></svg>',
  };

  /**
   * Non-blocking message sender with strict timeout
   */
  function sendMessage(msg, timeoutMs = 2000) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ success: false, error: 'Timeout' });
        }
      }, timeoutMs);

      try {
        if (!chrome.runtime || !chrome.runtime.id) {
          clearTimeout(timer);
          resolve({ success: false, error: 'Context invalidated' });
          return;
        }
        chrome.runtime.sendMessage(msg, (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response || { success: true });
          }
        });
      } catch (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ success: false, error: err.message });
      }
    });
  }

  function getPageType() {
    const path = window.location.pathname || '';
    if (path === '/' || path === '') return 'home';
    if (path.startsWith('/feed/subscriptions')) return 'subscriptions';
    if (path.startsWith('/feed/trending') || path.startsWith('/feed/explore')) return 'trending';
    if (path.startsWith('/results')) return 'search';
    if (path.startsWith('/watch')) return 'watch';
    if (path.startsWith('/shorts')) return 'shorts';
    return 'browse';
  }

  async function initState() {
    try {
      const [queueRes, settingsRes] = await Promise.all([
        sendMessage({ type: CONSTANTS.MESSAGE_TYPES.GET_QUEUE }),
        sendMessage({ type: CONSTANTS.MESSAGE_TYPES.GET_SETTINGS }),
      ]);

      if (queueRes && queueRes.success && Array.isArray(queueRes.queue)) {
        currentQueue = queueRes.queue;
      }
      if (settingsRes && settingsRes.success && settingsRes.settings) {
        currentSettings = settingsRes.settings;
      }
    } catch (e) {
      console.warn('YTQ: initState caught', e);
    }
  }

  // =========================================================================
  // TOAST SYSTEM
  // =========================================================================

  function showToast(message, onUndo) {
    let toast = document.getElementById('ytq-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'ytq-toast';
      toast.className = 'ytq-toast';
      toast.innerHTML = `
        <span class="ytq-toast-msg" id="ytq-toast-msg"></span>
        <button class="ytq-toast-undo" id="ytq-toast-undo">UNDO</button>
      `;
      document.body.appendChild(toast);

      toast.querySelector('#ytq-toast-undo').addEventListener('click', () => {
        if (typeof undoAction === 'function') {
          undoAction();
          undoAction = null;
        }
        hideToast();
      });
    }

    const msgEl = toast.querySelector('#ytq-toast-msg');
    if (msgEl) msgEl.textContent = message;

    undoAction = onUndo;
    toast.classList.add('ytq-toast-visible');

    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      hideToast();
    }, CONSTANTS.TIMINGS.TOAST_DURATION_MS);
  }

  function hideToast() {
    const toast = document.getElementById('ytq-toast');
    if (toast) {
      toast.classList.remove('ytq-toast-visible');
    }
    undoAction = null;
  }

  // =========================================================================
  // FEATURE 1: ONE-CLICK BOOKMARK CAPTURE
  // =========================================================================

  /**
   * Helper to locate video ID from any card, container, or anchor
   */
  function extractVideoIdFromElement(el) {
    if (!el) return null;

    // Check all child links
    const links = el.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"], a#thumbnail, a#video-title-link, a#video-title, a[class*="content-image"]');
    for (const a of links) {
      const href = a.getAttribute('href') || a.href;
      const vid = CONSTANTS.extractVideoId(href);
      if (vid) return vid;
    }

    // Check element itself if it is a link
    if (el.tagName === 'A') {
      const href = el.getAttribute('href') || el.href;
      const vid = CONSTANTS.extractVideoId(href);
      if (vid) return vid;
    }

    return null;
  }

  /**
   * Helper to locate thumbnail container element inside a video card
   */
  function findThumbnailContainer(card) {
    const selectors = [
      'yt-thumbnail-view-model',
      'a.yt-lockup-view-model-wiz__content-image',
      'a[class*="content-image"]',
      'ytd-thumbnail',
      '#thumbnail',
      'a#thumbnail',
      '.ytd-thumbnail',
    ];

    for (const sel of selectors) {
      const found = card.querySelector(sel);
      if (found) return found;
    }

    // Fallback: look for an anchor containing an image
    const imgs = card.querySelectorAll('img');
    for (const img of imgs) {
      const parentA = img.closest('a');
      if (parentA) return parentA;
    }

    return null;
  }

  /**
   * Extract video metadata from video card
   */
  function extractVideoMetadata(card, videoId) {
    try {
      // 1. Title
      let title = 'YouTube Video';
      const titleSelectors = [
        '#video-title',
        '#video-title-link',
        'a.yt-simple-endpoint#video-title',
        '.yt-lockup-metadata-view-model-wiz__title',
        '[class*="metadata-view-model"] h3',
        '[class*="metadata-view-model"] a',
        'h3.title-style',
        'h3',
      ];
      for (const sel of titleSelectors) {
        const el = card.querySelector(sel);
        if (el) {
          const text = (el.textContent || el.getAttribute('title') || el.getAttribute('aria-label') || '').trim();
          if (text) {
            title = text;
            break;
          }
        }
      }

      // 2. Channel Name
      let channelName = '';
      const channelSelectors = [
        'ytd-channel-name #text',
        '#channel-name #text',
        '.yt-lockup-metadata-view-model-wiz__text-container a',
        '[class*="channel-name"]',
        'ytd-channel-name yt-formatted-string',
        '#channel-info ytd-channel-name',
        'a[href^="/@"]',
        'a[href*="/channel/"]',
      ];
      for (const sel of channelSelectors) {
        const el = card.querySelector(sel);
        if (el && el.textContent && el.textContent.trim()) {
          channelName = el.textContent.trim();
          break;
        }
      }

      // 3. Duration
      let durationFormatted = '0:00';
      let durationSeconds = 0;
      const durationSelectors = [
        'badge-shape .badge-shape-wiz__text',
        'span.ytd-thumbnail-overlay-time-status-renderer',
        'ytd-thumbnail-overlay-time-status-renderer #text',
        '[class*="thumbnail-overlay-time-status"]',
        '[class*="badge-shape-wiz__text"]',
        '#time-status span',
      ];
      for (const sel of durationSelectors) {
        const el = card.querySelector(sel);
        if (el && el.textContent && el.textContent.trim()) {
          const text = el.textContent.trim();
          if (text.includes(':')) {
            durationFormatted = text;
            durationSeconds = CONSTANTS.parseDurationString(text);
            break;
          }
        }
      }

      return {
        id: videoId,
        title,
        channelName: channelName || 'YouTube Channel',
        thumbnailUrl: CONSTANTS.getThumbnailUrl(videoId),
        durationSeconds,
        durationFormatted,
        savedAt: new Date().toISOString(),
        progress: 0,
        lastWatchedAt: null,
        isWatched: false,
      };
    } catch (err) {
      console.warn('YTQ: Error extracting metadata', err);
      return {
        id: videoId,
        title: 'YouTube Video',
        channelName: '',
        thumbnailUrl: CONSTANTS.getThumbnailUrl(videoId),
        durationSeconds: 0,
        durationFormatted: '0:00',
        savedAt: new Date().toISOString(),
        progress: 0,
        isWatched: false,
      };
    }
  }

  /**
   * Injects or updates the bookmark ribbon on a video thumbnail
   */
  function injectBookmarkButton(card) {
    if (!card || card.nodeType !== Node.ELEMENT_NODE) return;

    // Avoid injecting into our own shelf cards
    if (card.closest('#ytq-shelf-root')) return;

    const videoId = extractVideoIdFromElement(card);
    if (!videoId) return;

    const thumbContainer = findThumbnailContainer(card);
    if (!thumbContainer) return;

    // Ensure the container is positioned relative
    thumbContainer.classList.add('ytq-relative-parent');
    if (window.getComputedStyle(thumbContainer).position === 'static') {
      thumbContainer.style.position = 'relative';
    }

    const isSaved = currentQueue.some((v) => v.id === videoId);
    let btn = thumbContainer.querySelector(`.ytq-bookmark-btn[data-video-id="${videoId}"]`);

    if (!btn) {
      // Remove any stale button from previous reused virtual DOM node
      const staleBtn = thumbContainer.querySelector('.ytq-bookmark-btn');
      if (staleBtn) staleBtn.remove();

      btn = document.createElement('div');
      btn.className = `ytq-bookmark-btn ${isSaved ? 'ytq-saved' : ''}`;
      btn.setAttribute('role', 'button');
      btn.setAttribute('tabindex', '0');
      btn.dataset.videoId = videoId;
      btn.setAttribute('aria-label', isSaved ? 'Remove from Watch Queue' : 'Add to Watch Queue');
      btn.title = isSaved ? 'In Watch Queue (Click to remove)' : 'Add to Watch Queue';
      btn.innerHTML = ICONS.BOOKMARK;

      // Handle click with capture phase to stop YouTube navigation
      const clickHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        handleBookmarkToggle(card, videoId, btn);
      };

      btn.addEventListener('click', clickHandler, true);
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          handleBookmarkToggle(card, videoId, btn);
        }
      });

      thumbContainer.appendChild(btn);
    } else {
      // Update existing button
      if (isSaved) {
        btn.classList.add('ytq-saved');
        btn.title = 'In Watch Queue (Click to remove)';
        btn.setAttribute('aria-label', 'Remove from Watch Queue');
      } else {
        btn.classList.remove('ytq-saved');
        btn.title = 'Add to Watch Queue';
        btn.setAttribute('aria-label', 'Add to Watch Queue');
      }
    }
  }

  /**
   * Bookmark button click toggle
   */
  async function handleBookmarkToggle(card, videoId, btn) {
    const isCurrentlySaved = currentQueue.some((v) => v.id === videoId);

    if (isCurrentlySaved) {
      // Remove
      const existing = currentQueue.find((v) => v.id === videoId);
      btn.classList.remove('ytq-saved');
      btn.title = 'Add to Watch Queue';
      btn.setAttribute('aria-label', 'Add to Watch Queue');

      currentQueue = currentQueue.filter((v) => v.id !== videoId);
      renderShelf();

      const res = await sendMessage({
        type: CONSTANTS.MESSAGE_TYPES.REMOVE_VIDEO,
        videoId,
      });

      if (res && res.success && Array.isArray(res.queue)) {
        currentQueue = res.queue;
        renderShelf();
      }

      showToast(`Removed from Watch Queue`, async () => {
        if (existing) {
          await sendMessage({
            type: CONSTANTS.MESSAGE_TYPES.ADD_VIDEO,
            video: existing,
          });
          await refreshStateAndUI();
        }
      });
    } else {
      // Add
      const videoData = extractVideoMetadata(card, videoId);

      btn.classList.add('ytq-saved', 'ytq-animating');
      setTimeout(() => btn.classList.remove('ytq-animating'), 350);
      btn.title = 'In Watch Queue (Click to remove)';
      btn.setAttribute('aria-label', 'Remove from Watch Queue');

      currentQueue.unshift(videoData);
      renderShelf();

      const res = await sendMessage({
        type: CONSTANTS.MESSAGE_TYPES.ADD_VIDEO,
        video: videoData,
      });

      if (res && res.success && Array.isArray(res.queue)) {
        currentQueue = res.queue;
        renderShelf();
      }
    }
  }

  /**
   * Universal scanner: finds both cards and direct thumbnail anchors
   */
  function scanAndInjectBookmarks() {
    const page = getPageType();
    // Do not inject on watch page or shorts viewer
    if (page === 'watch' || page === 'shorts') return;

    // 1. Scan primary card containers
    const cards = document.querySelectorAll(CONSTANTS.SELECTORS.VIDEO_CARD);
    cards.forEach((card) => {
      injectBookmarkButton(card);
    });

    // 2. Fallback scan: any direct anchor linking to a video
    const thumbLinks = document.querySelectorAll('a[href*="/watch?v="]:not(#ytq-shelf-root a)');
    thumbLinks.forEach((a) => {
      const card = a.closest(CONSTANTS.SELECTORS.VIDEO_CARD) || a.parentElement;
      if (card) {
        injectBookmarkButton(card);
      }
    });
  }

  // =========================================================================
  // FEATURE 3: COLLAPSIBLE TOP SHELF ON HOME PAGE
  // =========================================================================

  function getShelfMountPoint() {
    for (const selector of CONSTANTS.SELECTORS.SHELF_MOUNT_PARENT) {
      try {
        const el = document.querySelector(selector);
        if (el) return el;
      } catch (e) {}
    }
    return null;
  }

  function ensureShelfElement() {
    if (getPageType() !== 'home') {
      const existing = document.getElementById('ytq-shelf-root');
      if (existing) existing.remove();
      return null;
    }

    let shelf = document.getElementById('ytq-shelf-root');
    if (!shelf) {
      const mount = getShelfMountPoint();
      if (!mount) return null;

      shelf = document.createElement('div');
      shelf.id = 'ytq-shelf-root';
      shelf.className = currentSettings.shelfExpanded ? 'ytq-expanded' : 'ytq-collapsed';

      if (mount.firstChild) {
        mount.insertBefore(shelf, mount.firstChild);
      } else {
        mount.appendChild(shelf);
      }
    }
    return shelf;
  }

  function renderShelf() {
    const shelf = ensureShelfElement();
    if (!shelf) return;

    const totalCount = currentQueue.length;
    const watchedCount = currentQueue.filter((v) => v.isWatched).length;
    const inProgressCount = currentQueue.filter((v) => !v.isWatched && v.progress > 0).length;
    const newCount = currentQueue.filter((v) => !v.isWatched && (!v.progress || v.progress === 0)).length;

    let summaryText = '';
    if (totalCount === 0) {
      summaryText = 'Your Watch Queue is empty. Bookmark videos to see them here.';
    } else {
      const parts = [`${totalCount} video${totalCount === 1 ? '' : 's'}`];
      if (newCount > 0) parts.push(`${newCount} new`);
      if (inProgressCount > 0) parts.push(`${inProgressCount} in progress`);
      if (watchedCount > 0) parts.push(`${watchedCount} watched`);
      summaryText = parts.join(' · ');
    }

    const isExpanded = shelf.classList.contains('ytq-expanded');

    shelf.innerHTML = `
      <!-- Collapsed / Summary Bar (48px) -->
      <div class="ytq-shelf-bar" id="ytq-shelf-toggle-bar" role="button" tabindex="0" title="Click to ${isExpanded ? 'collapse' : 'expand'} Watch Queue">
        <div class="ytq-bar-left">
          <span class="ytq-bar-icon">${ICONS.SHELF_LOGO}</span>
          <span class="ytq-bar-title">Watch Queue</span>
        </div>
        <div class="ytq-bar-center">${escapeHtml(summaryText)}</div>
        <div class="ytq-bar-right">
          ${totalCount > 0 ? `<span class="ytq-count-badge">${totalCount}</span>` : ''}
          <span class="ytq-chevron-icon">${ICONS.CHEVRON_DOWN}</span>
        </div>
      </div>

      <!-- Expanded Content Section -->
      <div class="ytq-shelf-content" id="ytq-shelf-content">
        <div class="ytq-shelf-header">
          <div class="ytq-header-title-wrap">
            <h3 class="ytq-header-title">Watch Queue</h3>
            <span class="ytq-count-badge">${totalCount}</span>
          </div>
          <div class="ytq-header-actions">
            <button class="ytq-btn-clear-watched" id="ytq-btn-clear-watched" ${watchedCount === 0 ? 'disabled' : ''}>
              Clear Watched (${watchedCount})
            </button>
            <button class="ytq-btn-collapse" id="ytq-btn-collapse-header" title="Collapse Shelf">
              <span class="ytq-chevron-icon">${ICONS.CHEVRON_DOWN}</span>
            </button>
          </div>
        </div>

        <div class="ytq-scroller-wrap">
          <button class="ytq-scroll-btn ytq-left ytq-hidden" id="ytq-scroll-left" title="Scroll left">
            ${ICONS.ARROW_LEFT}
          </button>

          <div class="ytq-cards-container" id="ytq-cards-container">
            ${totalCount === 0 ? renderEmptyState() : renderCardsHtml(currentQueue)}
          </div>

          <button class="ytq-scroll-btn ytq-right ytq-hidden" id="ytq-scroll-right" title="Scroll right">
            ${ICONS.ARROW_RIGHT}
          </button>
        </div>
      </div>
    `;

    bindShelfEvents(shelf);
  }

  function renderEmptyState() {
    return `
      <div class="ytq-empty-state">
        <div class="ytq-empty-icon">${ICONS.EMPTY_ICON}</div>
        <p class="ytq-empty-text">Your Watch Queue is empty.<br>Hover over any video thumbnail and click the bookmark ribbon to save it here.</p>
      </div>
    `;
  }

  function renderCardsHtml(queue) {
    return queue
      .map((video) => {
        const progress = Math.min(100, Math.max(0, video.progress || 0));
        const isWatched = Boolean(video.isWatched);

        return `
          <div class="ytq-card ${isWatched ? 'ytq-watched' : ''}" data-video-id="${escapeHtml(video.id)}">
            <div class="ytq-card-thumb-wrap">
              <img class="ytq-card-thumb" src="${escapeHtml(video.thumbnailUrl)}" alt="${escapeHtml(video.title)}" loading="lazy" />
              
              ${video.durationFormatted ? `<span class="ytq-card-duration">${escapeHtml(video.durationFormatted)}</span>` : ''}

              ${
                isWatched
                  ? `<span class="ytq-card-pct-badge ytq-badge-watched" title="Watched">${ICONS.CHECK} Watched</span>`
                  : progress > 0
                  ? `<span class="ytq-card-pct-badge">${progress}%</span>`
                  : ''
              }

              <div class="ytq-card-progress-track">
                <div class="ytq-card-progress-bar" style="width: ${isWatched ? 100 : progress}%"></div>
              </div>

              <button class="ytq-card-remove-btn" data-video-id="${escapeHtml(video.id)}" title="Remove from queue">
                ${ICONS.CLOSE}
              </button>
            </div>

            <div class="ytq-card-info">
              <h4 class="ytq-card-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</h4>
              <p class="ytq-card-channel" title="${escapeHtml(video.channelName)}">${escapeHtml(video.channelName)}</p>
            </div>
          </div>
        `;
      })
      .join('');
  }

  function bindShelfEvents(shelf) {
    const toggleBar = shelf.querySelector('#ytq-shelf-toggle-bar');
    const collapseBtn = shelf.querySelector('#ytq-btn-collapse-header');

    const toggleShelf = async (forceState) => {
      const willExpand = typeof forceState === 'boolean' ? forceState : !shelf.classList.contains('ytq-expanded');
      if (willExpand) {
        shelf.classList.remove('ytq-collapsed');
        shelf.classList.add('ytq-expanded');
      } else {
        shelf.classList.remove('ytq-expanded');
        shelf.classList.add('ytq-collapsed');
      }
      currentSettings.shelfExpanded = willExpand;
      await sendMessage({
        type: CONSTANTS.MESSAGE_TYPES.UPDATE_SETTINGS,
        settings: { shelfExpanded: willExpand },
      });
      updateScrollButtonsVisibility();
    };

    if (toggleBar) {
      toggleBar.addEventListener('click', () => toggleShelf());
    }
    if (collapseBtn) {
      collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleShelf(false);
      });
    }

    const clearWatchedBtn = shelf.querySelector('#ytq-btn-clear-watched');
    if (clearWatchedBtn) {
      clearWatchedBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const watched = currentQueue.filter((v) => v.isWatched);
        if (watched.length === 0) return;

        const res = await sendMessage({ type: CONSTANTS.MESSAGE_TYPES.CLEAR_WATCHED });
        if (res && res.success) {
          currentQueue = res.queue;
          renderShelf();
          scanAndInjectBookmarks();

          showToast(`Cleared ${watched.length} watched video${watched.length === 1 ? '' : 's'}`, async () => {
            await sendMessage({
              type: CONSTANTS.MESSAGE_TYPES.RESTORE_VIDEOS,
              videos: watched,
            });
            await refreshStateAndUI();
          });
        }
      });
    }

    const container = shelf.querySelector('#ytq-cards-container');
    const scrollLeftBtn = shelf.querySelector('#ytq-scroll-left');
    const scrollRightBtn = shelf.querySelector('#ytq-scroll-right');

    function updateScrollButtonsVisibility() {
      if (!container || !scrollLeftBtn || !scrollRightBtn) return;
      const atStart = container.scrollLeft <= 5;
      const atEnd = container.scrollLeft + container.clientWidth >= container.scrollWidth - 5;

      scrollLeftBtn.classList.toggle('ytq-hidden', atStart);
      scrollRightBtn.classList.toggle('ytq-hidden', atEnd || container.scrollWidth <= container.clientWidth);
    }

    if (container) {
      container.addEventListener('scroll', updateScrollButtonsVisibility, { passive: true });
      setTimeout(updateScrollButtonsVisibility, 100);

      if (scrollLeftBtn) {
        scrollLeftBtn.addEventListener('click', () => {
          container.scrollBy({ left: -container.clientWidth * 0.8, behavior: 'smooth' });
        });
      }

      if (scrollRightBtn) {
        scrollRightBtn.addEventListener('click', () => {
          container.scrollBy({ left: container.clientWidth * 0.8, behavior: 'smooth' });
        });
      }
    }

    const cards = shelf.querySelectorAll('.ytq-card');
    cards.forEach((card) => {
      const videoId = card.dataset.videoId;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.ytq-card-remove-btn')) return;
        window.location.href = `/watch?v=${videoId}`;
      });

      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, videoId);
      });

      const removeBtn = card.querySelector('.ytq-card-remove-btn');
      if (removeBtn) {
        removeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const targetVideo = currentQueue.find((v) => v.id === videoId);

          card.classList.add('ytq-removing');

          setTimeout(async () => {
            const res = await sendMessage({
              type: CONSTANTS.MESSAGE_TYPES.REMOVE_VIDEO,
              videoId,
            });

            if (res && res.success) {
              currentQueue = res.queue;
              renderShelf();
              scanAndInjectBookmarks();

              showToast(`Removed "${(targetVideo && targetVideo.title) || 'video'}"`, async () => {
                if (targetVideo) {
                  await sendMessage({
                    type: CONSTANTS.MESSAGE_TYPES.ADD_VIDEO,
                    video: targetVideo,
                  });
                  await refreshStateAndUI();
                }
              });
            }
          }, 200);
        });
      }
    });
  }

  function showContextMenu(x, y, videoId) {
    const existing = document.getElementById('ytq-context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'ytq-context-menu';
    menu.className = 'ytq-context-menu';
    menu.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 100)}px`;

    menu.innerHTML = `
      <div class="ytq-menu-item" id="ytq-menu-mark-watched">✓ Mark as Watched</div>
      <div class="ytq-menu-item" id="ytq-menu-reset-progress">↺ Reset Progress</div>
    `;

    document.body.appendChild(menu);

    const closeMenu = (e) => {
      if (menu && !menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 10);

    menu.querySelector('#ytq-menu-mark-watched').addEventListener('click', async () => {
      menu.remove();
      await sendMessage({
        type: CONSTANTS.MESSAGE_TYPES.UPDATE_PROGRESS,
        videoId,
        progress: 100,
      });
      await refreshStateAndUI();
    });

    menu.querySelector('#ytq-menu-reset-progress').addEventListener('click', async () => {
      menu.remove();
      const video = currentQueue.find((v) => v.id === videoId);
      if (video) {
        video.progress = 0;
        video.isWatched = false;
        await sendMessage({
          type: CONSTANTS.MESSAGE_TYPES.ADD_VIDEO,
          video,
        });
        await refreshStateAndUI();
      }
    });
  }

  // =========================================================================
  // FEATURE 4: WATCH PROGRESS TRACKING
  // =========================================================================

  function setupProgressTracking() {
    if (getPageType() !== 'watch') {
      stopProgressTracking();
      return;
    }

    const currentId = CONSTANTS.extractVideoId(window.location.search);
    if (!currentId) {
      stopProgressTracking();
      return;
    }

    const isInQueue = currentQueue.some((v) => v.id === currentId);
    if (!isInQueue) {
      stopProgressTracking();
      return;
    }

    currentWatchVideoId = currentId;

    if (isProgressPolling) return;
    isProgressPolling = true;

    progressPollTimer = setInterval(pollVideoProgress, CONSTANTS.TIMINGS.PROGRESS_POLL_INTERVAL_MS);

    const videoEl = document.querySelector(CONSTANTS.SELECTORS.PLAYER_VIDEO);
    if (videoEl) {
      videoEl.addEventListener('pause', pollVideoProgress);
      videoEl.addEventListener('ended', pollVideoProgress);
    }
  }

  function stopProgressTracking() {
    if (progressPollTimer) {
      clearInterval(progressPollTimer);
      progressPollTimer = null;
    }
    isProgressPolling = false;
    currentWatchVideoId = null;
    lastRecordedProgress = -1;
  }

  async function pollVideoProgress() {
    if (!currentWatchVideoId) return;

    const videoEl = document.querySelector(CONSTANTS.SELECTORS.PLAYER_VIDEO);
    if (!videoEl || !videoEl.duration || isNaN(videoEl.duration) || videoEl.duration <= 0) {
      return;
    }

    const duration = videoEl.duration;
    const currentTime = videoEl.currentTime;
    const progress = Math.min(100, Math.round((currentTime / duration) * 100));

    if (progress !== lastRecordedProgress) {
      lastRecordedProgress = progress;
      await sendMessage({
        type: CONSTANTS.MESSAGE_TYPES.UPDATE_PROGRESS,
        videoId: currentWatchVideoId,
        progress: progress,
        durationSeconds: Math.round(duration),
      });
    }
  }

  // =========================================================================
  // SPA NAVIGATION & MUTATION OBSERVER
  // =========================================================================

  async function handlePageChange() {
    const page = getPageType();

    if (page === 'home') {
      renderShelf();
    } else {
      const shelf = document.getElementById('ytq-shelf-root');
      if (shelf) shelf.remove();
    }

    if (page !== 'watch' && page !== 'shorts') {
      scanAndInjectBookmarks();
    }

    if (page === 'watch') {
      setupProgressTracking();
    } else {
      stopProgressTracking();
    }
  }

  async function refreshStateAndUI() {
    await initState();
    if (getPageType() === 'home') {
      renderShelf();
    }
    scanAndInjectBookmarks();
  }

  function setupMutationObserver() {
    if (mutationObserver) return;

    const targetNode = document.body || document.documentElement;
    if (!targetNode) return;

    mutationObserver = new MutationObserver(() => {
      if (debounceTimeout) clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => {
        const page = getPageType();
        if (page === 'home') {
          const shelf = document.getElementById('ytq-shelf-root');
          if (!shelf) renderShelf();
        }
        if (page !== 'watch' && page !== 'shorts') {
          scanAndInjectBookmarks();
        }
      }, CONSTANTS.TIMINGS.MUTATION_DEBOUNCE_MS);
    });

    mutationObserver.observe(targetNode, {
      childList: true,
      subtree: true,
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // =========================================================================
  // INITIALIZATION & LISTENERS
  // =========================================================================

  async function init() {
    // 1. Immediately setup observer and initial scans without waiting on background worker
    setupMutationObserver();
    handlePageChange();
    scanAndInjectBookmarks();

    // Re-scan periodically during initial page load/hydration
    [300, 800, 1500, 3000, 5000].forEach((delay) => {
      setTimeout(scanAndInjectBookmarks, delay);
    });

    // 2. Fetch persisted state in background and refresh UI
    await initState();
    if (getPageType() === 'home') {
      renderShelf();
    }
    scanAndInjectBookmarks();

    // YouTube navigation listeners
    window.addEventListener('yt-navigate-finish', handlePageChange);
    window.addEventListener('yt-page-data-updated', handlePageChange);
    window.addEventListener('spfdone', handlePageChange);
    window.addEventListener('popstate', handlePageChange);

    // Cross-tab and service worker broadcasts
    chrome.runtime.onMessage.addListener((message) => {
      if (!message || !message.type) return;

      if (message.type === CONSTANTS.MESSAGE_TYPES.QUEUE_UPDATED) {
        if (Array.isArray(message.queue)) {
          currentQueue = message.queue;
        }
        if (getPageType() === 'home') {
          renderShelf();
        }
        scanAndInjectBookmarks();
      } else if (message.type === CONSTANTS.MESSAGE_TYPES.UPDATE_SETTINGS) {
        if (message.settings) {
          currentSettings = message.settings;
          const shelf = document.getElementById('ytq-shelf-root');
          if (shelf) {
            shelf.className = currentSettings.shelfExpanded ? 'ytq-expanded' : 'ytq-collapsed';
          }
        }
      }
    });

    window.addEventListener('beforeunload', () => {
      if (isProgressPolling && currentWatchVideoId) {
        pollVideoProgress();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
