const { app, BrowserWindow, ipcMain, shell, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');
const WebSocket = require('ws');
const RemoteServer = require('./remoteServer');
const { autoUpdater } = require('electron-updater');

// コマンドライン引数 & 環境変数の解析
const argv = process.argv.slice(2);
function getArgVal(flag) {
  const idx = argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < argv.length) return argv[idx + 1];
  const eqArg = argv.find(a => a.startsWith(`${flag}=`));
  if (eqArg) return eqArg.split('=').slice(1).join('=');
  return null;
}
const isHeadlessArg = argv.includes('--headless') || process.env.STSEN_HEADLESS === '1';
const isHostArg = argv.includes('--host') || argv.includes('--remote-host') || process.env.STSEN_HOST_ENABLED === '1';
const customPort = getArgVal('--port') || process.env.STSEN_HOST_PORT;
const customPassword = getArgVal('--password') || process.env.STSEN_HOST_PASSWORD;

if (isHeadlessArg) {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('no-sandbox');
  console.log('[STSen] Running in HEADLESS mode.');
}
if (isHostArg) {
  console.log('[STSen] Remote host mode forced via flag/env.');
}

// Cloudflare Turnstile / ボット検出対策
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

// 多重起動の制御
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[STSen] Another instance is already running. Quitting.');
  app.quit();
}

// -------------------------------------------------------------
// AppData 専用ディレクトリの設定
// -------------------------------------------------------------
const CONFIG_DIR = path.join(app.getPath('appData'), 'nicolivehelper-standalone');
const PREV_CONFIG_DIR = path.join(app.getPath('appData'), 'STSen-NicoLiveHelper');
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  // 旧 STSen-NicoLiveHelper からのデータ移行
  if (fs.existsSync(PREV_CONFIG_DIR)) {
    try {
      const prevCookies = path.join(PREV_CONFIG_DIR, 'cookies.json');
      const prevStorage = path.join(PREV_CONFIG_DIR, 'storage.json');
      if (fs.existsSync(prevCookies)) fs.copyFileSync(prevCookies, path.join(CONFIG_DIR, 'cookies.json'));
      if (fs.existsSync(prevStorage)) fs.copyFileSync(prevStorage, path.join(CONFIG_DIR, 'storage.json'));
      console.log('[STSen] Migrated config from previous STSen-NicoLiveHelper directory.');
    } catch (e) {
      console.error('[STSen] Failed to migrate previous config:', e);
    }
  }
}
app.setPath('userData', CONFIG_DIR);
console.log('[STSen] Config & UserData directory:', CONFIG_DIR);

const COOKIE_FILE = path.join(CONFIG_DIR, 'cookies.json');
const STORAGE_FILE = path.join(CONFIG_DIR, 'storage.json');

// 既存の旧 cookies.json があれば新フォルダへ移行
const OLD_COOKIE_FILE = path.join(__dirname, 'cookies.json');
if (fs.existsSync(OLD_COOKIE_FILE) && !fs.existsSync(COOKIE_FILE)) {
  try {
    fs.copyFileSync(OLD_COOKIE_FILE, COOKIE_FILE);
    console.log('[STSen] Migrated old cookies.json to AppData directory.');
  } catch (e) {
    console.error('[STSen] Failed to migrate old cookies.json:', e);
  }
}

let mainWindow = null;
let latestLvid = '';
const subWindows = new Map();
let nicoCreateWindow = null;
const inAppNicoContents = new Set();
const liveProp = {};

let remoteServer = null;
let lastKnownState = {};

// メモリ上にキャッシュする Cookie リスト
let cachedCookies = [];

// -------------------------------------------------------------
// 設定ファイル (storage.json) の管理
// -------------------------------------------------------------
function loadStorageFile() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      return JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[STSen] Failed to read storage.json:', e);
  }
  return {};
}

function saveStorageFile(data) {
  try {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[STSen] Failed to write storage.json:', e);
  }
}

function broadcastStorageChange(changes) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('storage-changed', changes);
  }
  for (const [_, subWin] of subWindows) {
    if (subWin && !subWin.isDestroyed()) {
      subWin.webContents.send('storage-changed', changes);
    }
  }
}

// -------------------------------------------------------------
// ニコニコ Cookie のインポート & 永続化
// -------------------------------------------------------------
async function updateCookies(cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) return false;

  cachedCookies = cookies;

  let userSessionCount = 0;
  for (const c of cookies) {
    try {
      let domain = c.domain || '.nicovideo.jp';
      const cleanDomain = domain.startsWith('.') ? domain.substring(1) : domain;
      const url = `https://${cleanDomain}${c.path || '/'}`;
      const exp = c.expirationDate !== undefined ? c.expirationDate : (c.expires !== undefined ? c.expires : undefined);

      await session.defaultSession.cookies.set({
        url: url,
        name: c.name,
        value: c.value,
        domain: domain,
        path: c.path || '/',
        secure: c.secure !== undefined ? c.secure : true,
        httpOnly: c.httpOnly !== undefined ? c.httpOnly : false,
        expirationDate: exp
      });

      if (c.name === 'user_session' || c.name === 'user_session_secure') {
        userSessionCount++;
      }
    } catch (e) {
      console.warn(`[STSen] Failed to set cookie ${c.name}:`, e.message);
    }
  }

  try {
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2), 'utf-8');
    console.log(`[STSen] Saved ${cookies.length} cookies to ${COOKIE_FILE} (user_session found: ${userSessionCount})`);
  } catch (e) {
    console.error('[STSen] Failed to save cookies.json:', e);
  }

  return userSessionCount > 0;
}

// 保存済み Cookie の自動復元
async function restoreSavedCookies() {
  if (fs.existsSync(COOKIE_FILE)) {
    try {
      const data = fs.readFileSync(COOKIE_FILE, 'utf-8');
      const cookies = JSON.parse(data);
      console.log(`[STSen] Restoring ${cookies.length} saved cookies from ${COOKIE_FILE}...`);
      await updateCookies(cookies);
    } catch (e) {
      console.error('[STSen] Failed to restore saved cookies:', e);
    }
  } else {
    console.log('[STSen] No saved cookies.json found. Waiting for login or extension sync.');
  }
}

// -------------------------------------------------------------
// アカウント情報取得 & ログアウト処理
// -------------------------------------------------------------
async function getAccountStatus() {
  const cookies = await session.defaultSession.cookies.get({ domain: 'nicovideo.jp' });
  const userSession = cookies.find(c => (c.name === 'user_session' || c.name === 'user_session_secure') && c.value);
  const loggedIn = !!userSession;

  let userInfo = null;
  if (loggedIn) {
    try {
      const targetCookies = (cookies && cookies.length > 0) ? cookies : cachedCookies;
      const cookieHeader = targetCookies.map(c => `${c.name}=${c.value}`).join('; ');
      const res = await fetch('https://nvapi.nicovideo.jp/v1/users/me', {
        headers: {
          'X-Frontend-Id': '6',
          'X-Frontend-Version': '0',
          'Cookie': cookieHeader,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const json = await res.json();
        if (json.data && json.data.user) {
          userInfo = {
            id: json.data.user.id,
            nickname: json.data.user.nickname,
            iconUrl: json.data.user.icons && json.data.user.icons.small
          };
        }
      }
    } catch (e) {
      console.warn('[STSen:Account] Could not fetch user profile details:', e.message);
    }
  }

  return { loggedIn, user: userInfo };
}

function broadcastAccountStatus() {
  getAccountStatus().then(status => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('account-status-changed', status);
    }
    for (const [_, subWin] of subWindows) {
      if (subWin && !subWin.isDestroyed()) {
        subWin.webContents.send('account-status-changed', status);
      }
    }
  });
}

