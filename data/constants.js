/**
 * YouTube Watch Queue - Constants & Shared Utilities
 * Used across Background Service Worker, Content Scripts, and Popup.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const exports = factory();
    root.YTQ_CONSTANTS = exports;
    if (typeof globalThis !== 'undefined') {
      globalThis.YTQ_CONSTANTS = exports;
    }
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORAGE_KEYS = {
    WATCH_QUEUE: 'watchQueue',
    SETTINGS: 'ytqSettings',
  };

  const DEFAULT_SETTINGS = {
    shelfExpanded: true,
    watchedThreshold: 90,
    sortOrder: 'newest', // 'newest' | 'oldest' | 'progress'
  };

  const MESSAGE_TYPES = {
    GET_QUEUE: 'YTQ_GET_QUEUE',
    ADD_VIDEO: 'YTQ_ADD_VIDEO',
    REMOVE_VIDEO: 'YTQ_REMOVE_VIDEO',
    UPDATE_PROGRESS: 'YTQ_UPDATE_PROGRESS',
    CLEAR_WATCHED: 'YTQ_CLEAR_WATCHED',
    RESTORE_VIDEOS: 'YTQ_RESTORE_VIDEOS',
    GET_SETTINGS: 'YTQ_GET_SETTINGS',
    UPDATE_SETTINGS: 'YTQ_UPDATE_SETTINGS',
    UPDATE_DURATION: 'YTQ_UPDATE_DURATION',
    QUEUE_UPDATED: 'YTQ_QUEUE_UPDATED',
  };

  const TIMINGS = {
    PROGRESS_POLL_INTERVAL_MS: 5000,
    TOAST_DURATION_MS: 3000,
    MUTATION_DEBOUNCE_MS: 100,
    BUTTON_CLICK_DEBOUNCE_MS: 250,
    ANIMATION_FAST_MS: 200,
    ANIMATION_NORMAL_MS: 300,
  };

  // Modern YouTube resilient DOM selectors (supports classic Polymer, Lit, and 2024-2026 ViewModel/Wiz architecture)
  const SELECTORS = {
    // Video containers across Home, Subscriptions, Trending, Search
    VIDEO_CARD: [
      'ytd-rich-item-renderer',
      'yt-lockup-view-model',
      'ytd-video-renderer',
      'ytd-grid-video-renderer',
      'ytd-compact-video-renderer',
      'ytd-rich-grid-media',
    ].join(', '),

    // Thumbnail containers within video cards
    THUMBNAIL_CONTAINER: [
      'yt-thumbnail-view-model',
      'a.yt-lockup-view-model-wiz__content-image',
      'a.ytLockupViewModelContentImage',
      'a[class*="ContentImage"]',
      'a[class*="content-image"]',
      'ytd-thumbnail',
      '#thumbnail',
      'a#thumbnail',
      '.ytd-thumbnail',
    ].join(', '),

    // Title element selectors
    TITLE: [
      '#video-title',
      '#video-title-link',
      'a.yt-simple-endpoint#video-title',
      '.yt-lockup-metadata-view-model-wiz__title',
      '[class*="metadata-view-model"] h3',
      '[class*="metadata-view-model"] a',
      'h3.title-style',
      'h3',
    ].join(', '),

    // Channel name element selectors
    CHANNEL_NAME: [
      'ytd-channel-name #text',
      '#channel-name #text',
      '.yt-lockup-metadata-view-model-wiz__text-container a',
      '[class*="channel-name"]',
      'ytd-channel-name yt-formatted-string',
      '#channel-info ytd-channel-name',
      'a[href^="/@"]',
      'a[href*="/channel/"]',
    ].join(', '),

    // Duration badge overlay selectors (including modern 2025/2026 badge-view-model)
    DURATION_BADGE: [
      'yt-thumbnail-overlay-badge-view-model badge-shape',
      'yt-thumbnail-overlay-badge-view-model',
      'badge-shape .badge-shape-wiz__text',
      'badge-shape .yt-badge-shape__text',
      'badge-shape',
      'span.ytd-thumbnail-overlay-time-status-renderer',
      'ytd-thumbnail-overlay-time-status-renderer #text',
      '[class*="thumbnail-overlay-time-status"]',
      '[class*="badge-shape-wiz__text"]',
      '[class*="yt-badge-shape__text"]',
      '#time-status span',
    ].join(', '),

    // Main browse container where shelf should be injected (strictly targeting active non-hidden views)
    SHELF_MOUNT_PARENT: [
      'ytd-browse:not([hidden])[page-subtype="home"] ytd-rich-grid-renderer',
      'ytd-browse:not([hidden]) ytd-rich-grid-renderer',
      'ytd-browse[page-subtype="home"]:not([hidden]) #primary ytd-rich-grid-renderer',
      'ytd-browse:not([hidden]) #primary ytd-rich-grid-renderer',
      'ytd-browse:not([hidden]) #primary',
      '#primary ytd-rich-grid-renderer',
      '#primary',
      '#content',
    ],

    // Video player elements for progress tracking
    PLAYER_VIDEO: 'video.html5-main-video, video',
    PLAYER_CONTAINER: '#movie_player',

    // Inline preview containers that appear on thumbnail hover
    PREVIEW_CONTAINERS: [
      'ytd-video-preview',
      'ytd-inline-preview-renderer',
      '#mouseover-overlay',
      '#hover-overlays',
      '#inline-preview-player',
    ].join(', '),
  };

  // Utility Functions
  function extractVideoId(urlOrStr) {
    if (!urlOrStr || typeof urlOrStr !== 'string') return null;
    try {
      const parsed = new URL(urlOrStr, window.location.origin || 'https://www.youtube.com');
      const v = parsed.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

      // Handle /shorts/VIDEO_ID
      if (parsed.pathname.startsWith('/shorts/')) {
        const parts = parsed.pathname.split('/');
        const sid = parts[2];
        if (sid && /^[a-zA-Z0-9_-]{11}$/.test(sid)) return sid;
      }
    } catch {
      // Fallback regex match below
    }

    const match = urlOrStr.match(/(?:v=|youtu\.be\/|embed\/|\/watch\?v=|\/watch\?.+&v=|\/shorts\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  function formatDuration(totalSeconds) {
    if (typeof totalSeconds !== 'number' || isNaN(totalSeconds) || totalSeconds <= 0) {
      return '0:00';
    }
    const secs = Math.floor(totalSeconds % 60);
    const mins = Math.floor((totalSeconds / 60) % 60);
    const hrs = Math.floor(totalSeconds / 3600);

    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    if (hrs > 0) {
      return `${hrs}:${pad(mins)}:${pad(secs)}`;
    }
    return `${mins}:${pad(secs)}`;
  }

  function parseDurationString(str) {
    if (!str || typeof str !== 'string') return 0;
    const clean = str.trim();
    const parts = clean.split(':').map((p) => parseInt(p, 10));
    if (parts.some(isNaN)) return 0;

    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return parts[0] || 0;
  }

  /**
   * Parse natural language duration from YouTube's aria-label attributes.
   * Example: "Never Gonna Give You Up by Rick Astley ... 3 minutes, 33 seconds ..."
   * Example: "1 hour, 14 minutes, 20 seconds"
   * Example: "45 seconds"
   */
  function parseAriaLabelDuration(str) {
    if (!str || typeof str !== 'string') return null;

    // Check for explicit "X hours, Y minutes, Z seconds"
    const hourMatch = str.match(/(\d+)\s*(?:hours?|hrs?)/i);
    const minMatch = str.match(/(\d+)\s*(?:minutes?|mins?)/i);
    const secMatch = str.match(/(\d+)\s*(?:seconds?|secs?)/i);

    if (hourMatch || minMatch || secMatch) {
      const hours = hourMatch ? parseInt(hourMatch[1], 10) : 0;
      const mins = minMatch ? parseInt(minMatch[1], 10) : 0;
      const secs = secMatch ? parseInt(secMatch[1], 10) : 0;
      const totalSeconds = hours * 3600 + mins * 60 + secs;
      if (totalSeconds > 0) {
        return {
          seconds: totalSeconds,
          formatted: formatDuration(totalSeconds),
        };
      }
    }

    // Check for inline timestamp regex like "3:33" or "1:02:15"
    const timeMatch = str.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
    if (timeMatch) {
      const formatted = timeMatch[1];
      const seconds = parseDurationString(formatted);
      if (seconds > 0) {
        return { seconds, formatted };
      }
    }

    return null;
  }

  function getThumbnailUrl(videoId) {
    if (!videoId) return '';
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }

  return {
    STORAGE_KEYS,
    DEFAULT_SETTINGS,
    MESSAGE_TYPES,
    TIMINGS,
    SELECTORS,
    extractVideoId,
    formatDuration,
    parseDurationString,
    parseAriaLabelDuration,
    getThumbnailUrl,
  };
});
