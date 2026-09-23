'use strict';
const { app, BrowserWindow, ipcMain, shell, Tray, Menu, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Server } = require('./server');

const PORT = parseInt(process.env.MESOFT_PORT || '8080', 10);
const APP_FOLDER = 'MesoftOtelYonetim';

let mainWindow = null, tray = null, server = null, backupTimer = null, isQuitting = false;
let autoUpdater = null;

// ---- tekil örnek ----
if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
}

app.setPath('userData', path.join(app.getPath('appData'), APP_FOLDER));
const userData = () => app.getPath('userData');
const dbPath = () => path.join(userData(), 'mesoft_otel.db');
const backupsDir = () => { const d = path.join(userData(), 'yedekler'); fs.mkdirSync(d, { recursive: true }); return d; };
const logFile = () => path.join(userData(), 'mesoft.log');

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => a instanceof Error ? a.stack : (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
  try { fs.appendFileSync(logFile(), line); } catch (_) {}
  console.log(line.trim());
}

function localIps() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const n of list) if (n.family === 'IPv4' && !n.internal) out.push({ name, address: n.address });
  return out.length ? out : [{ name: 'localhost', address: '127.0.0.1' }];
}

// ---- yedekleme: her gece 03:00 (dakika kontrolü yerine "günde bir kez" bayrağı) ----
function scheduleBackups() {
  let lastBackupDay = null;
  backupTimer = setInterval(async () => {
    const now = new Date();
    const day = now.toDateString();
    if (now.getHours() === 3 && lastBackupDay !== day && server) {
      lastBackupDay = day;
      try {
        const s = await server.db.getSettings();
        const file = await server.db.backup(backupsDir(), parseInt(s.backup_keep_days, 10) || 30);
        if (s.backup_extra_dir) { try { fs.mkdirSync(s.backup_extra_dir, { recursive: true }); fs.copyFileSync(file, path.join(s.backup_extra_dir, path.basename(file))); } catch (e) { log('Ek yedek klasörü hatası:', e.message); } }
        log('Otomatik yedek alındı:', file);
      } catch (e) { log('Yedek hatası:', e); }
    }
  }, 60 * 1000);
}

// ---- güncelleme ----
function setupUpdater() {
  if (!app.isPackaged) return;
  try {
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    const send = (ch, payload) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, payload); };
    autoUpdater.on('update-available', (info) => send('update:available', { version: info.version }));
    autoUpdater.on('update-not-available', () => send('update:not-available'));
    autoUpdater.on('download-progress', (p) => send('update:progress', { percent: p.percent }));
    autoUpdater.on('update-downloaded', (info) => send('update:downloaded', { version: info.version }));
    autoUpdater.on('error', (e) => { log('Updater:', e.message); send('update:error', e.message); });
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 15000);
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 3600 * 1000);
  } catch (e) { log('electron-updater yüklenemedi:', e.message); }
}

// ---- pencere & tepsi ----
function iconImage() {
  const p = path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  if (fs.existsSync(p)) return nativeImage.createFromPath(p);
  // 16x16 basit fallback ikon (amber kare) — build/icon.* eklenince kullanılmaz
  return nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJklEQVR42mP8z8DwnwEJMDEwMDBQIj7KwCgqPsrAKCo+ysAoKj4KAAB0iAn/hJ2C6QAAAABJRU5ErkJggg==');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360, height: 880, minWidth: 980, minHeight: 650,
    title: 'Mesoft Bilişim - Otel Yönetim Sistemi', backgroundColor: '#020617', icon: iconImage(),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    dialog.showMessageBox(mainWindow, {
      type: 'question', defaultId: 0, title: 'Otel Yönetim Sistemi',
      buttons: ['Arka Planda Çalışmaya Devam Et', 'Tamamen Kapat'],
      message: 'Sunucu arka planda çalışmaya devam etsin mi?',
      detail: 'Devam ederse diğer cihazlar (telefon/tablet) bağlanabilir ve uygulama sistem tepsisine küçülür.'
    }).then(({ response }) => {
      if (response === 0) { mainWindow.hide(); if (tray && process.platform === 'win32') tray.displayBalloon({ title: 'Mesoft Otel', content: 'Sunucu arka planda çalışıyor.' }); }
      else shutdown();
    });
  });
}

function createTray() {
  try {
    tray = new Tray(iconImage());
    tray.setToolTip('Mesoft Otel — Sunucu Aktif');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Paneli Göster', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { label: 'Tarayıcıda Aç', click: () => shell.openExternal(`http://127.0.0.1:${PORT}/`) },
      { type: 'separator' },
      { label: 'Yedek Klasörünü Aç', click: () => shell.openPath(backupsDir()) },
      { type: 'separator' },
      { label: 'Tamamen Çıkış (Sunucuyu Kapat)', click: shutdown }
    ]));
    tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  } catch (e) { log('Tray oluşturulamadı:', e.message); }
}

async function shutdown() {
  if (isQuitting) return;
  isQuitting = true;
  if (backupTimer) clearInterval(backupTimer);
  try { if (server) await server.stop(); } catch (e) { log('Kapanış hatası:', e); }
  app.quit();
}

// ---- IPC (preload üzerinden) ----
ipcMain.handle('app:info', () => ({ version: app.getVersion(), port: PORT, dbPath: dbPath(), backupsDir: backupsDir(), ips: localIps(), platform: process.platform, isPackaged: app.isPackaged }));
ipcMain.handle('app:openBackups', () => shell.openPath(backupsDir()));
ipcMain.handle('app:openExternal', (_e, url) => { if (/^https?:/.test(String(url))) shell.openExternal(url); });
ipcMain.handle('app:pickFolder', async () => { const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle('update:check', () => { if (!autoUpdater) return { available: false, reason: 'Geliştirme modunda güncelleme devre dışı' }; return autoUpdater.checkForUpdates().then(() => ({ ok: true })).catch(e => ({ ok: false, error: e.message })); });
ipcMain.handle('update:install', () => { if (autoUpdater) { isQuitting = true; autoUpdater.quitAndInstall(); } });

// ---- başlat ----
app.whenReady().then(async () => {
  try {
    server = new Server({ dbPath: dbPath(), staticDir: __dirname, port: PORT, host: '0.0.0.0', backupsDir: backupsDir(), log });
    await server.start();
  } catch (e) {
    log('Sunucu başlatılamadı:', e);
    dialog.showErrorBox('Sunucu Başlatılamadı', e.code === 'EADDRINUSE'
      ? `${PORT} portu başka bir uygulama tarafından kullanılıyor. Diğer uygulamayı kapatın veya MESOFT_PORT ortam değişkeni ile farklı port belirleyin.`
      : e.message);
    app.quit(); return;
  }
  createWindow();
  createTray();
  scheduleBackups();
  setupUpdater();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else if (mainWindow) mainWindow.show(); });
});

app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => { isQuitting = true; });
process.on('uncaughtException', (e) => log('uncaughtException:', e));
process.on('unhandledRejection', (e) => log('unhandledRejection:', e));