async function logout() {
  console.log('[STSen] Logging out...');
  try {
    const cookies = await session.defaultSession.cookies.get({ domain: 'nicovideo.jp' });

    // サーバー側のセッションも無効化リクエスト（可能な場合）
    const userSession = cookies.find(c => (c.name === 'user_session' || c.name === 'user_session_secure') && c.value);
    if (userSession) {
      try {
        const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        await fetch('https://account.nicovideo.jp/logout', {
          headers: {
            'Cookie': cookieHeader,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          signal: AbortSignal.timeout(3000)
        });
      } catch (e) {
        console.warn('[STSen:Logout] Remote logout request warning:', e.message);
      }
    }

    // Electron 内の Cookie を完全に消去
    for (const c of cookies) {
      try {
        let domain = c.domain || '.nicovideo.jp';
        const cleanDomain = domain.startsWith('.') ? domain.substring(1) : domain;
        await session.defaultSession.cookies.remove(`https://${cleanDomain}${c.path || '/'}`, c.name);
      } catch (e) {}
    }
    await session.defaultSession.clearStorageData({ storages: ['cookies'] });

    cachedCookies = [];
    if (fs.existsSync(COOKIE_FILE)) {
      try { fs.unlinkSync(COOKIE_FILE); } catch (e) {}
    }
    broadcastAccountStatus();
    console.log('[STSen] Logged out successfully.');
    return { success: true };
  } catch (e) {
    console.error('[STSen] Logout failed:', e);
    return { success: false, error: e.message };
  }
}

// -------------------------------------------------------------
// 配信情報の直接取得 (枠読み込み対応)
// -------------------------------------------------------------
async function fetchLiveInfoDirect(lvid) {
  const strId = String(lvid).trim();
  const idWithLv = strId.startsWith('lv') ? strId : `lv${strId}`;
  const idWithoutLv = strId.replace(/^lv/, '');

  if (liveProp[strId] || liveProp[idWithLv] || liveProp[idWithoutLv]) {
    return liveProp[strId] || liveProp[idWithLv] || liveProp[idWithoutLv];
  }

  console.log(`[STSen] Fetching liveinfo directly for: ${idWithLv}...`);
  try {
    const url = `https://live.nicovideo.jp/watch/${idWithLv}`;
    const cookies = await session.defaultSession.cookies.get({ domain: 'nicovideo.jp' });
    const targetCookies = (cookies && cookies.length > 0) ? cookies : cachedCookies;
    const cookieHeader = targetCookies.map(c => `${c.name}=${c.value}`).join('; ');
    const res = await fetch(url, {
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) {
      console.warn(`[STSen] Fetch live watch page returned HTTP ${res.status}`);
      return null;
    }
    const html = await res.text();
    const m = html.match(/id=["']embedded-data["'][^>]*data-props=["'](.*?)["']/s) ||
              html.match(/<script id=["']embedded-data["'][^>]*>(.*?)<\/script>/s);
    if (m) {
      const raw = m[1].includes('&quot;') ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&') : m[1];
      const liveinfo = JSON.parse(raw);
      latestLvid = idWithLv;
      liveProp[strId] = liveinfo;
      liveProp[idWithLv] = liveinfo;
      liveProp[idWithoutLv] = liveinfo;
      console.log(`[STSen] Successfully extracted liveinfo for ${idWithLv}: "${liveinfo.program ? liveinfo.program.title : ''}"`);
      return liveinfo;
    } else {
      console.warn('[STSen] Could not find embedded-data in watch page.');
    }
  } catch (err) {
    console.error(`[STSen] Error fetching liveinfo direct for ${idWithLv}:`, err);
  }
  return null;
}

// -------------------------------------------------------------
// ログイン中ユーザーの現在放送中または準備中の配信を自動検出
// -------------------------------------------------------------
async function fetchMyCurrentLiveInfo() {
  const account = await getAccountStatus();
  if (!account || !account.loggedIn || !account.user || !account.user.id) {
    console.log('[STSen] User is not logged in. Skipping auto-detect live.');
    return { success: false, reason: 'not_logged_in', message: 'ニコニコにログインしていません。\n右上の「🔑 ログイン」からログインしてください。' };
  }

  const userId = account.user.id;
  console.log(`[STSen] Checking active live for user ${userId} (${account.user.nickname})...`);
  try {
    const cookies = await session.defaultSession.cookies.get({ domain: 'nicovideo.jp' });
    const targetCookies = (cookies && cookies.length > 0) ? cookies : cachedCookies;
    const cookieHeader = targetCookies.map(c => `${c.name}=${c.value}`).join('; ');

    const url = `https://live.nicovideo.jp/watch/user/${userId}`;
    const res = await fetch(url, {
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!res.ok) {
      console.warn(`[STSen] Fetch user live page returned HTTP ${res.status}`);
      return { success: false, reason: 'http_error', status: res.status, message: `ユーザー配信ページの取得に失敗しました (HTTP ${res.status})` };
    }

    const html = await res.text();
    const m = html.match(/id=["']embedded-data["'][^>]*data-props=["'](.*?)["']/s) ||
              html.match(/<script id=["']embedded-data["'][^>]*>(.*?)<\/script>/s);
    if (m) {
      const raw = m[1].includes('&quot;') ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&') : m[1];
      const liveinfo = JSON.parse(raw);
      const prog = liveinfo.program;
      if (prog) {
        // ステータス判定:
        // ON_AIR: 放送中
        // RELEASED / RESERVED: 枠作成直後（準備中・未開始・予約）
        // OPEN: 開場中
        const isActive = prog.status === 'ON_AIR' || prog.status === 'RELEASED' || prog.status === 'RESERVED' || prog.status === 'OPEN';

        if (isActive) {
          let lvid = prog.nicoliveProgramId;
          if (!lvid && prog.watchPageUrl) {
            const matchLv = prog.watchPageUrl.match(/lv\d+/);
            if (matchLv) lvid = matchLv[0];
          }
          if (lvid) {
            console.log(`[STSen] Active live detected: ${lvid} (status: ${prog.status}) - "${prog.title}"`);
            latestLvid = lvid;
            liveProp[lvid] = liveinfo;
            liveProp[lvid.replace(/^lv/, '')] = liveinfo;
            return {
              success: true,
              lvid,
              status: prog.status,
              title: prog.title,
              liveinfo
            };
          }
        } else {
          console.log(`[STSen] Program found for user but status is '${prog.status}' (title: "${prog.title}")`);
          const statusText = prog.status === 'ENDED' ? '終了済み' : prog.status;
          return {
            success: false,
            reason: 'not_on_air',
            status: prog.status,
            title: prog.title,
            message: `現在放送中または準備中の配信はありません。\n直近の番組「${prog.title}」は${statusText}です。`
          };
        }
      }
    }
  } catch (err) {
    console.error('[STSen] Error detecting current live:', err);
    return { success: false, reason: 'error', error: err.message, message: '自動検出中にエラーが発生しました: ' + err.message };
  }
  return { success: false, reason: 'not_found', message: '現在放送中または準備中の配信枠が見つかりませんでした。\nニコニコ生放送で番組枠を開始または作成してから再度お試しください。' };
}

// -------------------------------------------------------------
// HTTP リクエストヘッダーのインターセプト（Cookie 強制注入）
// -------------------------------------------------------------
function setupRequestHeaderInterceptor() {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const urlStr = details.url;

    try {
      const parsedUrl = new URL(urlStr);

      // account.nicovideo.jp や Cloudflare 関連はヘッダーを一切変更せず素通し（ボット検知防止）
      if (
        parsedUrl.hostname === 'account.nicovideo.jp' ||
        parsedUrl.hostname.includes('cloudflare.com') ||
        parsedUrl.hostname.includes('challenges')
      ) {
        return callback({ requestHeaders: details.requestHeaders });
      }

      if (parsedUrl.hostname.endsWith('nicovideo.jp')) {
        // APIリクエストのみ Cookie を注入 (User-Agent は偽装・汚染しない)
        if (cachedCookies.length > 0) {
          const matchingCookies = cachedCookies.filter(c => {
            const cDomain = (c.domain || '').replace(/^\./, '');
            return parsedUrl.hostname.endsWith(cDomain);
          });

          if (matchingCookies.length > 0) {
            const cookieStr = matchingCookies.map(c => `${c.name}=${c.value}`).join('; ');
            details.requestHeaders['Cookie'] = cookieStr;
            if (urlStr.includes('nvapi') || urlStr.includes('api')) {
              console.log(`[STSen:HTTP] Injected ${matchingCookies.length} cookies into: ${parsedUrl.pathname}`);
            }
          }
        }
      }
    } catch (e) {}

    callback({ requestHeaders: details.requestHeaders });
  });

  // webSecurity: true 下で file:// からのニコニコ API 通信を可能にする CORS 補正
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = Object.assign({}, details.responseHeaders);
    try {
      const parsedUrl = new URL(details.url);
      if (
        parsedUrl.hostname.endsWith('nicovideo.jp') ||
        parsedUrl.hostname.endsWith('nimg.jp') ||
        parsedUrl.hostname.endsWith('dmc.nico')
      ) {
        responseHeaders['access-control-allow-origin'] = ['*'];
        responseHeaders['access-control-allow-headers'] = ['*'];
        responseHeaders['access-control-allow-methods'] = ['GET, POST, PUT, PATCH, DELETE, OPTIONS'];
        responseHeaders['access-control-allow-credentials'] = ['true'];
      }
    } catch (e) {}
    callback({ responseHeaders });
  });
}

function getWebPreferences() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    nodeIntegration: false,
    contextIsolation: true,
    webSecurity: true,
    session: session.defaultSession,
    webviewTag: true,
    allowRunningInsecureContent: false
  };
}

// -------------------------------------------------------------
// リモートホストサーバー（API & WebSocket）の初期化
// -------------------------------------------------------------
function initRemoteServer() {
  const storageData = loadStorageFile();
  const config = storageData.config || {};

  const enabled = isHostArg || config['remote-server-enabled'] === true || config['remote-server-enabled'] === 'true';
  const port = parseInt(customPort || config['remote-server-port'] || 18767, 10);
  const password = customPassword !== null && customPassword !== undefined ? customPassword : (config['remote-server-password'] || '');

  if (remoteServer) {
    remoteServer.updateConfig(port, password);
    if (!enabled && remoteServer.running) {
      remoteServer.stop();
    } else if (enabled && !remoteServer.running) {
      remoteServer.start();
    }
    return;
  }

  remoteServer = new RemoteServer({
    port: port,
    password: password,
    getState: () => lastKnownState,
    onAction: async (action, params) => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        throw new Error('Main window is not available');
      }
      return new Promise((resolve, reject) => {
        const actionId = `act_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const timeout = setTimeout(() => {
          ipcMain.removeHandler(`remote-action-res:${actionId}`);
          reject(new Error(`Action timeout: ${action}`));
        }, 15000);

        ipcMain.handleOnce(`remote-action-res:${actionId}`, (event, result) => {
          clearTimeout(timeout);
          if (result && result.error) {
            reject(new Error(result.error));
          } else {
            resolve(result ? result.data : null);
          }
        });

        mainWindow.webContents.send('remote-host-execute-action', { actionId, action, params });
      });
    },
    onSyncCookies: async (cookies) => {
      console.log(`[STSen:RemoteHost] Syncing ${cookies.length} cookies from remote client...`);
      const success = await updateCookies(cookies);
      broadcastAccountStatus();
      return { success, count: cookies.length };
    },
    onLogout: async () => {
      console.log('[STSen:RemoteHost] Logging out via remote client request...');
      return await logout();
    }
  });

  if (enabled) {
    remoteServer.start();
  }
}

// メインウィンドウ用の URL を生成（Windows のパス区切り対策）
function getMainWindowUrl(targetLvid) {
  const mainHtmlPath = path.join(__dirname, 'src', 'main', 'main.html');
  const fileUrlObj = url.pathToFileURL(mainHtmlPath);
  if (targetLvid) {
    fileUrlObj.search = `?lv=${targetLvid}`;
  }
  return fileUrlObj.href;
}

// ニコ生の番組作成画面をアプリ内ウィンドウで開く（既定セッションのCookieを共有）
async function openNicoLiveCreateWindow(reuseId = '') {
  const createUrl = new URL('https://live2.nicovideo.jp/create');
  if (reuseId && /^lv\d+$/.test(String(reuseId))) {
    createUrl.searchParams.set('reuse_id', String(reuseId));
  } else if (reuseId) {
    return { success: false, error: 'invalid_live_id' };
  }

  try {
    if (nicoCreateWindow && !nicoCreateWindow.isDestroyed()) {
      nicoCreateWindow.show();
      nicoCreateWindow.focus();
      if (nicoCreateWindow.webContents.getURL() !== createUrl.href) {
        await nicoCreateWindow.loadURL(createUrl.href);
      }
      return { success: true, reused: true, url: createUrl.href };
    }

    nicoCreateWindow = new BrowserWindow({
      width: 1040,
      height: 820,
      minWidth: 760,
      minHeight: 600,
      title: 'ニコ生 番組作成 - NicoLive Helper',
      icon: path.join(__dirname, 'src', 'icons', 'icon-96.png'),
      autoHideMenuBar: true,
      webPreferences: getWebPreferences()
    });
    const createContentsId = nicoCreateWindow.webContents.id;
    inAppNicoContents.add(createContentsId);
    nicoCreateWindow.on('closed', () => { nicoCreateWindow = null; });
    nicoCreateWindow.webContents.on('destroyed', () => {
      inAppNicoContents.delete(createContentsId);
    });
    nicoCreateWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) {
        console.error('[BroadcastCreate] Page load failed:', code, description, url);
      }
    });
    nicoCreateWindow.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const target = new URL(url);
        if (target.protocol === 'https:' && (target.hostname === 'nicovideo.jp' || target.hostname.endsWith('.nicovideo.jp'))) {
          return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: getWebPreferences(), autoHideMenuBar: true } };
        }
      } catch (e) {}
      shell.openExternal(url);
      return { action: 'deny' };
    });
    await nicoCreateWindow.loadURL(createUrl.href);
    nicoCreateWindow.show();
    return { success: true, reused: false, url: createUrl.href };
  } catch (error) {
    console.error('[BroadcastCreate] Failed to open create page:', error);
    if (nicoCreateWindow && !nicoCreateWindow.isDestroyed()) nicoCreateWindow.close();
    nicoCreateWindow = null;
    return { success: false, error: String(error && error.message || error) };
  }
}

// メインウィンドウの作成・表示
function createOrFocusMainWindow(lvid = '') {
  const targetLvid = lvid || latestLvid;

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!isHeadlessArg) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    if (targetLvid) {
      const targetUrl = getMainWindowUrl(targetLvid);
      console.log(`[STSen] Navigating existing window to: ${targetUrl}`);
      mainWindow.loadURL(targetUrl);
    }
    return mainWindow;
  }

  const targetUrl = getMainWindowUrl(targetLvid);

  console.log(`[STSen] Creating MainWindow with URL: ${targetUrl} (headless: ${isHeadlessArg})`);

  mainWindow = new BrowserWindow({
    width: 820,
    height: 640,
    minWidth: 600,
    minHeight: 400,
    show: !isHeadlessArg,
    title: `New NicoLive Helper (STSen) v${app.getVersion()}`,
    icon: path.join(__dirname, 'src', 'icons', 'icon-96.png'),
    webPreferences: getWebPreferences()
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levelStr = ['DEBUG', 'INFO', 'WARN', 'ERROR'][level] || 'LOG';
    const srcFile = sourceId ? sourceId.split('/').pop().split('\\').pop() : 'inline';
    console.log(`[Renderer:${levelStr}][${srcFile}:${line}] ${message}`);
  });

  const rendererStartupIssues = [];
  const reportRendererIssue = (message) => {
    const detail = String(message || 'Unknown renderer startup error');
    rendererStartupIssues.push(detail);
    console.error('[RendererStartup]', detail);
    if (mainWindow && !mainWindow.isDestroyed()) {
      const script = `(() => {
        let node = document.getElementById('nicolive-helper-diagnostic');
        if (!node) {
          node = document.createElement('div');
          node.id = 'nicolive-helper-diagnostic';
          node.style.cssText = 'position:fixed;right:6px;bottom:6px;z-index:2147483647;max-width:55vw;padding:6px 10px;border:1px solid #b45309;border-radius:4px;background:#fff7ed;color:#7c2d12;font:12px/1.4 sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:none;box-shadow:0 1px 5px #0004;';
          document.body.appendChild(node);
        }
        node.textContent = ${JSON.stringify('起動エラー: ' + detail)};
      })()`;
      mainWindow.webContents.executeJavaScript(script).catch((error) => {
        console.error('[RendererStartup] Could not display diagnostic:', error);
      });
    }
  };

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    reportRendererIssue('preload読み込み失敗 (' + preloadPath + '): ' + (error && error.stack ? error.stack : String(error)));
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) {
      reportRendererIssue('メイン画面読み込み失敗 (' + errorCode + '): ' + errorDescription + ' / ' + validatedURL);
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    reportRendererIssue('画面プロセスが終了しました: ' + JSON.stringify(details));
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log(`[STSen] MainWindow did-finish-load: ${mainWindow.webContents.getURL()}`);
    const issueList = rendererStartupIssues.slice();
    // 正常起動時は診断パネルを作らない。Electron側で検出した異常がある場合のみ表示する。
    if (issueList.length > 0) {
      const message = '起動エラー: ' + issueList.join(' | ');
      const script = `(() => {
        if (window.__nicoliveHelperDiag) {
          window.__nicoliveHelperDiag(${JSON.stringify(message)});
          return;
        }
        let node = document.getElementById('nicolive-helper-diagnostic');
        if (!node) {
          node = document.createElement('div');
          node.id = 'nicolive-helper-diagnostic';
          node.style.cssText = 'position:fixed;right:6px;bottom:6px;z-index:2147483647;max-width:55vw;padding:6px 10px;border:1px solid #b45309;border-radius:4px;background:#fff7ed;color:#7c2d12;font:12px/1.4 sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:none;box-shadow:0 1px 5px #0004;';
          document.body.appendChild(node);
        }
        node.textContent = ${JSON.stringify(message)};
      })()`;
      mainWindow.webContents.executeJavaScript(script).catch((error) => {
        console.error('[RendererStartup] Diagnostic injection failed:', error);
      });
    }
  });

  if (!app.isPackaged && !isHeadlessArg) { mainWindow.webContents.openDevTools({ mode: 'detach' }); }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: getWebPreferences(),
        autoHideMenuBar: true
      }
    };
  });

  mainWindow.loadURL(targetUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

// サブウィンドウの作成
function createSubWindow(subUrl, options = {}) {
  let targetPath;
  if (path.isAbsolute(subUrl)) {
    targetPath = subUrl;
  } else {
    targetPath = path.join(__dirname, 'src', subUrl);
  }

  const winId = subUrl.split('?')[0];

  if (subWindows.has(winId) && !subWindows.get(winId).isDestroyed()) {
    const existing = subWindows.get(winId);
    existing.show();
    existing.focus();
    return;
  }

  const subWin = new BrowserWindow({
    width: options.width || 700,
    height: options.height || 550,
    title: options.title || 'New NicoLive Helper',
    icon: path.join(__dirname, 'src', 'icons', 'icon-96.png'),
    webPreferences: getWebPreferences()
  });

  subWin.setMenuBarVisibility(false);

  subWin.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[SubWin:${winId}] ${message}`);
  });

  subWin.loadURL(`file://${targetPath}`);
  subWindows.set(winId, subWin);

  subWin.on('closed', () => {
    subWindows.delete(winId);
  });
}

// -------------------------------------------------------------

// -------------------------------------------------------------
// -------------------------------------------------------------
// Chromium 系実機ブラウザ（Edge, Chrome, Brave, Vivaldi, Opera 等）の自動検出
// -------------------------------------------------------------
function isChromiumExe(exePath) {
  if (!exePath) return false;
  const lower = path.basename(exePath).toLowerCase();
  return (
    lower === 'chrome.exe' ||
    lower === 'msedge.exe' ||
    lower === 'brave.exe' ||
    lower === 'vivaldi.exe' ||
    lower === 'launcher.exe' || // Opera
    lower === 'chromium.exe' ||
    lower === 'google-chrome' ||
    lower === 'google-chrome-stable' ||
    lower === 'microsoft-edge' ||
    lower === 'microsoft-edge-stable' ||
    lower === 'chromium' ||
    lower === 'brave' ||
    lower === 'vivaldi'
  );
}

function getChromiumBrowserPath() {
  if (process.platform === 'linux') {
    const linuxCandidates = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
      '/usr/bin/brave-browser',
      '/usr/bin/vivaldi-stable',
      '/snap/bin/chromium'
    ];
    for (const p of linuxCandidates) {
      if (fs.existsSync(p)) {
        console.log(`[STSen:Browser] Detected Linux Chromium browser: ${p}`);
        return p;
      }
    }
    return null;
  }

  if (process.platform === 'darwin') {
    const macCandidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
      '/Applications/Opera.app/Contents/MacOS/Opera'
    ];
    for (const p of macCandidates) {
      if (fs.existsSync(p)) {
        console.log(`[STSen:Browser] Detected macOS Chromium browser: ${p}`);
        return p;
      }
    }
    return null;
  }

  // Windows
  const { execSync } = require('child_process');

  // 1. Windows の「既定のブラウザ（Default Browser）」をレジストリから最優先で取得
  try {
    const progIdOut = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice" /v ProgId', {
      encoding: 'utf8',
      windowsHide: true
    });
    const progMatch = progIdOut.match(/ProgId\s+REG_SZ\s+([^\r\n]+)/);
    if (progMatch && progMatch[1]) {
      const progId = progMatch[1].trim();
      console.log(`[STSen:Browser] Windows default https handler ProgId: ${progId}`);

      const checkCmdReg = (rootKey) => {
        try {
          const cmdOut = execSync(`reg query "${rootKey}\\${progId}\\shell\\open\\command" /ve`, {
            encoding: 'utf8',
            windowsHide: true
          });
          const cmdMatch = cmdOut.match(/REG_SZ\s+([^\r\n]+)/);
          if (cmdMatch && cmdMatch[1]) {
            const rawCmd = cmdMatch[1].trim();
            const exeMatch = rawCmd.match(/^"([^"]+)"/) || rawCmd.match(/^([^\s]+)/);
            if (exeMatch && fs.existsSync(exeMatch[1])) {
              return exeMatch[1];
            }
          }
        } catch (e) {}
        return null;
      };

      const defaultBrowserExe = checkCmdReg('HKCU\\Software\\Classes') || checkCmdReg('HKLM\\SOFTWARE\\Classes') || checkCmdReg('HKCR');
      if (defaultBrowserExe && isChromiumExe(defaultBrowserExe)) {
        console.log(`[STSen:Browser] Using user's default browser (Chromium-based): ${defaultBrowserExe}`);
        return defaultBrowserExe;
      } else if (defaultBrowserExe) {
        console.log(`[STSen:Browser] Default browser is non-Chromium (${defaultBrowserExe}), falling back to detected Chromium browsers.`);
      }
    }
  } catch (err) {
    console.warn('[STSen:Browser] Could not detect default browser from registry:', err.message);
  }

  // 2. 既定ブラウザが非Chromiumまたは取得できなかった場合、インストールされているChromium系ブラウザを検索
  // ※Chrome, Edge, Brave, Vivaldi, Opera の順
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const candidates = [
    // Google Chrome（最優先フォールバック）
    path.join(programFiles, 'Google/Chrome/Application/chrome.exe'),
    path.join(programFilesX86, 'Google/Chrome/Application/chrome.exe'),
    path.join(localAppData, 'Google/Chrome/Application/chrome.exe'),

    // Microsoft Edge（Windows標準）
    path.join(programFilesX86, 'Microsoft/Edge/Application/msedge.exe'),
    path.join(programFiles, 'Microsoft/Edge/Application/msedge.exe'),
    path.join(localAppData, 'Microsoft/Edge/Application/msedge.exe'),

    // Brave
    path.join(programFiles, 'BraveSoftware/Brave-Browser/Application/brave.exe'),
    path.join(programFilesX86, 'BraveSoftware/Brave-Browser/Application/brave.exe'),
    path.join(localAppData, 'BraveSoftware/Brave-Browser/Application/brave.exe'),

    // Vivaldi
    path.join(localAppData, 'Vivaldi/Application/vivaldi.exe'),
    path.join(programFiles, 'Vivaldi/Application/vivaldi.exe'),

    // Opera / Opera GX
    path.join(localAppData, 'Programs/Opera/launcher.exe'),
    path.join(localAppData, 'Programs/Opera GX/launcher.exe'),
    path.join(programFiles, 'Opera/launcher.exe')
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      console.log(`[STSen:Browser] Detected Chromium browser by path: ${p}`);
      return p;
    }
  }

  // 3. レジストリ（App Paths）からの検索フォールバック (Windows)
  try {
    const regNames = ['chrome.exe', 'msedge.exe', 'brave.exe', 'vivaldi.exe'];
    for (const name of regNames) {
      for (const root of ['HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths']) {
        try {
          const out = execSync(`reg query "${root}\\${name}" /ve`, {
            encoding: 'utf8',
            windowsHide: true
          });
          const match = out.match(/REG_SZ\s+([^\r\n]+)/);
          if (match && fs.existsSync(match[1].trim())) {
            const found = match[1].trim();
            console.log(`[STSen:Browser] Detected Chromium browser from registry (${name}): ${found}`);
            return found;
          }
        } catch (e) {}
      }
    }
  } catch (err) {}

  return null;
}

