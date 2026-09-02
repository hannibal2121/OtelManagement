const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { autoUpdater } = require('electron-updater');
const sqlite3 = require('sqlite3').verbose();

const FIXED_APP_FOLDER_NAME = 'MesoftOtelYonetim';
const fixedUserDataPath = path.join(app.getPath('appData'), FIXED_APP_FOLDER_NAME);
app.setPath('userData', fixedUserDataPath);

function getUserDataDir() { return app.getPath('userData'); }

function getBackupsDir() {
  const dir = path.join(getUserDataDir(), 'yedekler');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDbFilePath() {
  return path.join(getUserDataDir(), 'mesoft_otel.db');
}

// Gerçek yerel ağ IP adresini bulan fonksiyon
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

let db = null;

function initDatabase() {
  const dbPath = getDbFilePath();
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('SQLite bağlantı hatası:', err.message);
    } else {
      db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;', () => {
        console.log('SQLite veritabanı aktif (WAL Modu):', dbPath);
        createTablesAndSeed();
      });
    }
  });
}

function createTablesAndSeed() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS rooms (id INTEGER PRIMARY KEY, type TEXT, price REAL, status TEXT, guest TEXT, minibar TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS guests (key TEXT PRIMARY KEY, tc TEXT, name TEXT, phone TEXT, email TEXT, notes TEXT, visits INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, roomId INTEGER, primaryName TEXT, adultCount INTEGER, childCount INTEGER, allGuestsNames TEXT, tc TEXT, phone TEXT, checkIn TEXT, checkOut TEXT, totalPrice REAL, advancePayment REAL, remainingBalance REAL, status TEXT, minibarTotal REAL, collectedTotal REAL)`);
    db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`, () => {
      db.get(`SELECT COUNT(*) as cnt FROM rooms`, (err, row) => {
        if (row && row.cnt === 0) {
          const defaultRooms = [
            { id: 101, type: "Standart", price: 800, status: "Boş", guest: null, minibar: [] },
            { id: 102, type: "Standart", price: 900, status: "Boş", guest: null, minibar: [] },
            { id: 103, type: "Standart", price: 900, status: "Boş", guest: null, minibar: [] },
            { id: 104, type: "Deluxe", price: 1200, status: "Boş", guest: null, minibar: [] }
          ];
          const roomStmt = db.prepare(`INSERT INTO rooms (id, type, price, status, guest, minibar) VALUES (?, ?, ?, ?, ?, ?)`);
          defaultRooms.forEach(r => roomStmt.run(r.id, r.type, r.price, r.status, null, JSON.stringify([])));
          roomStmt.finalize();
        }
      });
      db.get(`SELECT * FROM settings WHERE key = 'config'`, (err, row) => {
        if (!row) {
          const defaultSettings = { hotel_name: 'MESOFT BİLİŞİM', hotel_subtitle: 'Otel Yönetim Sistemi', admin_username: 'admin', admin_password: '1234' };
          db.run(`INSERT INTO settings (key, value) VALUES ('config', ?)`, [JSON.stringify(defaultSettings)]);
        }
      });
    });
  });
}

function startDailyBackup() {
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 3 && now.getMinutes() === 0) {
      const dateStr = now.toISOString().split('T')[0];
      const backupDir = 'C:\\OTEL\\YEDEK';
      if (!fs.existsSync(backupDir)) {
        try { fs.mkdirSync(backupDir, { recursive: true }); } catch(e) {}
      }
      const backupFile = path.join(backupDir, `Mesoft_Yedek_${dateStr}.db`);
      if (!fs.existsSync(backupFile)) {
        try { fs.copyFileSync(getDbFilePath(), backupFile); } catch(e) {}
      }
    }
  }, 60000);
}

