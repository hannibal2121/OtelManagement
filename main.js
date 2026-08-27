const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { autoUpdater } = require('electron-updater');
const sqlite3 = require('sqlite3').verbose();

const FIXED_APP_FOLDER_NAME = 'GrandStayOtelYonetim';
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
  return path.join(getUserDataDir(), 'grandstay.db');
}

let db = null;

function initDatabase() {
  const dbPath = getDbFilePath();
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('SQLite bağlantı hatası:', err.message);
    } else {
      console.log('SQLite veritabanı aktif:', dbPath);
      createTablesOnce();
    }
  });
}

// Tabloları YALNIZCA YAZILIM İLK KURULUMUNDA OLMAYIP YOKSA OLUŞTURUR (Veriler asla silinmez)
function createTablesOnce() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY,
      type TEXT,
      price REAL,
      status TEXT,
      guest TEXT,
      minibar TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS guests (
      key TEXT PRIMARY KEY,
      tc TEXT,
      name TEXT,
      phone TEXT,
      email TEXT,
      notes TEXT,
      visits INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      roomId INTEGER,
      primaryName TEXT,
      adultCount INTEGER,
      childCount INTEGER,
      allGuestsNames TEXT,
      tc TEXT,
      phone TEXT,
      checkIn TEXT,
      checkOut TEXT,
      totalPrice REAL,
      advancePayment REAL,
      remainingBalance REAL,
      status TEXT,
      minibarTotal REAL,
      collectedTotal REAL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`, () => {
      // Sadece veritabanı tamamen boşsa varsayılan config ve ilk odaları ekle
      db.get(`SELECT COUNT(*) as cnt FROM rooms`, (err, row) => {
        if (row && row.cnt === 0) {
          const defaultRooms = [
            { id: 101, type: "Standart Tek Kişilik", price: 800, status: "Boş", guest: null, minibar: [] },
            { id: 102, type: "Standart Çift Kişilik", price: 900, status: "Boş", guest: null, minibar: [] },
            { id: 103, type: "Standart Çift Kişilik", price: 900, status: "Boş", guest: null, minibar: [] },
            { id: 104, type: "Deluxe Deniz Manzaralı", price: 1200, status: "Boş", guest: null, minibar: [] },
            { id: 105, type: "Deluxe Deniz Manzaralı", price: 1200, status: "Boş", guest: null, minibar: [] },
            { id: 106, type: "Corner Suit", price: 1500, status: "Boş", guest: null, minibar: [] },
            { id: 107, type: "Standart Çift Kişilik", price: 900, status: "Boş", guest: null, minibar: [] },
            { id: 108, type: "Standart Çift Kişilik", price: 900, status: "Boş", guest: null, minibar: [] },
            { id: 109, type: "Deluxe Bahçe Manzaralı", price: 1100, status: "Boş", guest: null, minibar: [] },
            { id: 110, type: "Deluxe Bahçe Manzaralı", price: 1100, status: "Boş", guest: null, minibar: [] },
            { id: 111, type: "Kral Dairesi", price: 2500, status: "Boş", guest: null, minibar: [] },
            { id: 112, type: "Süit Oda", price: 1600, status: "Boş", guest: null, minibar: [] },
            { id: 113, type: "Süit Oda", price: 1600, status: "Boş", guest: null, minibar: [] },
            { id: 114, type: "Standart Çift Kişilik", price: 900, status: "Boş", guest: null, minibar: [] },
            { id: 115, type: "Standart Çift Kişilik", price: 900, status: "Boş", guest: null, minibar: [] },
            { id: 116, type: "Aile Süiti", price: 1300, status: "Boş", guest: null, minibar: [] },
            { id: 117, type: "Aile Süiti", price: 1300, status: "Boş", guest: null, minibar: [] }
          ];

          const roomStmt = db.prepare(`INSERT INTO rooms (id, type, price, status, guest, minibar) VALUES (?, ?, ?, ?, ?, ?)`);
          defaultRooms.forEach(r => roomStmt.run(r.id, r.type, r.price, r.status, null, JSON.stringify([])));
          roomStmt.finalize();
        }
      });

      db.get(`SELECT * FROM settings WHERE key = 'config'`, (err, row) => {
        if (!row) {
          const defaultSettings = {
            hotel_name: 'GRAND STAY',
            hotel_subtitle: 'Otel Yönetim Paneli',
            admin_username: 'admin',
            admin_password: '1234'
          };
          db.run(`INSERT INTO settings (key, value) VALUES ('config', ?)`, [JSON.stringify(defaultSettings)]);
        }
      });
    });
  });
}

function fetchDatabaseData(callback) {
  db.serialize(() => {
    let data = { rooms: [], guests: [], reservations: [], settings: {} };
    db.all(`SELECT * FROM rooms`, (err, rows) => {
      data.rooms = rows ? rows.map(r => ({ ...r, guest: r.guest ? JSON.parse(r.guest) : null, minibar: r.minibar ? JSON.parse(r.minibar) : [] })) : [];
      db.all(`SELECT * FROM guests`, (err, gRows) => {
        data.guests = gRows || [];
        db.all(`SELECT * FROM reservations`, (err, resRows) => {
          data.reservations = resRows || [];
          db.get(`SELECT value FROM settings WHERE key = 'config'`, (err, setRow) => {
            if (setRow && setRow.value) {
              try { data.settings = JSON.parse(setRow.value); } catch(e) {}
            }
            callback(data);
          });
        });
      });
    });
  });
}

function saveDatabaseData(payload, callback) {
  db.serialize(() => {
    db.run(`BEGIN TRANSACTION`);

    db.run(`DELETE FROM rooms`);
    const roomStmt = db.prepare(`INSERT INTO rooms (id, type, price, status, guest, minibar) VALUES (?, ?, ?, ?, ?, ?)`);
    (payload.rooms || []).forEach(r => {
      roomStmt.run(r.id, r.type, r.price, r.status, r.guest ? JSON.stringify(r.guest) : null, JSON.stringify(r.minibar || []));
    });
    roomStmt.finalize();

    db.run(`DELETE FROM guests`);
    const guestStmt = db.prepare(`INSERT INTO guests (key, tc, name, phone, email, notes, visits) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    (payload.guests || []).forEach(g => {
      guestStmt.run(g.key || g.tc || ('G-' + Math.random().toString(36).substr(2, 9)), g.tc || '', g.name, g.phone || '', g.email || '', g.notes || '', g.visits || 1);
    });
    guestStmt.finalize();

    db.run(`DELETE FROM reservations`);
    const resStmt = db.prepare(`INSERT INTO reservations (id, roomId, primaryName, adultCount, childCount, allGuestsNames, tc, phone, checkIn, checkOut, totalPrice, advancePayment, remainingBalance, status, minibarTotal, collectedTotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    (payload.reservations || []).forEach(r => {
      resStmt.run(r.id, r.roomId, r.primaryName, r.adultCount, r.childCount, r.allGuestsNames, r.tc, r.phone, r.checkIn, r.checkOut, r.totalPrice, r.advancePayment, r.remainingBalance, r.status, r.minibarTotal, r.collectedTotal);
    });
    resStmt.finalize();

    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('config', ?)`, [JSON.stringify(payload.settings || {})]);

    db.run(`COMMIT`, (err) => {
      if (err) {
        db.run(`ROLLBACK`);
        callback(false, err);
      } else {
        callback(true, null);
      }
    });
  });
}