let browserLoginProcess = null;
let browserCdpWs = null;
let browserLoginTimeout = null;

async function openBrowserLogin() {
  console.log('[STSen:BrowserLogin] openBrowserLogin() called');
  if (browserLoginProcess) {
    console.log('[STSen:BrowserLogin] Previous browser process detected. Restarting for fresh login attempt...');
    try { browserLoginProcess.kill(); } catch (e) {}
    browserLoginProcess = null;
    if (browserCdpWs) {
      try { browserCdpWs.close(); } catch (e) {}
      browserCdpWs = null;
    }
    if (browserLoginTimeout) {
      clearTimeout(browserLoginTimeout);
      browserLoginTimeout = null;
    }
  }

  const browserExe = getChromiumBrowserPath();
  if (!browserExe) {
    console.warn('[STSen:Browser] No Chromium-based browser found on system.');
    const result = await dialog.showMessageBox(mainWindow || null, {
      type: 'warning',
      buttons: ['Google Chrome をダウンロード', 'キャンセル'],
      defaultId: 0,
      cancelId: 1,
      title: 'ブラウザが見つかりません - New NicoLive Helper',
      message: 'ログインに必要なブラウザ（Google Chrome または Microsoft Edge 等）が見つかりませんでした。',
      detail: 'Cloudflare Turnstile等のセキュリティ認証を安全に通過してログインを完了するため、Google ChromeまたはMicrosoft Edge等のChromium系ブラウザが必要です。\n\nChrome公式ダウンロードページを開きますか？'
    });

    if (result.response === 0) {
      shell.openExternal('https://www.google.com/intl/ja/chrome/');
    }
    return;
  }

  const browserProfileDir = path.join(CONFIG_DIR, 'browser-profile');
  if (!fs.existsSync(browserProfileDir)) {
    fs.mkdirSync(browserProfileDir, { recursive: true });
  }

  // 固定ポートではなくランダムな動的ポートを使用（無認証CDPへの不正アクセス防止）
  const CDP_PORT = Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;
  const browserBaseName = path.basename(browserExe).toLowerCase();
  const isEdge = browserBaseName === 'msedge.exe';

  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${browserProfileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--window-size=650,800',
    '--app=https://account.nicovideo.jp/login?site=niconico'
  ];

  if (isEdge) {
    args.push('--disable-features=msEdgeSyncPrompt,msFirstRun');
  }

  console.log(`[STSen:BrowserLogin] Launching browser (${browserBaseName}): ${browserExe} on port ${CDP_PORT}`);
  const { spawn } = require('child_process');
  browserLoginProcess = spawn(browserExe, args);

  // 3分間のタイムアウト保護（放置された場合の自動終了）
  browserLoginTimeout = setTimeout(() => {
    if (browserLoginProcess) {
      console.log('[STSen:BrowserLogin] Login process timed out (3 minutes). Closing browser.');
      closeBrowserGracefully();
    }
  }, 180000);

  browserLoginProcess.on('error', (err) => {
    console.error('[STSen:BrowserLogin] Failed to start browser process:', err);
    browserLoginProcess = null;
    if (browserLoginTimeout) {
      clearTimeout(browserLoginTimeout);
      browserLoginTimeout = null;
    }
  });

  browserLoginProcess.on('exit', (code) => {
    console.log(`[STSen:BrowserLogin] Browser process exited with code: ${code}`);
    browserLoginProcess = null;
    if (browserLoginTimeout) {
      clearTimeout(browserLoginTimeout);
      browserLoginTimeout = null;
    }
    if (browserCdpWs) {
      try { browserCdpWs.close(); } catch (e) {}
      browserCdpWs = null;
    }
  });

  let attempts = 0;
  const maxAttempts = 40;
  const pollInterval = 500;

  const waitForCdp = async () => {
    if (!browserLoginProcess) return;

    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      if (res.ok) {
        const targets = await res.json();
        const pageTarget = targets.find(t => t.type === 'page' && t.url && t.url.includes('nicovideo.jp'))
          || targets.find(t => t.type === 'page' && !t.url.startsWith('edge://') && !t.url.startsWith('chrome://'));

        if (pageTarget && pageTarget.webSocketDebuggerUrl) {
          console.log(`[STSen:BrowserLogin] Found page target (${pageTarget.url}), connecting to CDP WebSocket...`);
          startCdpMonitoring(pageTarget.webSocketDebuggerUrl);
          return;
        }
      }
    } catch (e) {}

    attempts++;
    if (attempts < maxAttempts && browserLoginProcess) {
      setTimeout(waitForCdp, pollInterval);
    } else if (browserLoginProcess) {
      console.warn('[STSen:BrowserLogin] Timed out waiting for CDP port or login target.');
    }
  };

  setTimeout(waitForCdp, 600);
}

