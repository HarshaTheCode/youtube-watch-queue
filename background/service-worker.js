/**
 * YouTube Watch Queue - Background Service Worker (Manifest V3)
 * Handles storage operations, badge updates, and cross-tab synchronization.
 */

try {
  importScripts('/data/constants.js');
} catch (e1) {
  try {
    importScripts('../data/constants.js');
  } catch (e2) {
    console.warn('YTQ: Could not importScripts constants:', e2);
  }
}

const {
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  MESSAGE_TYPES,
} = (typeof YTQ_CONSTANTS !== 'undefined' ? YTQ_CONSTANTS : {
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
});

/**
 * Retrieve the current queue from chrome.storage.local
 * @returns {Promise<Array>}
 */
async function getQueue() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEYS.WATCH_QUEUE);
    return Array.isArray(data[STORAGE_KEYS.WATCH_QUEUE]) ? data[STORAGE_KEYS.WATCH_QUEUE] : [];
  } catch (e) {
    console.error('YTQ: getQueue error', e);
    return [];
  }
}

/**
 * Save queue and update badge
 * @param {Array} queue
 */
async function setQueue(queue) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.WATCH_QUEUE]: queue });
    await updateBadge(queue);
    notifyTabs({ type: MESSAGE_TYPES.QUEUE_UPDATED, queue });
  } catch (e) {
    console.error('YTQ: setQueue error', e);
  }
}

/**
 * Retrieve settings from chrome.storage.local
 * @returns {Promise<Object>}
 */
async function getSettings() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    return Object.assign({}, DEFAULT_SETTINGS, data[STORAGE_KEYS.SETTINGS] || {});
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Save settings
 * @param {Object} partial
 */
async function updateSettings(partial) {
  try {
    const current = await getSettings();
    const updated = Object.assign({}, current, partial);
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: updated });
    notifyTabs({ type: MESSAGE_TYPES.UPDATE_SETTINGS, settings: updated });
    return updated;
  } catch (e) {
    return { ...DEFAULT_SETTINGS, ...partial };
  }
}

/**
 * Update the extension action badge
 * @param {Array} queue
 */
async function updateBadge(queue) {
  try {
    const list = queue || (await getQueue());
    const count = list.length;
    const text = count > 0 ? String(count) : '';
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
  } catch (err) {
    // Ignore in non-action contexts
  }
}

/**
 * Broadcast message to all active YouTube tabs
 * @param {Object} message
 */
function notifyTabs(message) {
  try {
    chrome.tabs.query({ url: '*://*.youtube.com/*' }, (tabs) => {
      if (chrome.runtime.lastError || !tabs) return;
      tabs.forEach((tab) => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, message).catch(() => {});
        }
      });
    });
  } catch (e) {}
}

// Initial badge update on service worker launch
chrome.runtime.onInstalled.addListener(async () => {
  const queue = await getQueue();
  await updateBadge(queue);
});

chrome.runtime.onStartup.addListener(async () => {
  const queue = await getQueue();
  await updateBadge(queue);
});

// Main message dispatcher
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  (async () => {
    try {
      switch (message.type) {
        case MESSAGE_TYPES.GET_QUEUE: {
          const queue = await getQueue();
          sendResponse({ success: true, queue });
          break;
        }

        case MESSAGE_TYPES.ADD_VIDEO: {
          const video = message.video;
          if (!video || !video.id) {
            sendResponse({ success: false, error: 'Invalid video data' });
            return;
          }

          const queue = await getQueue();
          const existingIndex = queue.findIndex((v) => v.id === video.id);

          const settings = await getSettings();
          const threshold = settings.watchedThreshold || 90;
          const progress = typeof video.progress === 'number' ? video.progress : 0;

          const record = {
            id: video.id,
            title: (video.title || 'Untitled Video').slice(0, 150),
            channelName: video.channelName || 'Unknown Channel',
            thumbnailUrl: video.thumbnailUrl || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
            durationSeconds: typeof video.durationSeconds === 'number' ? video.durationSeconds : 0,
            durationFormatted: video.durationFormatted || '0:00',
            savedAt: video.savedAt || new Date().toISOString(),
            progress: progress,
            lastWatchedAt: video.lastWatchedAt || null,
            isWatched: progress >= threshold,
          };

          if (existingIndex >= 0) {
            queue[existingIndex] = {
              ...queue[existingIndex],
              ...record,
              savedAt: queue[existingIndex].savedAt,
            };
          } else {
            queue.unshift(record);
          }

          await setQueue(queue);
          sendResponse({ success: true, queue, video: record });
          break;
        }

        case MESSAGE_TYPES.REMOVE_VIDEO: {
          const videoId = message.videoId;
          if (!videoId) {
            sendResponse({ success: false, error: 'Video ID required' });
            return;
          }

          const queue = await getQueue();
          const target = queue.find((v) => v.id === videoId);
          const filtered = queue.filter((v) => v.id !== videoId);

          await setQueue(filtered);
          sendResponse({ success: true, queue: filtered, removed: target });
          break;
        }

        case MESSAGE_TYPES.UPDATE_PROGRESS: {
          const { videoId, progress, durationSeconds } = message;
          if (!videoId || typeof progress !== 'number') {
            sendResponse({ success: false, error: 'Invalid progress parameters' });
            return;
          }

          const queue = await getQueue();
          const index = queue.findIndex((v) => v.id === videoId);
          if (index === -1) {
            sendResponse({ success: true, ignored: true });
            return;
          }

          const settings = await getSettings();
          const threshold = settings.watchedThreshold || 90;
          const currentVideo = queue[index];

          const newProgress = Math.max(currentVideo.progress || 0, Math.min(100, Math.round(progress)));
          const isWatched = newProgress >= threshold;

          const updatedVideo = {
            ...currentVideo,
            progress: newProgress,
            lastWatchedAt: new Date().toISOString(),
            isWatched,
          };

          if (typeof durationSeconds === 'number' && durationSeconds > 0 && !currentVideo.durationSeconds) {
            updatedVideo.durationSeconds = durationSeconds;
          }

          queue[index] = updatedVideo;
          await setQueue(queue);
          sendResponse({ success: true, video: updatedVideo, queue });
          break;
        }

        case MESSAGE_TYPES.CLEAR_WATCHED: {
          const queue = await getQueue();
          const cleared = queue.filter((v) => v.isWatched);
          const remaining = queue.filter((v) => !v.isWatched);

          await setQueue(remaining);
          sendResponse({ success: true, queue: remaining, cleared });
          break;
        }

        case MESSAGE_TYPES.RESTORE_VIDEOS: {
          const toRestore = Array.isArray(message.videos) ? message.videos : [];
          if (toRestore.length === 0) {
            sendResponse({ success: true, queue: await getQueue() });
            return;
          }

          const queue = await getQueue();
          const existingIds = new Set(queue.map((v) => v.id));

          toRestore.forEach((item) => {
            if (!existingIds.has(item.id)) {
              queue.unshift(item);
              existingIds.add(item.id);
            }
          });

          await setQueue(queue);
          sendResponse({ success: true, queue });
          break;
        }

        case MESSAGE_TYPES.GET_SETTINGS: {
          const settings = await getSettings();
          sendResponse({ success: true, settings });
          break;
        }

        case MESSAGE_TYPES.UPDATE_SETTINGS: {
          const updated = await updateSettings(message.settings || {});
          sendResponse({ success: true, settings: updated });
          break;
        }

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
          break;
      }
    } catch (err) {
      console.error('YTQ Service Worker error:', err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true;
});