function fetchDatabaseData(callback) {
  if (!db) return callback({ rooms: [], guests: [], reservations: [], settings: {} });
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
  if (!db) return callback(false, new Error('DB not initialized'));
  db.serialize(() => {
    db.run(`BEGIN TRANSACTION`);
    db.run(`DELETE FROM rooms`);
    const roomStmt = db.prepare(`INSERT INTO rooms (id, type, price, status, guest, minibar) VALUES (?, ?, ?, ?, ?, ?)`);
    (payload.rooms || []).forEach(r => { roomStmt.run(r.id, r.type, r.price, r.status, r.guest ? JSON.stringify(r.guest) : null, JSON.stringify(r.minibar || [])); });
    roomStmt.finalize();

    db.run(`DELETE FROM guests`);
    const guestStmt = db.prepare(`INSERT INTO guests (key, tc, name, phone, email, notes, visits) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    (payload.guests || []).forEach(g => { guestStmt.run(g.key || g.tc || ('G-' + Math.random().toString(36).substr(2, 9)), g.tc || '', g.name, g.phone || '', g.email || '', g.notes || '', g.visits || 1); });
    guestStmt.finalize();

    db.run(`DELETE FROM reservations`);
    const resStmt = db.prepare(`INSERT INTO reservations (id, roomId, primaryName, adultCount, childCount, allGuestsNames, tc, phone, checkIn, checkOut, totalPrice, advancePayment, remainingBalance, status, minibarTotal, collectedTotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    (payload.reservations || []).forEach(r => { resStmt.run(r.id, r.roomId, r.primaryName, r.adultCount, r.childCount, r.allGuestsNames, r.tc, r.phone, r.checkIn, r.checkOut, r.totalPrice, r.advancePayment, r.remainingBalance, r.status, r.minibarTotal, r.collectedTotal); });
    resStmt.finalize();

    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('config', ?)`, [JSON.stringify(payload.settings || {})]);
    db.run(`COMMIT`, (err) => {
      if (err) { db.run(`ROLLBACK`); callback(false, err); } else { callback(true, null); }
    });
  });
}

function startHttpApiServer() {
  const httpServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;

    if (pathname === '/api/load' && req.method === 'GET') {
      fetchDatabaseData((data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); });
      return;
    }

    if (pathname === '/api/save' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          saveDatabaseData(payload, (success, err) => {
            if (success) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true })); } 
            else { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: err ? err.message : 'Unknown error' })); }
          });
        } catch(e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid JSON' })); }
      });
      return;
    }

    let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Sayfa Bulunamadı'); } 
      else { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(content); }
    });
  });
  httpServer.listen(8080, '0.0.0.0', () => { console.log('Merkezi SQLite & Web Sunucusu 8080 portunda aktif.'); });
}

let mainWindow = null;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360, height: 880, minWidth: 980, minHeight: 650, title: "Mesoft Bilişim - Otel Yönetim Sistemi", backgroundColor: '#020617',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');
  mainWindow.on('close', (event) => { if (!app.isQuiting) { event.preventDefault(); mainWindow.hide(); } });
}

app.whenReady().then(() => {
  initDatabase();
  startHttpApiServer();
  startDailyBackup();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {});
ipcMain.handle('db-load', async () => { return new Promise((resolve) => { fetchDatabaseData((data) => resolve(data)); }); });
ipcMain.handle('db-save', async (event, payload) => { return new Promise((resolve, reject) => { saveDatabaseData(payload, (success, err) => { if (success) resolve(true); else reject(err); }); }); });

ipcMain.on('gs-get-paths', (event) => { 
  event.returnValue = { 
    userDataPath: getUserDataDir(), 
    dbFilePath: getDbFilePath(), 
    backupsDirPath: getBackupsDir(), 
    appVersion: app.getVersion(),
    localIp: getLocalIpAddress()
  }; 
});

ipcMain.on('gs-open-backups-folder', () => { const backupDir = 'C:\\OTEL\\YEDEK'; if (!fs.existsSync(backupDir)) { try { fs.mkdirSync(backupDir, { recursive: true }); } catch(e) {} } shell.openPath(backupDir); });