// 互換性維持のためのエイリアス
const openEdgeLogin = openBrowserLogin;

function closeBrowserGracefully() {
  if (!browserLoginProcess) return;

  console.log('[STSen:BrowserLogin] Requesting graceful browser shutdown via CDP (Browser.close)...');
  if (browserCdpWs && browserCdpWs.readyState === WebSocket.OPEN) {
    try {
      browserCdpWs.send(JSON.stringify({ id: 9999, method: 'Browser.close' }));
    } catch (e) {
      console.warn('[STSen:BrowserLogin] Failed to send Browser.close:', e.message);
    }
  }

  // 正常終了を待機。もし3秒経ってもプロセスが残っている場合はフォールバックとして強制終了
  setTimeout(() => {
    if (browserLoginProcess) {
      console.log('[STSen:BrowserLogin] Browser did not exit gracefully, fallback to terminate process.');
      try { browserLoginProcess.kill(); } catch (e) {}
      browserLoginProcess = null;
    }
  }, 3000);
}

function startCdpMonitoring(wsUrl) {
  if (browserCdpWs) {
    try { browserCdpWs.close(); } catch (e) {}
    browserCdpWs = null;
  }

  browserCdpWs = new WebSocket(wsUrl);

  let checkTimer = null;
  let msgId = 1;
  let loginCompleted = false;
  let sessionReady = false;

  browserCdpWs.on('open', () => {
    console.log('[STSen:BrowserLogin] Connected to CDP WebSocket! Preparing clean login session...');
    browserCdpWs.send(JSON.stringify({ id: msgId++, method: 'Network.enable' }));
    browserCdpWs.send(JSON.stringify({ id: msgId++, method: 'Page.enable' }));

    // 重要な処理：
    // ブラウザに保存されていた前回の「古いセッション（user_session）」のみを削除する。
    // ※ブラウザのパスワード保存（オートコンプリート）や二段階認証の端末記憶（nicosid等）はそのまま維持される！
    // これにより、「ログアウト後に再度ログイン画面を開いた際、前のアカウントで勝手にログイン完了してブラウザが閉じる」という事故を防止し、
    // 必ずログインフォームが表示され、ユーザーがID/PW確認（または別アカウントへの切り替え）を行えるようにする。
    const domainsToDelete = ['.nicovideo.jp', 'account.nicovideo.jp', 'nicovideo.jp'];
    for (const d of domainsToDelete) {
      browserCdpWs.send(JSON.stringify({
        id: msgId++,
        method: 'Network.deleteCookies',
        params: { name: 'user_session', domain: d }
      }));
      browserCdpWs.send(JSON.stringify({
        id: msgId++,
        method: 'Network.deleteCookies',
        params: { name: 'user_session_secure', domain: d }
      }));
    }

    // 古いセッション削除後に確実にログインフォームが表示されるようログインURLにリロード/遷移
    browserCdpWs.send(JSON.stringify({
      id: msgId++,
      method: 'Page.navigate',
      params: { url: 'https://account.nicovideo.jp/login?site=niconico' }
    }));

    // 古いセッション削除とページ遷移が完了するまで一時的に検知をガード（1秒）
    setTimeout(() => {
      sessionReady = true;
      console.log('[STSen:BrowserLogin] Ready for user authentication.');
    }, 1200);

    checkTimer = setInterval(() => {
      if (browserCdpWs && browserCdpWs.readyState === WebSocket.OPEN && !loginCompleted && sessionReady) {
        browserCdpWs.send(JSON.stringify({
          id: 100,
          method: 'Network.getAllCookies'
        }));
      }
    }, 1000);
  });

  browserCdpWs.on('message', async (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.id === 100 && data.result && Array.isArray(data.result.cookies) && !loginCompleted && sessionReady) {
        const cookies = data.result.cookies;
        const userSession = cookies.find(c => (c.name === 'user_session' || c.name === 'user_session_secure') && c.value);
        if (userSession) {
          loginCompleted = true;
          console.log('[STSen:BrowserLogin] user_session detected in browser! Saving session & persisting profile...');
          if (checkTimer) {
            clearInterval(checkTimer);
            checkTimer = null;
          }

          const nicoCookies = cookies.filter(c => c.domain && c.domain.includes('nicovideo.jp'));
          await updateCookies(nicoCookies.length > 0 ? nicoCookies : cookies);
          broadcastAccountStatus();

          // ユーザーにログイン成功を視覚的に通知するバナーをページ内に挿入
          try {
            if (browserCdpWs && browserCdpWs.readyState === WebSocket.OPEN) {
              browserCdpWs.send(JSON.stringify({
                id: msgId++,
                method: 'Runtime.evaluate',
                params: {
                  expression: `
                    (() => {
                      if (document.getElementById('stsen-login-banner')) return;
                      const banner = document.createElement('div');
                      banner.id = 'stsen-login-banner';
                      banner.style.position = 'fixed';
                      banner.style.top = '0';
                      banner.style.left = '0';
                      banner.style.right = '0';
                      banner.style.backgroundColor = '#10b981';
                      banner.style.color = '#ffffff';
                      banner.style.padding = '12px 20px';
                      banner.style.fontSize = '15px';
                      banner.style.fontWeight = 'bold';
                      banner.style.textAlign = 'center';
                      banner.style.zIndex = '2147483647';
                      banner.style.boxShadow = '0 3px 12px rgba(0,0,0,0.3)';
                      banner.innerText = '✓ ログインに成功しました！認証情報を保存し、ブラウザを終了しています...';
                      document.body.appendChild(banner);
                    })()
                  `
                }
              }));
            }
          } catch (e) {}

          // ブラウザが二段階認証情報やCookie、パスワード保存をディスクに安全にコミットできるよう猶予（2.5秒）を設けて正常終了
          setTimeout(() => {
            console.log('[STSen:BrowserLogin] Closing browser window gracefully after session persistence delay.');
            closeBrowserGracefully();
          }, 2500);
        }
      }
    } catch (e) {
      console.error('[STSen:BrowserLogin] Message parsing error:', e);
    }
  });

  browserCdpWs.on('close', () => {
    console.log('[STSen:BrowserLogin] CDP WebSocket closed.');
    if (checkTimer) {
      clearInterval(checkTimer);
      checkTimer = null;
    }
    browserCdpWs = null;
  });

  browserCdpWs.on('error', (err) => {
    console.error('[STSen:BrowserLogin] CDP WebSocket error:', err.message);
    if (checkTimer) {
      clearInterval(checkTimer);
      checkTimer = null;
    }
    browserCdpWs = null;
  });
}

