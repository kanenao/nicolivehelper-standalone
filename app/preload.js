const { contextBridge, ipcRenderer } = require('electron');

let appVersion = '99.99.99';
try {
  appVersion = ipcRenderer.sendSync('get-app-version-sync') || '99.99.99';
} catch (e) {
  console.warn('[Preload] Failed to get app version synchronously:', e);
}

const storageChangeListeners = new Set();
ipcRenderer.on('storage-changed', (event, changes) => {
  for (const listener of storageChangeListeners) {
    try {
      listener(changes, 'local');
    } catch (err) {
      console.error('storage.onChanged error:', err);
    }
  }
});

const storageLocal = {
  get: async (keys) => {
    return await ipcRenderer.invoke('storage-get', keys);
  },
  set: async (items) => {
    return await ipcRenderer.invoke('storage-set', items);
  },
  remove: async (keys) => {
    return await ipcRenderer.invoke('storage-remove', keys);
  },
  clear: async () => {
    return await ipcRenderer.invoke('storage-clear');
  }
};

const browserApi = {
  management: {
    getSelf: async () => ({
      id: 'stsen-app',
      name: 'New NicoLive Helper',
      version: appVersion,
      installType: 'development',
      type: 'extension'
    })
  },
  windows: {
    getCurrent: async () => ({
      id: 1,
      left: window.screenX,
      top: window.screenY,
      width: window.outerWidth,
      height: window.outerHeight,
      focused: true
    }),
    update: async (id, info) => {
      if (info && (info.width || info.height)) {
        window.resizeTo(info.width || window.outerWidth, info.height || window.outerHeight);
      }
      return { id: 1 };
    },
    create: async (options) => {
      let subUrl = options.url || '';
      if (subUrl.startsWith('../')) {
        subUrl = subUrl.replace(/^\.\.\//, '');
      } else if (!subUrl.startsWith('main/')) {
        subUrl = 'main/' + subUrl;
      }

      await ipcRenderer.invoke('open-subwindow', {
        url: subUrl,
        width: options.width || 700,
        height: options.height || 500
      });
      return { id: 1 };
    },
    get: async () => ({ tabs: [] })
  },
  tabs: {
    create: async (options) => {
      if (options.url) {
        if (options.url.startsWith('http://') || options.url.startsWith('https://')) {
          ipcRenderer.invoke('open-external', options.url);
        } else {
          ipcRenderer.invoke('open-subwindow', { url: options.url });
        }
      }
      return { id: 1 };
    },
    query: async () => [],
    remove: async () => {}
  },
  downloads: {
    download: async (options) => {
      if (options.url) {
        const a = document.createElement('a');
        a.href = options.url;
        a.download = options.filename || 'download.txt';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 100);
      }
      return 1;
    }
  },
  notifications: {
    create: async (id, options) => {
      return id || '1';
    }
  },
  storage: {
    local: storageLocal,
    onChanged: {
      addListener: (cb) => {
        if (typeof cb === 'function') {
          storageChangeListeners.add(cb);
        }
      },
      removeListener: (cb) => {
        if (typeof cb === 'function') {
          storageChangeListeners.delete(cb);
        }
      },
      hasListener: (cb) => storageChangeListeners.has(cb)
    }
  },
  runtime: {
    getManifest: () => ({
      name: 'New NicoLive Helper',
      version: appVersion
    }),
    sendMessage: async (message) => {
      if (!message || !message.cmd) return null;
      switch (message.cmd) {
        case 'get-liveinfo':
          return await ipcRenderer.invoke('get-liveinfo', message.request_id);
        case 'open-nicolivehelper':
          return await ipcRenderer.invoke('open-main-window', message.request_id);
        default:
          return null;
      }
    },
    openOptionsPage: () => {
      ipcRenderer.invoke('open-subwindow', {
        url: 'options/options.html',
        width: 650,
        height: 700,
        title: 'New NicoLive Helper 設定'
      });
    },
    getURL: (p) => p,
    onMessage: {
      addListener: (cb) => {},
      removeListener: (cb) => {},
      hasListener: (cb) => false
    }
  },
  extension: {
    getURL: (p) => p
  },
  browserAction: {
    setBadgeText: () => {}
  }
};

const accountStatusCallbacks = new Set();
ipcRenderer.on('account-status-changed', (event, data) => {
  for (const cb of accountStatusCallbacks) {
    try {
      cb(data);
    } catch (e) {
      console.error(e);
    }
  }
});

const remoteHostActionCallbacks = new Set();
ipcRenderer.on('remote-host-execute-action', (event, data) => {
  for (const cb of remoteHostActionCallbacks) {
    try {
      cb(data);
    } catch (e) {
      console.error(e);
    }
  }
});

const stsenApi = {
  openNicoLiveCreate: (reuseId) => ipcRenderer.invoke('open-nicolive-create', reuseId || ''),
  openLoginWindow: () => ipcRenderer.invoke('open-login-window'),
  logout: () => ipcRenderer.invoke('logout'),
  setUserSession: (val) => ipcRenderer.invoke('set-user-session', val),
  getAccountStatus: () => ipcRenderer.invoke('get-account-status'),
  loadLive: (lvid) => ipcRenderer.invoke('load-live', lvid),
  detectCurrentLive: () => ipcRenderer.invoke('detect-current-live'),
  openConfigFolder: () => ipcRenderer.invoke('open-config-folder'),
  resetAllData: () => ipcRenderer.invoke('reset-all-data'),
  getVersion: () => appVersion,
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  showAboutDialog: () => ipcRenderer.invoke('show-about-dialog'),
  onAccountStatusChanged: (callback) => {
    if (typeof callback === 'function') {
      accountStatusCallbacks.add(callback);
    }
  },
  getCookiesForSync: () => ipcRenderer.invoke('get-cookies-for-sync'),
  sendRemoteHostStateUpdate: (state) => ipcRenderer.send('remote-host-state-update', state),
  sendRemoteHostBroadcastEvent: (type, data) => ipcRenderer.send('remote-host-broadcast-event', { type, data }),
  onRemoteHostExecuteAction: (callback) => {
    if (typeof callback === 'function') {
      remoteHostActionCallbacks.add(callback);
    }
  },
  sendRemoteActionResult: (actionId, data, error) => {
    return ipcRenderer.invoke(`remote-action-res:${actionId}`, { data, error });
  },
  getRemoteServerStatus: () => ipcRenderer.invoke('get-remote-server-status'),
  updateRemoteServerConfig: (config) => ipcRenderer.invoke('remote-server-update-config', config)
};

// 安全にメインワールドへ公開 (contextIsolation: true 対応)
try {
  contextBridge.exposeInMainWorld('stsen', stsenApi);
  console.log('[Preload] stsen exposed successfully');
} catch (e) {
  console.error('[Preload] Failed to expose stsen:', e);
}

try {
  contextBridge.exposeInMainWorld('browser', browserApi);
  console.log('[Preload] browser exposed successfully');
} catch (e) {
  console.error('[Preload] Failed to expose browser:', e);
}