function startHttpApiServer() {
  const httpServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;

    if (pathname === '/api/load' && req.method === 'GET') {
      fetchDatabaseData((data) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      });
      return;
    }

    if (pathname === '/api/save' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          saveDatabaseData(payload, (success, err) => {
            if (success) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
              sendToRenderer('db-updated-externally', payload);
            } else {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false }));
            }
          });
        } catch(e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Sayfa Bulunamadı');
      } else {
        let ext = path.extname(filePath);
        let contentType = 'text/html; charset=utf-8';
        if (ext === '.js') contentType = 'text/javascript';
        else if (ext === '.css') contentType = 'text/css';
        else if (ext === '.png') contentType = 'image/png';
        else if (ext === '.ico') contentType = 'image/x-icon';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
  });

  httpServer.listen(8080, '0.0.0.0', () => {
    console.log('Merkezi SQLite & Web Sunucusu 8080 portunda aktif.');
  });
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
  initDatabase();
  startHttpApiServer();
  createWindow();
  initAutoUpdater();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (db) db.close();
    app.quit();
  }
});

ipcMain.handle('db-load', async () => {
  return new Promise((resolve) => {
    fetchDatabaseData((data) => resolve(data));
  });
});

ipcMain.handle('db-save', async (event, payload) => {
  return new Promise((resolve, reject) => {
    saveDatabaseData(payload, (success, err) => {
      if (success) resolve(true);
      else reject(err);
    });
  });
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

ipcMain.on('gs-check-for-updates-manual', () => {
  autoUpdater.checkForUpdates().catch(err => {
    sendToRenderer('gs-update-error', err ? err.message : 'Bilinmeyen hata');
  });
});

const UPDATE_SERVER_URL = 'https://mesoftbilisim.net/grandstay-updates/';

function initAutoUpdater() {
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_SERVER_URL });
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => sendToRenderer('gs-update-available', info));
    autoUpdater.on('update-downloaded', (info) => sendToRenderer('gs-update-downloaded', info));
    autoUpdater.on('error', (err) => sendToRenderer('gs-update-error', err.message));

    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => console.error(err));
    }, 5000);
  } catch (e) {
    console.error('AutoUpdater hatası:', e);
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