// -------------------------------------------------------------
// アプリ内自動アップデート（Windows NSIS / GitHub Releases）
// -------------------------------------------------------------
let updateCheckTimer = null;
let updateDownloadedVersion = null;
let updateCheckInProgress = false;

function emitAppUpdateStatus(status, extra = {}) {
  const payload = Object.assign({ status, currentVersion: app.getVersion() }, extra);
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('app-update-status', payload);
  }
  console.log('[AutoUpdate]', payload);
}

async function checkForAppUpdates(manual = false) {
  if (!app.isPackaged || isHeadlessArg || isHostArg) {
    const result = { status: 'unsupported', message: '自動更新はインストーラー版のアプリ本体で利用できます。' };
    if (manual) emitAppUpdateStatus(result.status, result);
    return result;
  }
  if (updateCheckInProgress) return { status: 'checking' };
  updateCheckInProgress = true;
  try {
    emitAppUpdateStatus('checking');
    await autoUpdater.checkForUpdates();
    return { status: 'checking' };
  } catch (error) {
    emitAppUpdateStatus('error', { message: error && error.message ? error.message : String(error) });
    throw error;
  } finally {
    setTimeout(() => { updateCheckInProgress = false; }, 2000);
  }
}

function setupAutoUpdater() {
  if (!app.isPackaged || isHeadlessArg || isHostArg) {
    console.log('[AutoUpdate] Skipped (development / headless / host mode).');
    return;
  }

  try {
    autoUpdater.logger = console;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = true;

    autoUpdater.on('checking-for-update', () => emitAppUpdateStatus('checking'));
    autoUpdater.on('update-available', (info) => {
      emitAppUpdateStatus('available', { version: info.version, releaseName: info.releaseName || '' });
    });
    autoUpdater.on('update-not-available', (info) => {
      emitAppUpdateStatus('not-available', { version: info.version || app.getVersion() });
    });
    autoUpdater.on('download-progress', (progress) => {
      emitAppUpdateStatus('downloading', {
        percent: Math.max(0, Math.min(100, Math.round(progress.percent || 0))),
        transferred: progress.transferred || 0,
        total: progress.total || 0
      });
    });
    autoUpdater.on('update-downloaded', async (info) => {
      updateDownloadedVersion = info.version;
      emitAppUpdateStatus('downloaded', { version: info.version });
      try {
        const result = await dialog.showMessageBox(
          mainWindow && !mainWindow.isDestroyed() ? mainWindow : null,
          {
            type: 'info',
            title: 'アップデートの準備ができました',
            message: `NicoLive Helper v${info.version} のダウンロードが完了しました。`,
            detail: '今すぐ再起動して更新するか、後でアプリを終了したときに適用できます。',
            buttons: ['今すぐ再起動して更新', '後で'],
            defaultId: 0,
            cancelId: 1,
            noLink: true
          }
        );
        if (result.response === 0) autoUpdater.quitAndInstall(false, true);
      } catch (error) {
        console.error('[AutoUpdate] Update confirmation dialog failed:', error);
      }
    });
    autoUpdater.on('error', (error) => {
      emitAppUpdateStatus('error', { message: error && error.message ? error.message : String(error) });
    });

    setTimeout(() => checkForAppUpdates(false).catch(() => {}), 15000);
    updateCheckTimer = setInterval(() => checkForAppUpdates(false).catch(() => {}), 6 * 60 * 60 * 1000);
  } catch (error) {
    console.error('[AutoUpdate] Failed to initialize:', error);
    emitAppUpdateStatus('error', { message: error.message || String(error) });
  }
}

