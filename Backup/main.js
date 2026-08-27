const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const FIXED_APP_FOLDER_NAME = 'GrandStayOtelYonetim';
const legacyDefaultUserDataPath = app.getPath('userData'); 
const fixedUserDataPath = path.join(app.getPath('appData'), FIXED_APP_FOLDER_NAME);
app.setPath('userData', fixedUserDataPath); 

function getUserDataDir() {
  return app.getPath('userData');
}

function getBackupsDir() {
  const dir = path.join(getUserDataDir(), 'yedekler');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDbFilePath() {
  return path.join(getUserDataDir(), 'grandstay-veritabani.json');
}

function migrateFromLegacyUserDataIfNeeded() {
  try {
    const newDbPath = getDbFilePath();
    const legacyDbPath = path.join(legacyDefaultUserDataPath, 'grandstay-veritabani.json');
    if (!fs.existsSync(newDbPath) && fs.existsSync(legacyDbPath) && legacyDefaultUserDataPath !== fixedUserDataPath) {
      if (!fs.existsSync(fixedUserDataPath)) fs.mkdirSync(fixedUserDataPath, { recursive: true });
      fs.copyFileSync(legacyDbPath, newDbPath);
    }
  } catch (e) {
    console.error('Taşıma hatası:', e);
  }
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 650,
    title: "Grand Stay - Otel Yönetim ve Resepsiyon Otomasyonu",
    backgroundColor: '#020617',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  migrateFromLegacyUserDataIfNeeded();
  createWindow();
  initAutoUpdater();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('gs-get-paths', (event) => {
  event.returnValue = {
    userDataPath: getUserDataDir(),
    dbFilePath: getDbFilePath(),
    backupsDirPath: getBackupsDir(),
    appVersion: app.getVersion()
  };
});

ipcMain.on('gs-open-backups-folder', () => {
  shell.openPath(getBackupsDir());
});

ipcMain.on('gs-open-userdata-folder', () => {
  shell.openPath(getUserDataDir());
});

// Manuel Güncelleme Kontrol Kanalı
ipcMain.on('gs-check-for-updates-manual', () => {
  autoUpdater.checkForUpdates().catch(err => {
    sendToRenderer('gs-update-error', err ? err.message : 'Bilinmeyen hata');
  });
});

const UPDATE_SERVER_URL = 'https://mesoftbilisim.net/grandstay-updates/';

function initAutoUpdater() {
  try {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: UPDATE_SERVER_URL
    });

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      sendToRenderer('gs-update-checking');
    });

    autoUpdater.on('update-available', (info) => {
      sendToRenderer('gs-update-available', info);
    });

    autoUpdater.on('update-not-available', () => {
      sendToRenderer('gs-update-not-available');
    });

    autoUpdater.on('download-progress', (progress) => {
      sendToRenderer('gs-update-progress', progress);
    });

    autoUpdater.on('update-downloaded', (info) => {
      sendToRenderer('gs-update-downloaded', info);
    });

    autoUpdater.on('error', (err) => {
      console.error('Güncelleme hatası detay:', err);
      sendToRenderer('gs-update-error', err ? err.message : 'Bilinmeyen hata');
    });

    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => {
        console.error('Açılış güncelleme kontrol hatası:', err);
      });
    }, 5000);
  } catch (e) {
    console.error('AutoUpdater başlatılamadı:', e);
  }
}

function sendToRenderer(channel, payload) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, payload);
  }
}

ipcMain.on('gs-install-update-now', () => {
  autoUpdater.quitAndInstall();
});