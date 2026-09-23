'use strict';
/**
 * Mesoft Otel — Veritabanı Katmanı (v7)
 * - Promise tabanlı sqlite3 sarmalayıcı
 * - Şema oluşturma + v6 → v7 otomatik migrasyon
 * - scrypt ile şifre hashleme (harici bağımlılık yok)
 * - WAL-güvenli yedekleme (VACUUM INTO)
 * - Kayıt bazlı (delta) yazma, tam DB silme YOK
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sqlite3 = require('sqlite3');

const SCHEMA_VERSION = 7;

class Database {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.revision = 0;
  }

  // ---------- düşük seviye yardımcılar ----------
  run(sql, params = []) {
    return new Promise((res, rej) => {
      this.db.run(sql, params, function (err) { err ? rej(err) : res({ changes: this.changes, lastID: this.lastID }); });
    });
  }
  get(sql, params = []) {
    return new Promise((res, rej) => this.db.get(sql, params, (e, row) => e ? rej(e) : res(row)));
  }
  all(sql, params = []) {
    return new Promise((res, rej) => this.db.all(sql, params, (e, rows) => e ? rej(e) : res(rows || [])));
  }
  exec(sql) {
    return new Promise((res, rej) => this.db.exec(sql, (e) => e ? rej(e) : res()));
  }
  async transaction(fn) {
    await this.run('BEGIN IMMEDIATE');
    try {
      const out = await fn();
      await this.run('COMMIT');
      await this.bumpRevision();
      return out;
    } catch (e) {
      try { await this.run('ROLLBACK'); } catch (_) {}
      throw e;
    }
  }
  async bumpRevision() {
    this.revision++;
    await this.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('revision', ?)`, [String(this.revision)]);
  }

  // ---------- açılış ----------
  async open() {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    await new Promise((res, rej) => { this.db = new sqlite3.Database(this.dbPath, (e) => e ? rej(e) : res()); });
    await this.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 8000; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');
    await this.createSchema();
    await this.migrate();
    const rev = await this.get(`SELECT value FROM meta WHERE key='revision'`);
    this.revision = rev ? parseInt(rev.value, 10) || 0 : 0;
    await this.seedIfEmpty();
  }

  async createSchema() {
    await this.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        name TEXT,
        role TEXT NOT NULL DEFAULT 'receptionist',   -- admin | receptionist
        passHash TEXT NOT NULL,
        salt TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        type TEXT,
        price REAL DEFAULT 0,             -- baz fiyat (mod'a göre oda ya da kişi başı)
        extraPersonPrice REAL DEFAULT 0,  -- per_room modunda ek kişi ücreti
        capacity INTEGER DEFAULT 2,
        status TEXT DEFAULT 'Boş',        -- Boş | Dolu | Arızalı
        clean INTEGER DEFAULT 1,          -- 1 temiz, 0 kirli (housekeeping)
        floor TEXT,
        notes TEXT,
        updatedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS guests (
        key TEXT PRIMARY KEY,
        tc TEXT, name TEXT, phone TEXT, email TEXT,
        birthDate TEXT, nationality TEXT DEFAULT 'TC', gender TEXT,
        notes TEXT, visits INTEGER DEFAULT 1,
        updatedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY,
        roomId TEXT,
        primaryName TEXT, tc TEXT, phone TEXT,
        adultCount INTEGER DEFAULT 1, childCount INTEGER DEFAULT 0,
        allGuestsNames TEXT, guestsJson TEXT,
        checkIn TEXT, checkOut TEXT,
        totalPrice REAL DEFAULT 0,
        status TEXT DEFAULT 'Rezerve',   -- Rezerve | Dolu | Tamamlandı | İptal | No-Show
        notes TEXT, source TEXT DEFAULT 'Resepsiyon',
        createdBy TEXT, createdAt TEXT, updatedAt TEXT,
        checkedInAt TEXT, checkedOutAt TEXT,
        externalUid TEXT                 -- iCal senkron için
      );
      CREATE INDEX IF NOT EXISTS idx_res_room ON reservations(roomId, status);
      CREATE INDEX IF NOT EXISTS idx_res_dates ON reservations(checkIn, checkOut);

      CREATE TABLE IF NOT EXISTS minibar_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reservationId TEXT, roomId TEXT,
        name TEXT, price REAL, qty INTEGER DEFAULT 1,
        createdAt TEXT, createdBy TEXT
      );

      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reservationId TEXT, roomId TEXT,
        amount REAL NOT NULL,
        method TEXT DEFAULT 'Nakit',     -- Nakit | Kart | Havale | Diğer
        type TEXT DEFAULT 'Tahsilat',    -- Kapora | Tahsilat | İade
        note TEXT, createdAt TEXT, createdBy TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pay_res ON payments(reservationId);

      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT, user TEXT, action TEXT, detail TEXT
      );
    `);
  }

  async columnExists(table, col) {
    const cols = await this.all(`PRAGMA table_info(${table})`);
    return cols.some(c => c.name === col);
  }
  async addColumnIfMissing(table, col, def) {
    if (!(await this.columnExists(table, col))) await this.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }

  /** Kolon tipi INTEGER ise tabloyu verilen TEXT şemayla yeniden kurar (v6 uyumluluğu). */
  async rebuildIfIntegerColumn(table, col, createNewSql, copySql) {
    const cols = await this.all(`PRAGMA table_info(${table})`);
    const c = cols.find(x => x.name === col);
    if (!c || String(c.type).toUpperCase() !== 'INTEGER') return;
    await this.exec('PRAGMA foreign_keys = OFF');
    await this.run('BEGIN');
    try {
      await this.run(`DROP TABLE IF EXISTS ${table}_new`);
      await this.run(createNewSql);
      await this.run(copySql);
      await this.run(`DROP TABLE ${table}`);
      await this.run(`ALTER TABLE ${table}_new RENAME TO ${table}`);
      await this.run('COMMIT');
    } catch (e) { await this.run('ROLLBACK'); throw e; }
    await this.exec('PRAGMA foreign_keys = ON');
    if (table === 'reservations') { await this.run(`CREATE INDEX IF NOT EXISTS idx_res_room ON reservations(roomId, status)`); await this.run(`CREATE INDEX IF NOT EXISTS idx_res_dates ON reservations(checkIn, checkOut)`); }
  }

  /** v6 veritabanını v7 şemasına taşır. Tekrar çalıştırılması güvenlidir. */
  async migrate() {
    const row = await this.get(`SELECT value FROM meta WHERE key='schema_version'`);
    const current = row ? parseInt(row.value, 10) : 0;
    if (current >= SCHEMA_VERSION) return;

    // v6: rooms.id INTEGER / reservations.roomId INTEGER → TEXT (tip tutarsızlığını kökten çözer)
    await this.rebuildIfIntegerColumn('rooms', 'id', `CREATE TABLE rooms_new (id TEXT PRIMARY KEY, type TEXT, price REAL DEFAULT 0, extraPersonPrice REAL DEFAULT 0, capacity INTEGER DEFAULT 2, status TEXT DEFAULT 'Boş', clean INTEGER DEFAULT 1, floor TEXT, notes TEXT, updatedAt TEXT, guest TEXT, minibar TEXT)`,
      `INSERT INTO rooms_new (id, type, price, status, guest, minibar) SELECT CAST(id AS TEXT), type, price, status, guest, minibar FROM rooms`);
    await this.rebuildIfIntegerColumn('reservations', 'roomId', `CREATE TABLE reservations_new (id TEXT PRIMARY KEY, roomId TEXT, primaryName TEXT, tc TEXT, phone TEXT, adultCount INTEGER DEFAULT 1, childCount INTEGER DEFAULT 0, allGuestsNames TEXT, guestsJson TEXT, checkIn TEXT, checkOut TEXT, totalPrice REAL DEFAULT 0, status TEXT DEFAULT 'Rezerve', notes TEXT, source TEXT DEFAULT 'Resepsiyon', createdBy TEXT, createdAt TEXT, updatedAt TEXT, checkedInAt TEXT, checkedOutAt TEXT, externalUid TEXT, advancePayment REAL, collectedTotal REAL, minibarTotal REAL)`,
      `INSERT INTO reservations_new (id, roomId, primaryName, tc, phone, adultCount, childCount, allGuestsNames, checkIn, checkOut, totalPrice, status, advancePayment, collectedTotal, minibarTotal) SELECT id, CAST(roomId AS TEXT), primaryName, tc, phone, adultCount, childCount, allGuestsNames, checkIn, checkOut, totalPrice, status, advancePayment, collectedTotal, minibarTotal FROM reservations`);

    // v6 tablolarında eksik kolonlar
    for (const [c, d] of [['extraPersonPrice', 'REAL DEFAULT 0'], ['capacity', 'INTEGER DEFAULT 2'], ['clean', 'INTEGER DEFAULT 1'], ['floor', 'TEXT'], ['notes', 'TEXT'], ['updatedAt', 'TEXT']])
      await this.addColumnIfMissing('rooms', c, d);
    for (const [c, d] of [['birthDate', 'TEXT'], ['nationality', "TEXT DEFAULT 'TC'"], ['gender', 'TEXT'], ['updatedAt', 'TEXT']])
      await this.addColumnIfMissing('guests', c, d);
    for (const [c, d] of [['guestsJson', 'TEXT'], ['notes', 'TEXT'], ['source', "TEXT DEFAULT 'Resepsiyon'"], ['createdBy', 'TEXT'], ['createdAt', 'TEXT'], ['updatedAt', 'TEXT'], ['checkedInAt', 'TEXT'], ['checkedOutAt', 'TEXT'], ['externalUid', 'TEXT']])
      await this.addColumnIfMissing('reservations', c, d);

    const now = new Date().toISOString();

    // v6: settings.config içinde admin şifresi → users tablosu
    const cfgRow = await this.get(`SELECT value FROM settings WHERE key='config'`);
    if (cfgRow) {
      let cfg = {};
      try { cfg = JSON.parse(cfgRow.value) || {}; } catch (_) {}
      const userCount = (await this.get(`SELECT COUNT(*) c FROM users`)).c;
      if (userCount === 0 && cfg.admin_username) {
        const { hash, salt } = Database.hashPassword(String(cfg.admin_password || '1234'));
        await this.run(`INSERT INTO users (username, name, role, passHash, salt, active, createdAt) VALUES (?,?,?,?,?,1,?)`,
          [cfg.admin_username, 'Yönetici', 'admin', hash, salt, now]);
      }
      // config'i yeni anahtarlara ayır, şifreyi settings'ten kaldır
      for (const k of ['hotel_name', 'hotel_subtitle']) if (cfg[k]) await this.run(`INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)`, [k, String(cfg[k])]);
      await this.run(`DELETE FROM settings WHERE key='config'`);
    }

    // v6: reservations.advancePayment / collectedTotal / minibarTotal → payments & minibar_items
    if (await this.columnExists('reservations', 'advancePayment')) {
      const payCount = (await this.get(`SELECT COUNT(*) c FROM payments`)).c;
      if (payCount === 0) {
        const rezs = await this.all(`SELECT * FROM reservations`);
        for (const r of rezs) {
          const adv = parseFloat(r.advancePayment) || 0;
          const col = parseFloat(r.collectedTotal) || 0;
          if (adv > 0) await this.run(`INSERT INTO payments (reservationId, roomId, amount, method, type, note, createdAt, createdBy) VALUES (?,?,?,?,?,?,?,?)`,
            [r.id, String(r.roomId), adv, 'Nakit', 'Kapora', 'v6 migrasyon', r.checkIn || now, 'sistem']);
          if (r.status === 'Tamamlandı' && col > adv) await this.run(`INSERT INTO payments (reservationId, roomId, amount, method, type, note, createdAt, createdBy) VALUES (?,?,?,?,?,?,?,?)`,
            [r.id, String(r.roomId), col - adv, 'Nakit', 'Tahsilat', 'v6 migrasyon (çıkış tahsilatı)', r.checkOut || now, 'sistem']);
          const mb = parseFloat(r.minibarTotal) || 0;
          if (mb > 0 && r.status === 'Tamamlandı') await this.run(`INSERT INTO minibar_items (reservationId, roomId, name, price, qty, createdAt, createdBy) VALUES (?,?,?,?,?,?,?)`,
            [r.id, String(r.roomId), 'Minibar (v6 toplam)', mb, 1, r.checkOut || now, 'sistem']);
        }
      }
    }
    // v6: rooms.minibar JSON (aktif odalar) → minibar_items
    if (await this.columnExists('rooms', 'minibar')) {
      const rooms = await this.all(`SELECT id, minibar FROM rooms WHERE minibar IS NOT NULL AND minibar != '[]'`);
      for (const rm of rooms) {
        let items = [];
        try { items = JSON.parse(rm.minibar) || []; } catch (_) {}
        const active = await this.get(`SELECT id FROM reservations WHERE roomId=? AND status='Dolu' ORDER BY checkIn DESC LIMIT 1`, [String(rm.id)]);
        if (!active) continue;
        const exists = (await this.get(`SELECT COUNT(*) c FROM minibar_items WHERE reservationId=?`, [active.id])).c;
        if (exists > 0) continue;
        for (const it of items) await this.run(`INSERT INTO minibar_items (reservationId, roomId, name, price, qty, createdAt, createdBy) VALUES (?,?,?,?,?,?,?)`,
          [active.id, String(rm.id), it.name || 'Ürün', parseFloat(it.price) || 0, 1, now, 'sistem']);
      }
    }
    // roomId'leri TEXT'e normalize et
    await this.run(`UPDATE reservations SET roomId = CAST(roomId AS TEXT)`);
    await this.run(`UPDATE rooms SET updatedAt = COALESCE(updatedAt, ?)`, [now]);

    await this.run(`INSERT OR REPLACE INTO meta (key,value) VALUES ('schema_version', ?)`, [String(SCHEMA_VERSION)]);
    await this.audit('sistem', 'migrasyon', `v${current} → v${SCHEMA_VERSION}`);
  }

  async seedIfEmpty() {
    const now = new Date().toISOString();
    const users = (await this.get(`SELECT COUNT(*) c FROM users`)).c;
    if (users === 0) {
      const { hash, salt } = Database.hashPassword('1234');
      await this.run(`INSERT INTO users (username, name, role, passHash, salt, active, createdAt) VALUES ('admin','Yönetici','admin',?,?,1,?)`, [hash, salt, now]);
      await this.run(`INSERT OR REPLACE INTO settings (key,value) VALUES ('force_password_change','1')`);
    }
    const rooms = (await this.get(`SELECT COUNT(*) c FROM rooms`)).c;
    if (rooms === 0) {
      for (const r of [['101', 'Standart', 1600, 500], ['102', 'Standart', 1800, 500], ['103', 'Standart', 1800, 500], ['104', 'Deluxe', 2400, 700]])
        await this.run(`INSERT INTO rooms (id,type,price,extraPersonPrice,capacity,status,clean,updatedAt) VALUES (?,?,?,?,2,'Boş',1,?)`, [...r, now]);
    }
    const defaults = {
      hotel_name: 'MESOFT BİLİŞİM', hotel_subtitle: 'Otel Yönetim Sistemi',
      hotel_address: '', hotel_phone: '', hotel_tax_no: '',
      pricing_mode: 'per_room',      // per_room | per_person
      child_factor: '0.5', weekend_multiplier: '1', weekend_days: '5,6',
      seasons: '[]',                 // [{name,start:"MM-DD",end:"MM-DD",multiplier}]
      checkout_hour: '12:00', currency: '₺',
      backup_keep_days: '30', backup_extra_dir: '',
      allow_overbooking: '0'
    };
    for (const [k, v] of Object.entries(defaults)) await this.run(`INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)`, [k, v]);
  }

  // ---------- şifre ----------
  static hashPassword(password, salt) {
    salt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return { hash, salt };
  }
  static verifyPassword(password, hash, salt) {
    const { hash: h } = Database.hashPassword(password, salt);
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
  }

  // ---------- denetim ----------
  audit(user, action, detail) {
    return this.run(`INSERT INTO audit_log (ts,user,action,detail) VALUES (?,?,?,?)`, [new Date().toISOString(), user || '-', action, typeof detail === 'string' ? detail : JSON.stringify(detail || {})]);
  }

  // ---------- okuma ----------
  async getSettings() {
    const rows = await this.all(`SELECT key, value FROM settings`);
    const o = {};
    for (const r of rows) o[r.key] = r.value;
    return o;
  }

  /** Tüm uygulama durumu: rezervasyonlara ödeme/minibar özetleri eklenir. */
  async getState() {
    const [rooms, guests, reservations, payments, minibar, settings] = await Promise.all([
      this.all(`SELECT * FROM rooms ORDER BY CAST(id AS INTEGER), id`),
      this.all(`SELECT * FROM guests ORDER BY name`),
      this.all(`SELECT * FROM reservations ORDER BY createdAt`),
      this.all(`SELECT * FROM payments ORDER BY createdAt`),
      this.all(`SELECT * FROM minibar_items ORDER BY createdAt`),
      this.getSettings()
    ]);
    const paySum = {}, mbSum = {};
    for (const p of payments) paySum[p.reservationId] = (paySum[p.reservationId] || 0) + (p.type === 'İade' ? -p.amount : p.amount);
    for (const m of minibar) mbSum[m.reservationId] = (mbSum[m.reservationId] || 0) + m.price * (m.qty || 1);
    for (const r of reservations) {
      r.collectedTotal = +(paySum[r.id] || 0).toFixed(2);
      r.minibarTotal = +(mbSum[r.id] || 0).toFixed(2);
      r.grandTotal = +((parseFloat(r.totalPrice) || 0) + r.minibarTotal).toFixed(2);
      r.remainingBalance = +Math.max(0, r.grandTotal - r.collectedTotal).toFixed(2);
      try { r.guests = r.guestsJson ? JSON.parse(r.guestsJson) : []; } catch (_) { r.guests = []; }
      delete r.guestsJson;
    }
    return { rooms, guests, reservations, payments, minibar, settings, revision: this.revision };
  }

  // ---------- yedekleme ----------
  /** WAL-güvenli, tutarlı yedek. Hedef klasöre tarihli dosya yazar; eskileri temizler. */
  async backup(dir, keepDays = 30, prefix = 'Mesoft_Yedek') {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const target = path.join(dir, `${prefix}_${stamp}.db`);
    if (fs.existsSync(target)) fs.unlinkSync(target);
    await this.run(`VACUUM INTO ?`, [target]);
    // eski yedekleri sil
    const cutoff = Date.now() - keepDays * 86400000;
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith(prefix) || !f.endsWith('.db')) continue;
      const p = path.join(dir, f);
      try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch (_) {}
    }
    return target;
  }

  close() {
    return new Promise((res) => { if (!this.db) return res(); this.db.close(() => res()); });
  }
}

module.exports = { Database, SCHEMA_VERSION };