// IPC ハンドラー群
// -------------------------------------------------------------
// storage.local (storage.json) ハンドラー
ipcMain.handle('storage-get', (event, keys) => {
  const store = loadStorageFile();
  if (keys === null || keys === undefined) return store;
  if (typeof keys === 'string') keys = [keys];
  if (Array.isArray(keys)) {
    const res = {};
    for (const k of keys) {
      if (k in store) res[k] = store[k];
    }
    return res;
  }
  if (typeof keys === 'object') {
    const res = {};
    for (const k in keys) {
      res[k] = (k in store) ? store[k] : keys[k];
    }
    return res;
  }
  return store;
});

ipcMain.handle('storage-set', (event, items) => {
  const store = loadStorageFile();
  const changes = {};
  for (const [k, v] of Object.entries(items)) {
    const oldValue = store[k];
    store[k] = v;
    changes[k] = { oldValue, newValue: v };
  }
  saveStorageFile(store);
  broadcastStorageChange(changes);
  return true;
});

ipcMain.handle('storage-remove', (event, keys) => {
  const store = loadStorageFile();
  if (typeof keys === 'string') keys = [keys];
  for (const k of keys) {
    delete store[k];
  }
  saveStorageFile(store);
  return true;
});

ipcMain.handle('storage-clear', () => {
  saveStorageFile({});
  return true;
});

