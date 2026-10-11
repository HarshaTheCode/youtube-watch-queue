/**
 * YouTube Watch Queue - Popup Logic
 */

(function () {
  'use strict';

  const CONSTANTS = (typeof YTQ_CONSTANTS !== 'undefined' ? YTQ_CONSTANTS : null) || {
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
    },
  };

  let queue = [];
  let settings = { ...CONSTANTS.DEFAULT_SETTINGS };
  let undoCallback = null;
  let toastTimer = null;

  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: true });
        }
      });
    });
  }

  function showToast(message, onUndo) {
    const toastEl = document.getElementById('popup-toast');
    const msgEl = document.getElementById('popup-toast-msg');
    const undoBtn = document.getElementById('popup-toast-undo');

    if (!toastEl) return;
    msgEl.textContent = message;
    undoCallback = onUndo;
    toastEl.classList.remove('hidden');

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.add('hidden');
      undoCallback = null;
    }, 3000);

    undoBtn.onclick = () => {
      if (typeof undoCallback === 'function') {
        undoCallback();
        undoCallback = null;
      }
      toastEl.classList.add('hidden');
    };
  }

  async function loadData() {
    const [queueRes, settingsRes] = await Promise.all([
      sendMessage({ type: CONSTANTS.MESSAGE_TYPES.GET_QUEUE }),
      sendMessage({ type: CONSTANTS.MESSAGE_TYPES.GET_SETTINGS }),
    ]);

    if (queueRes && queueRes.success && Array.isArray(queueRes.queue)) {
      queue = queueRes.queue;
    }
    if (settingsRes && settingsRes.success && settingsRes.settings) {
      settings = settingsRes.settings;
    }

    renderUI();
  }

  function renderUI() {
    const totalCountEl = document.getElementById('total-count');
    const progressCountEl = document.getElementById('progress-count');
    const watchedCountEl = document.getElementById('watched-count');
    const clearWatchedBtn = document.getElementById('btn-clear-watched');
    const emptyStateEl = document.getElementById('empty-state');
    const listEl = document.getElementById('queue-list');
    const thresholdSelect = document.getElementById('setting-threshold');
    const expandedSelect = document.getElementById('setting-expanded');

    const total = queue.length;
    const watched = queue.filter((v) => v.isWatched).length;
    const inProgress = queue.filter((v) => !v.isWatched && v.progress > 0).length;

    totalCountEl.textContent = total;
    progressCountEl.textContent = inProgress;
    watchedCountEl.textContent = watched;

    clearWatchedBtn.disabled = watched === 0;

    if (thresholdSelect) thresholdSelect.value = String(settings.watchedThreshold || 90);
    if (expandedSelect) expandedSelect.value = String(Boolean(settings.shelfExpanded));

    if (total === 0) {
      emptyStateEl.classList.remove('hidden');
      listEl.innerHTML = '';
      return;
    }

    emptyStateEl.classList.add('hidden');
    listEl.innerHTML = '';

    queue.forEach((video) => {
      const li = document.createElement('li');
      li.className = `queue-item ${video.isWatched ? 'is-watched' : ''}`;
      li.dataset.id = video.id;

      const progress = Math.min(100, Math.max(0, video.progress || 0));

      li.innerHTML = `
        <div class="item-thumb-wrap">
          <img class="item-thumb" src="${escapeHtml(video.thumbnailUrl)}" alt="" loading="lazy">
          ${video.durationFormatted ? `<span class="item-duration">${escapeHtml(video.durationFormatted)}</span>` : ''}
          <div class="item-progress-track">
            <div class="item-progress-fill" style="width: ${video.isWatched ? 100 : progress}%"></div>
          </div>
        </div>
        <div class="item-details">
          <div class="item-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</div>
          <div class="item-channel">${escapeHtml(video.channelName || 'YouTube')}</div>
          <div class="item-status">
            ${
              video.isWatched
                ? `<span class="status-watched">✓ Watched</span>`
                : progress > 0
                ? `<span class="status-progress">${progress}% watched</span>`
                : `<span>Unwatched</span>`
            }
          </div>
        </div>
        <button class="btn-remove-item" title="Remove video">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      `;

      // Click to open video in new tab
      li.addEventListener('click', (e) => {
        if (e.target.closest('.btn-remove-item')) return;
        chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${video.id}` });
      });

      // Remove button
      const removeBtn = li.querySelector('.btn-remove-item');
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const removed = video;
        const res = await sendMessage({
          type: CONSTANTS.MESSAGE_TYPES.REMOVE_VIDEO,
          videoId: video.id,
        });
        if (res && res.success) {
          queue = res.queue;
          renderUI();
          showToast(`Removed "${video.title.slice(0, 25)}..."`, async () => {
            await sendMessage({
              type: CONSTANTS.MESSAGE_TYPES.ADD_VIDEO,
              video: removed,
            });
            await loadData();
          });
        }
      });

      listEl.appendChild(li);
    });
  }

  function setupEventListeners() {
    // Clear Watched
    const clearWatchedBtn = document.getElementById('btn-clear-watched');
    clearWatchedBtn.addEventListener('click', async () => {
      const watchedVideos = queue.filter((v) => v.isWatched);
      if (watchedVideos.length === 0) return;

      const res = await sendMessage({ type: CONSTANTS.MESSAGE_TYPES.CLEAR_WATCHED });
      if (res && res.success) {
        queue = res.queue;
        renderUI();
        showToast(`Cleared ${watchedVideos.length} watched videos`, async () => {
          await sendMessage({
            type: CONSTANTS.MESSAGE_TYPES.RESTORE_VIDEOS,
            videos: watchedVideos,
          });
          await loadData();
        });
      }
    });

    // Toggle Settings Panel
    const toggleSettingsBtn = document.getElementById('btn-toggle-settings');
    const settingsPanel = document.getElementById('settings-panel');
    toggleSettingsBtn.addEventListener('click', () => {
      settingsPanel.classList.toggle('hidden');
    });

    // Settings changes
    const thresholdSelect = document.getElementById('setting-threshold');
    thresholdSelect.addEventListener('change', async (e) => {
      const val = parseInt(e.target.value, 10);
      settings.watchedThreshold = val;
      await sendMessage({
        type: CONSTANTS.MESSAGE_TYPES.UPDATE_SETTINGS,
        settings: { watchedThreshold: val },
      });
      await loadData();
    });

    const expandedSelect = document.getElementById('setting-expanded');
    expandedSelect.addEventListener('change', async (e) => {
      const val = e.target.value === 'true';
      settings.shelfExpanded = val;
      await sendMessage({
        type: CONSTANTS.MESSAGE_TYPES.UPDATE_SETTINGS,
        settings: { shelfExpanded: val },
      });
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

  document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    await loadData();
  });
})();