ipcMain.handle('open-config-folder', () => {
  shell.openPath(CONFIG_DIR);
});

ipcMain.handle('reset-all-data', async () => {
  const focusedWin = BrowserWindow.getFocusedWindow() || mainWindow;
  const result = await dialog.showMessageBox(focusedWin || null, {
    type: 'warning',
    title: 'アプリの完全初期化',
    message: 'すべての設定、ログイン情報、保存データを完全に初期化しますか？',
    detail: '以下のデータが完全に消去されます：\n・保存された設定（storage.json）\n・ログインセッション／Cookie（cookies.json）\n・過去の移行元データ（STSen-NicoLiveHelper）\n・ブラウザキャッシュおよびデータベース\n\n処理完了後、アプリケーションは自動的に終了します。この操作は取り消せません。',
    buttons: ['完全初期化してアプリを終了', 'キャンセル'],
    defaultId: 1,
    cancelId: 1
  });

  if (result.response !== 0) {
    return { cancelled: true };
  }

  console.log('[STSen:Reset] Starting full data reset...');

  try {
    // 1. サブウィンドウをすべて閉じる
    for (const [_, subWin] of subWindows) {
      if (subWin && !subWin.isDestroyed()) {
        try { subWin.destroy(); } catch (e) {}
      }
    }
    subWindows.clear();

    // 2. メモリ上キャッシュを破棄
    cachedCookies = [];
    lastKnownState = {};

    // 3. Chromium セッションデータを全クリア
    try {
      await session.defaultSession.clearStorageData();
      await session.defaultSession.clearCache();
      await session.defaultSession.clearAuthCache();
    } catch (e) {
      console.warn('[STSen:Reset] Failed to clear session data:', e.message);
    }

    // 4. 旧設定ディレクトリ (PREV_CONFIG_DIR) を完全削除
    if (fs.existsSync(PREV_CONFIG_DIR)) {
      try {
        fs.rmSync(PREV_CONFIG_DIR, { recursive: true, force: true });
        console.log('[STSen:Reset] Deleted PREV_CONFIG_DIR:', PREV_CONFIG_DIR);
      } catch (e) {
        console.error('[STSen:Reset] Failed to delete PREV_CONFIG_DIR:', e);
      }
    }

    // 5. 開発フォルダ内の旧 cookies.json があれば削除
    if (fs.existsSync(OLD_COOKIE_FILE)) {
      try {
        fs.unlinkSync(OLD_COOKIE_FILE);
        console.log('[STSen:Reset] Deleted old cookies.json in app directory.');
      } catch (e) {}
    }

    // 6. 設定ファイルおよびディレクトリ内データの削除
    if (fs.existsSync(COOKIE_FILE)) {
      try { fs.unlinkSync(COOKIE_FILE); } catch (e) {}
    }
    if (fs.existsSync(STORAGE_FILE)) {
      try { fs.unlinkSync(STORAGE_FILE); } catch (e) {}
    }

    const browserProfileDir = path.join(CONFIG_DIR, 'browser-profile');
    if (fs.existsSync(browserProfileDir)) {
      try { fs.rmSync(browserProfileDir, { recursive: true, force: true }); } catch (e) {}
    }

    // CONFIG_DIR 配下の全ファイルを可能な限り削除
    if (fs.existsSync(CONFIG_DIR)) {
      try {
        const entries = fs.readdirSync(CONFIG_DIR);
        for (const entry of entries) {
          const target = path.join(CONFIG_DIR, entry);
          try {
            fs.rmSync(target, { recursive: true, force: true });
          } catch (err) {
            console.warn(`[STSen:Reset] Note: could not remove locked item ${entry}:`, err.message);
          }
        }
      } catch (e) {}
    }

    // 7. 完了ダイアログの表示
    await dialog.showMessageBox({
      type: 'info',
      title: '初期化完了',
      message: 'すべての設定とデータを完全に消去しました。',
      detail: 'アプリケーションを終了します。次回起動時は初期状態で起動します。',
      buttons: ['OK']
    });

    console.log('[STSen:Reset] Reset complete. Exiting application now.');
    app.exit(0);
    return { success: true };
  } catch (err) {
    console.error('[STSen:Reset] Unexpected error during reset:', err);
    await dialog.showMessageBox({
      type: 'error',
      title: 'エラー',
      message: '完全初期化中にエラーが発生しました。',
      detail: err.message,
      buttons: ['OK']
    });
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-liveinfo', async (event, lvid) => {
  console.log(`[IPC:get-liveinfo] Requested for lvid: "${lvid}"`);
  const strId = String(lvid);
  const idWithLv = strId.startsWith('lv') ? strId : `lv${strId}`;
  const idWithoutLv = strId.replace(/^lv/, '');
  let info = liveProp[strId] || liveProp[idWithLv] || liveProp[idWithoutLv] || null;
  if (!info && strId && strId !== '0' && strId !== 'lv0') {
    info = await fetchLiveInfoDirect(idWithLv);
  }
  return info;
});

ipcMain.handle('get-all-liveinfo', () => liveProp);

ipcMain.handle('open-login-window', async () => {
  console.log('[STSen] IPC: open-login-window received. Starting browser login...');
  try {
    await openBrowserLogin();
    return { success: true };
  } catch (err) {
    console.error('[STSen] Error during openBrowserLogin():', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('logout', async () => {
  return await logout();
});


ipcMain.handle('set-user-session', async (event, sessionValue) => {
  const cleanVal = (sessionValue || '').trim();
  if (!cleanVal) return { success: false, error: 'セッション値が空です' };

  let token = cleanVal;
  const match = cleanVal.match(/user_session=([^;\s]+)/);
  if (match) {
    token = match[1];
  }

  console.log('[STSen] Manually setting user_session...');
  const cookieObj = {
    name: 'user_session',
    value: token,
    domain: '.nicovideo.jp',
    path: '/',
    secure: true,
    httpOnly: true,
    expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
  };

  await updateCookies([cookieObj]);
  broadcastAccountStatus();

  const status = await getAccountStatus();
  return {
    success: status.loggedIn,
    user: status.user
  };
});

ipcMain.handle('get-account-status', async () => {
  return await getAccountStatus();
});

ipcMain.handle('load-live', async (event, lvid) => {
  const strId = String(lvid).trim();
  if (!strId) return null;
  const idWithLv = strId.startsWith('lv') ? strId : `lv${strId}`;
  console.log(`[STSen] Manual load-live requested for: ${idWithLv}`);
  await fetchLiveInfoDirect(idWithLv);
  createOrFocusMainWindow(idWithLv);
});



ipcMain.handle('open-nicolive-create', (event, reuseId) => {
  return openNicoLiveCreateWindow(reuseId || '');
});

ipcMain.handle('open-subwindow', (event, { url, width, height, title }) => {
  createSubWindow(url, { width, height, title });
});

ipcMain.handle('open-main-window', (event, lvid) => {
  createOrFocusMainWindow(lvid);
});

ipcMain.handle('open-external', (event, url) => {
  shell.openExternal(url);
});

ipcMain.handle('detect-current-live', async () => {
  return await fetchMyCurrentLiveInfo();
});

ipcMain.handle('check-for-app-updates', async () => {
  try {
    return await checkForAppUpdates(true);
  } catch (error) {
    return { status: 'error', message: error.message || String(error) };
  }
});

ipcMain.handle('install-app-update', () => {
  if (!updateDownloadedVersion) return { success: false, message: '更新ファイルはまだ準備できていません。' };
  autoUpdater.quitAndInstall(false, true);
  return { success: true };
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.on('get-app-version-sync', (event) => {
  event.returnValue = app.getVersion();
});

ipcMain.handle('show-about-dialog', async () => {
  const version = app.getVersion();
  const focusedWin = BrowserWindow.getFocusedWindow() || mainWindow;
  await dialog.showMessageBox(focusedWin || null, {
    type: 'info',
    title: 'バージョン情報',
    message: `NicoLive Helper Standalone (STSen)`,
    detail: `バージョン: v${version}\nElectron: ${process.versions.electron}\nChromium: ${process.versions.chrome}\nNode.js: ${process.versions.node}\nUserData: ${CONFIG_DIR}`,
    buttons: ['OK']
  });
});

// -------------------------------------------------------------
// リモートホスト関連 IPC
// -------------------------------------------------------------
ipcMain.on('remote-host-state-update', (event, state) => {
  lastKnownState = Object.assign(lastKnownState, state);
  if (remoteServer) {
    remoteServer.broadcast('state-update', state);
  }
});

ipcMain.on('remote-host-broadcast-event', (event, { type, data }) => {
  if (remoteServer) {
    remoteServer.broadcast(type, data);
  }
});

ipcMain.handle('remote-server-update-config', async (event, { enabled, port, password }) => {
  const store = loadStorageFile();
  store.config = store.config || {};
  if (enabled !== undefined) store.config['remote-server-enabled'] = enabled;
  if (port !== undefined) store.config['remote-server-port'] = port;
  if (password !== undefined) store.config['remote-server-password'] = password;
  saveStorageFile(store);
  initRemoteServer();
  return {
    running: remoteServer ? remoteServer.running : false,
    port: remoteServer ? remoteServer.port : port,
    hasPassword: !!(remoteServer && remoteServer.password)
  };
});

ipcMain.handle('get-remote-server-status', async () => {
  return {
    running: remoteServer ? remoteServer.running : false,
    port: remoteServer ? remoteServer.port : 18767,
    hasPassword: !!(remoteServer && remoteServer.password)
  };
});

// クライアント側（操作側）がホストに同期するためのCookie取得
ipcMain.handle('get-cookies-for-sync', async () => {
  const cookies = await session.defaultSession.cookies.get({ domain: 'nicovideo.jp' });
  return cookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    expirationDate: c.expirationDate
  }));
});

// アプリ内のニコ生ページおよび放送画面 WebView では、ニコニコ関連ページの遷移をアプリ内に保持する。
function isAllowedNicoInAppUrl(rawUrl) {
  try {
    const target = new URL(rawUrl);
    return target.protocol === 'https:' &&
      (target.hostname === 'nicovideo.jp' || target.hostname.endsWith('.nicovideo.jp'));
  } catch (e) {
    return false;
  }
}

// 全 WebContents（メイン画面、アプリ内ニコ生ウィンドウ、放送画面 WebView）共通のリンクハンドラ
app.on('web-contents-created', (event, contents) => {
  const isEmbeddedNicoContents = () =>
    inAppNicoContents.has(contents.id) || contents.getType() === 'webview';

  contents.setWindowOpenHandler(({ url }) => {
    if (isEmbeddedNicoContents()) {
      if (isAllowedNicoInAppUrl(url)) {
        return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: getWebPreferences(), autoHideMenuBar: true } };
      }
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url);
      }
      return { action: 'deny' };
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      console.log(`[STSen] Opening external URL in default browser: ${url}`);
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: getWebPreferences(),
        autoHideMenuBar: true
      }
    };
  });

  // WebView / アプリ内ニコ生ページから開かれた子ウィンドウもアプリ内扱いにする。
  contents.on('did-create-window', (childWindow) => {
    if (!isEmbeddedNicoContents() || !childWindow || !childWindow.webContents) return;
    const childContents = childWindow.webContents;
    inAppNicoContents.add(childContents.id);
    childContents.once('destroyed', () => inAppNicoContents.delete(childContents.id));
    childWindow.once('closed', () => inAppNicoContents.delete(childContents.id));
  });

  contents.once('destroyed', () => inAppNicoContents.delete(contents.id));

  contents.on('will-navigate', (event, navigationUrl) => {
    if (isEmbeddedNicoContents()) {
      if (isAllowedNicoInAppUrl(navigationUrl)) return;
      event.preventDefault();
      if (navigationUrl.startsWith('http://') || navigationUrl.startsWith('https://')) {
        shell.openExternal(navigationUrl);
      }
      return;
    }
    if (navigationUrl.startsWith('http://') || navigationUrl.startsWith('https://')) {
      console.log(`[STSen] Intercepting navigation to external browser: ${navigationUrl}`);
      event.preventDefault();
      shell.openExternal(navigationUrl);
    }
  });
});

// 新規生成されるすべてのウィンドウでメニューバーを非表示
app.on('browser-window-created', (event, win) => {
  win.setMenuBarVisibility(false);
});

// アプリ起動フロー
app.whenReady().then(async () => {
  console.log('[STSen] App is ready.');

  setupRequestHeaderInterceptor();
  await restoreSavedCookies();

  initRemoteServer();

  // 起動時に最新の放送中の配信に自動接続する設定をチェック
  let initialLvid = '';
  const storageData = loadStorageFile();
  const config = storageData.config || {};
  const autoConnect = config['auto-connect-on-start'] !== false;
  if (autoConnect) {
    try {
      const detected = await fetchMyCurrentLiveInfo();
      if (detected && detected.lvid) {
        initialLvid = detected.lvid;
        console.log(`[STSen] Auto-connecting to current active live on startup: ${initialLvid}`);
      }
    } catch (e) {
      console.warn('[STSen] Failed to auto-detect live on startup:', e);
    }
  }

  createOrFocusMainWindow(initialLvid);
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createOrFocusMainWindow();
    }
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
