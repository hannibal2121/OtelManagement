'use strict';
/**
 * Mesoft Otel — HTTP API & Statik Sunucu (v7)
 * Electron'dan bağımsızdır; `server-standalone.js` ile tek başına da çalışır.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Database } = require('./db');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject' };
const SESSION_TTL_MS = 12 * 3600 * 1000;
const ACTIVE = ['Rezerve', 'Dolu']; // takvimde yer tutan durumlar

class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }

const todayStr = () => localDate(new Date());
function localDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function addDays(dateStr, n) { const [y, m, d] = dateStr.split('-').map(Number); return localDate(new Date(y, m - 1, d + n)); }
function nightsBetween(a, b) { const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number); return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000); }
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const clean = (s, max = 200) => String(s == null ? '' : s).trim().slice(0, max);
const num = (v, def = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : def; };
const genId = (p) => `${p}-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

class Server {
  constructor({ dbPath, staticDir, port = 8080, host = '0.0.0.0', backupsDir, log = console.log }) {
    this.db = new Database(dbPath);
    this.staticDir = staticDir;
    this.port = port; this.host = host;
    this.backupsDir = backupsDir;
    this.log = log;
    this.sessions = new Map();      // token → {user, exp}
    this.loginAttempts = new Map(); // ip → {count, until}
    this.server = null;
  }

  async start() {
    await this.db.open();
    this.server = http.createServer((req, res) => this.handle(req, res).catch(e => this.sendError(res, e)));
    await new Promise((res, rej) => { this.server.once('error', rej); this.server.listen(this.port, this.host, res); });
    this.log(`[server] http://${this.host}:${this.port} aktif — DB: ${this.db.dbPath}`);
    this.gc = setInterval(() => { const now = Date.now(); for (const [t, s] of this.sessions) if (s.exp < now) this.sessions.delete(t); }, 60000);
  }
  async stop() {
    clearInterval(this.gc);
    if (this.server) await new Promise(r => this.server.close(() => r()));
    await this.db.close();
  }

  // ---------- yardımcılar ----------
  sendJson(res, status, obj) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
  sendError(res, e) {
    const status = e instanceof ApiError ? e.status : 500;
    if (status === 500) this.log('[server] HATA:', e);
    this.sendJson(res, status, { error: e.message || 'Sunucu hatası' });
  }
  readBody(req, limit = 5 * 1024 * 1024) {
    return new Promise((res, rej) => {
      let size = 0, chunks = [];
      req.on('data', c => { size += c.length; if (size > limit) { rej(new ApiError(413, 'İstek çok büyük')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { if (!chunks.length) return res({}); try { res(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (_) { rej(new ApiError(400, 'Geçersiz JSON')); } });
      req.on('error', rej);
    });
  }
  auth(req, role) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    const s = token && this.sessions.get(token);
    if (!s || s.exp < Date.now()) throw new ApiError(401, 'Oturum geçersiz, lütfen tekrar giriş yapın');
    s.exp = Date.now() + SESSION_TTL_MS;
    if (role === 'admin' && s.user.role !== 'admin') throw new ApiError(403, 'Bu işlem için yönetici yetkisi gerekir');
    return s.user;
  }
  clientIp(req) { return (req.socket && req.socket.remoteAddress) || 'unknown'; }

  // ---------- fiyatlandırma ----------
  async quote({ roomId, checkIn, checkOut, adultCount = 1, childCount = 0 }) {
    const room = await this.db.get(`SELECT * FROM rooms WHERE id=?`, [String(roomId)]);
    if (!room) throw new ApiError(404, 'Oda bulunamadı');
    if (!isDate(checkIn) || !isDate(checkOut)) throw new ApiError(400, 'Geçersiz tarih');
    const nights = nightsBetween(checkIn, checkOut);
    if (nights < 1) throw new ApiError(400, 'Çıkış tarihi giriş tarihinden sonra olmalıdır');
    const s = await this.db.getSettings();
    const mode = s.pricing_mode || 'per_room';
    const childFactor = num(s.child_factor, 0.5);
    const weekendMult = num(s.weekend_multiplier, 1);
    const weekendDays = String(s.weekend_days || '5,6').split(',').map(x => parseInt(x, 10)).filter(x => !isNaN(x));
    let seasons = []; try { seasons = JSON.parse(s.seasons || '[]'); } catch (_) {}
    const base = num(room.price), extra = num(room.extraPersonPrice);
    const adults = Math.max(1, parseInt(adultCount, 10) || 1), children = Math.max(0, parseInt(childCount, 10) || 0);

    let total = 0; const breakdown = [];
    for (let i = 0; i < nights; i++) {
      const dStr = addDays(checkIn, i);
      const [y, m, d] = dStr.split('-').map(Number);
      const dow = new Date(y, m - 1, d).getDay();
      let nightly = mode === 'per_person' ? base * (adults + children * childFactor) : base + Math.max(0, adults - (room.capacity || 2)) * extra + children * childFactor * extra;
      let mult = 1;
      if (weekendDays.includes(dow)) mult *= weekendMult;
      const mmdd = dStr.slice(5);
      for (const se of seasons) { if (se && se.start && se.end && ((se.start <= se.end && mmdd >= se.start && mmdd <= se.end) || (se.start > se.end && (mmdd >= se.start || mmdd <= se.end)))) mult *= num(se.multiplier, 1); }
      nightly = Math.round(nightly * mult);
      total += nightly; breakdown.push({ date: dStr, price: nightly });
    }
    return { nights, total, breakdown, mode, room: { id: room.id, type: room.type, price: base, capacity: room.capacity } };
  }

  async checkConflict(roomId, checkIn, checkOut, excludeId) {
    const s = await this.db.getSettings();
    if (s.allow_overbooking === '1') return null;
    return this.db.get(`SELECT id, primaryName, checkIn, checkOut FROM reservations WHERE roomId=? AND status IN ('Rezerve','Dolu') AND id != ? AND checkIn < ? AND checkOut > ? LIMIT 1`,
      [String(roomId), excludeId || '', checkOut, checkIn]);
  }

  /** Odanın Dolu/Boş durumunu aktif rezervasyona göre eşitler (Arızalı dokunulmaz). */
  async syncRoomStatus(roomId) {
    const room = await this.db.get(`SELECT status FROM rooms WHERE id=?`, [String(roomId)]);
    if (!room || room.status === 'Arızalı') return;
    const active = await this.db.get(`SELECT id FROM reservations WHERE roomId=? AND status='Dolu' LIMIT 1`, [String(roomId)]);
    await this.db.run(`UPDATE rooms SET status=?, updatedAt=? WHERE id=?`, [active ? 'Dolu' : 'Boş', new Date().toISOString(), String(roomId)]);
  }

  async upsertGuests(list, notes, user) {
    const now = new Date().toISOString();
    for (const g of list) {
      if (!g.name) continue;
      let ex = null;
      if (g.tc) ex = await this.db.get(`SELECT * FROM guests WHERE tc=?`, [g.tc]);
      if (!ex && g.phone) ex = await this.db.get(`SELECT * FROM guests WHERE lower(name)=lower(?) AND phone=?`, [g.name, g.phone]);
      if (ex) {
        await this.db.run(`UPDATE guests SET name=?, tc=COALESCE(NULLIF(?,''),tc), phone=COALESCE(NULLIF(?,''),phone), email=COALESCE(NULLIF(?,''),email), birthDate=COALESCE(NULLIF(?,''),birthDate), nationality=COALESCE(NULLIF(?,''),nationality), visits=COALESCE(visits,0)+1, updatedAt=? WHERE key=?`,
          [g.name, g.tc || '', g.phone || '', g.email || '', g.birthDate || '', g.nationality || '', now, ex.key]);
      } else {
        await this.db.run(`INSERT INTO guests (key,tc,name,phone,email,birthDate,nationality,notes,visits,updatedAt) VALUES (?,?,?,?,?,?,?,?,1,?)`,
          [genId('G'), g.tc || '', g.name, g.phone || '', g.email || '', g.birthDate || '', g.nationality || 'TC', notes || '', now]);
      }
    }
  }

  // ---------- yönlendirme ----------
  async handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname, m = req.method;

    if (m === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' }); return res.end(); }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (!p.startsWith('/api/')) return this.serveStatic(p, res);
    const seg = p.slice(5).split('/').filter(Boolean); // ['reservations', 'REZ-..', 'checkin']
    // 'me' altındaki alt yollar (me/password) id değildir
    const route = seg[0] === 'me' ? `${m} /me${seg[1] ? '/' + seg[1] : ''}` : `${m} /${seg[0]}${seg[1] ? '/:id' : ''}${seg[2] ? '/' + seg[2] : ''}`;
    const id = seg[1] ? decodeURIComponent(seg[1]) : null;
    const db = this.db;
    const now = () => new Date().toISOString();

    switch (route) {
      // ---- genel ----
      case 'GET /health': return this.sendJson(res, 200, { ok: true, revision: db.revision, time: now() });
      case 'GET /revision': return this.sendJson(res, 200, { revision: db.revision });

      // ---- kimlik ----
      case 'POST /login': {
        const ip = this.clientIp(req);
        const att = this.loginAttempts.get(ip);
        if (att && att.until > Date.now()) throw new ApiError(429, `Çok fazla hatalı deneme. ${Math.ceil((att.until - Date.now()) / 1000)} sn bekleyin`);
        const { username, password } = await this.readBody(req);
        const u = await db.get(`SELECT * FROM users WHERE username=? AND active=1`, [clean(username, 50)]);
        if (!u || !Database.verifyPassword(String(password || ''), u.passHash, u.salt)) {
          const a = att || { count: 0, until: 0 }; a.count++;
          if (a.count >= 5) { a.until = Date.now() + 60000; a.count = 0; }
          this.loginAttempts.set(ip, a);
          await db.audit(clean(username, 50), 'giriş_hatalı', ip);
          throw new ApiError(401, 'Kullanıcı adı veya şifre hatalı');
        }
        this.loginAttempts.delete(ip);
        const token = crypto.randomBytes(32).toString('hex');
        const user = { id: u.id, username: u.username, name: u.name, role: u.role };
        this.sessions.set(token, { user, exp: Date.now() + SESSION_TTL_MS });
        const s = await db.getSettings();
        await db.audit(u.username, 'giriş', ip);
        return this.sendJson(res, 200, { token, user, forcePasswordChange: s.force_password_change === '1' && u.role === 'admin' });
      }
      case 'POST /logout': { const h = req.headers.authorization || ''; this.sessions.delete(h.slice(7)); return this.sendJson(res, 200, { ok: true }); }
      case 'GET /me': return this.sendJson(res, 200, { user: this.auth(req) });
      case 'POST /me/password': {
        const user = this.auth(req);
        const { current, next } = await this.readBody(req);
        const u = await db.get(`SELECT * FROM users WHERE id=?`, [user.id]);
        if (!Database.verifyPassword(String(current || ''), u.passHash, u.salt)) throw new ApiError(400, 'Mevcut şifre hatalı');
        if (String(next || '').length < 4) throw new ApiError(400, 'Yeni şifre en az 4 karakter olmalı');
        const { hash, salt } = Database.hashPassword(next);
        await db.transaction(async () => { await db.run(`UPDATE users SET passHash=?, salt=? WHERE id=?`, [hash, salt, u.id]); await db.run(`INSERT OR REPLACE INTO settings (key,value) VALUES ('force_password_change','0')`); });
        await db.audit(user.username, 'şifre_değişti', '');
        return this.sendJson(res, 200, { ok: true });
      }

      // ---- durum ----
      case 'GET /state': {
        const user = this.auth(req);
        const state = await db.getState();
        if (user.role === 'admin') state.users = await db.all(`SELECT id, username, name, role, active, createdAt FROM users ORDER BY id`);
        state.me = user;
        return this.sendJson(res, 200, state);
      }
      case 'POST /quote': { this.auth(req); return this.sendJson(res, 200, await this.quote(await this.readBody(req))); }

      // ---- odalar ----
      case 'POST /rooms': {
        const user = this.auth(req, 'admin');
        const b = await this.readBody(req);
        const rid = clean(b.id, 20);
        if (!rid || !clean(b.type)) throw new ApiError(400, 'Oda numarası ve tipi zorunlu');
        if (await db.get(`SELECT id FROM rooms WHERE id=?`, [rid])) throw new ApiError(409, `${rid} numaralı oda zaten var`);
        await db.transaction(() => db.run(`INSERT INTO rooms (id,type,price,extraPersonPrice,capacity,status,clean,floor,notes,updatedAt) VALUES (?,?,?,?,?,'Boş',1,?,?,?)`,
          [rid, clean(b.type, 60), num(b.price), num(b.extraPersonPrice), Math.max(1, parseInt(b.capacity, 10) || 2), clean(b.floor, 20), clean(b.notes, 500), now()]));
        await db.audit(user.username, 'oda_ekle', rid);
        return this.sendJson(res, 200, { ok: true });
      }
      case 'PUT /rooms/:id': {
        const user = this.auth(req, 'admin');
        const b = await this.readBody(req);
        const room = await db.get(`SELECT * FROM rooms WHERE id=?`, [id]);
        if (!room) throw new ApiError(404, 'Oda bulunamadı');
        const newId = clean(b.id || id, 20);
        if (newId !== id && await db.get(`SELECT id FROM rooms WHERE id=?`, [newId])) throw new ApiError(409, `${newId} numaralı oda zaten var`);
        await db.transaction(async () => {
          await db.run(`UPDATE rooms SET id=?, type=?, price=?, extraPersonPrice=?, capacity=?, floor=?, notes=?, updatedAt=? WHERE id=?`,
            [newId, clean(b.type ?? room.type, 60), num(b.price ?? room.price), num(b.extraPersonPrice ?? room.extraPersonPrice), Math.max(1, parseInt(b.capacity ?? room.capacity, 10) || 2), clean(b.floor ?? room.floor, 20), clean(b.notes ?? room.notes, 500), now(), id]);
          if (newId !== id) { await db.run(`UPDATE reservations SET roomId=? WHERE roomId=?`, [newId, id]); await db.run(`UPDATE payments SET roomId=? WHERE roomId=?`, [newId, id]); await db.run(`UPDATE minibar_items SET roomId=? WHERE roomId=?`, [newId, id]); }
        });
        await db.audit(user.username, 'oda_güncelle', { id, newId });
        return this.sendJson(res, 200, { ok: true });
      }
      case 'DELETE /rooms/:id': {
        const user = this.auth(req, 'admin');
        const active = await db.get(`SELECT id FROM reservations WHERE roomId=? AND status IN ('Rezerve','Dolu') LIMIT 1`, [id]);
        if (active) throw new ApiError(409, 'Aktif rezervasyonu/konuğu olan oda silinemez');
        await db.transaction(() => db.run(`DELETE FROM rooms WHERE id=?`, [id]));
        await db.audit(user.username, 'oda_sil', id);
        return this.sendJson(res, 200, { ok: true });
      }
      case 'POST /rooms/:id/status': {
        const user = this.auth(req);
        const { status } = await this.readBody(req);
        if (!['Boş', 'Arızalı'].includes(status)) throw new ApiError(400, 'Geçersiz durum');
        const active = await db.get(`SELECT id FROM reservations WHERE roomId=? AND status='Dolu' LIMIT 1`, [id]);
        if (active) throw new ApiError(409, 'Konuğu olan odanın durumu değiştirilemez; önce çıkış yapın');
        await db.transaction(() => db.run(`UPDATE rooms SET status=?, updatedAt=? WHERE id=?`, [status, now(), id]));
        await db.audit(user.username, 'oda_durum', { id, status });
        return this.sendJson(res, 200, { ok: true });
      }
      case 'POST /rooms/:id/clean': {
        const user = this.auth(req);
        const { clean: c } = await this.readBody(req);
        await db.transaction(() => db.run(`UPDATE rooms SET clean=?, updatedAt=? WHERE id=?`, [c ? 1 : 0, now(), id]));
        await db.audit(user.username, 'oda_temizlik', { id, clean: !!c });
        return this.sendJson(res, 200, { ok: true });
      }

      // ---- rezervasyonlar ----
      case 'POST /reservations': {
        const user = this.auth(req);
        const b = await this.readBody(req);
        const roomId = clean(b.roomId, 20);
        const checkIn = b.checkIn, checkOut = b.checkOut;
        const guests = Array.isArray(b.guests) ? b.guests.map(g => ({ tc: clean(g.tc, 20), name: clean(g.name, 80), phone: clean(g.phone, 30), email: clean(g.email, 80), birthDate: isDate(g.birthDate) ? g.birthDate : '', nationality: clean(g.nationality, 5) || 'TC' })).filter(g => g.name) : [];
        if (!guests.length || !guests[0].phone) throw new ApiError(400, '1. misafirin adı ve telefonu zorunludur');
        const q = await this.quote({ roomId, checkIn, checkOut, adultCount: b.adultCount, childCount: b.childCount });
        const conflict = await this.checkConflict(roomId, checkIn, checkOut, null);
        if (conflict) throw new ApiError(409, `Çakışma: ${conflict.primaryName} (${conflict.checkIn} → ${conflict.checkOut})`);
        const room = await db.get(`SELECT * FROM rooms WHERE id=?`, [roomId]);
        if (room.status === 'Arızalı') throw new ApiError(409, 'Arızalı odaya rezervasyon yapılamaz');
        const totalPrice = b.totalPrice != null ? num(b.totalPrice) : q.total; // manuel fiyat izin ver
        const status = (checkIn <= todayStr() && room.status !== 'Dolu' && b.checkInNow !== false) ? 'Dolu' : 'Rezerve';
        const rid = genId('REZ');
        const advance = num(b.advancePayment);
        const adults = Math.max(1, parseInt(b.adultCount, 10) || 1), children = Math.max(0, parseInt(b.childCount, 10) || 0);
        await db.transaction(async () => {
          await db.run(`INSERT INTO reservations (id,roomId,primaryName,tc,phone,adultCount,childCount,allGuestsNames,guestsJson,checkIn,checkOut,totalPrice,status,notes,source,createdBy,createdAt,updatedAt,checkedInAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [rid, roomId, guests[0].name, guests[0].tc, guests[0].phone, adults, children, guests.map(g => g.name).join(', ') + (children ? ` (+${children} Çocuk)` : ''), JSON.stringify(guests), checkIn, checkOut, totalPrice, status, clean(b.notes, 1000), clean(b.source, 30) || 'Resepsiyon', user.username, now(), now(), status === 'Dolu' ? now() : null]);
          if (advance > 0) await db.run(`INSERT INTO payments (reservationId,roomId,amount,method,type,note,createdAt,createdBy) VALUES (?,?,?,?,?,?,?,?)`, [rid, roomId, advance, clean(b.advanceMethod, 20) || 'Nakit', 'Kapora', 'Rezervasyon sırasında', now(), user.username]);
          await this.upsertGuests(guests, clean(b.notes, 500), user);
          if (status === 'Dolu') await db.run(`UPDATE rooms SET status='Dolu', updatedAt=? WHERE id=?`, [now(), roomId]);
        });
        await db.audit(user.username, 'rezervasyon_oluştur', { rid, roomId, checkIn, checkOut, status });
        return this.sendJson(res, 200, { ok: true, id: rid, status, quote: q });
      }
      case 'PUT /reservations/:id': {
        const user = this.auth(req);
        const b = await this.readBody(req);
        const r = await db.get(`SELECT * FROM reservations WHERE id=?`, [id]);
        if (!r) throw new ApiError(404, 'Rezervasyon bulunamadı');
        if (['Tamamlandı', 'İptal', 'No-Show'].includes(r.status)) throw new ApiError(409, 'Kapanmış rezervasyon düzenlenemez');
        const roomId = clean(b.roomId ?? r.roomId, 20), checkIn = b.checkIn ?? r.checkIn, checkOut = b.checkOut ?? r.checkOut;
        if (nightsBetween(checkIn, checkOut) < 1) throw new ApiError(400, 'Geçersiz tarih aralığı');
        const conflict = await this.checkConflict(roomId, checkIn, checkOut, id);
        if (conflict) throw new ApiError(409, `Çakışma: ${conflict.primaryName} (${conflict.checkIn} → ${conflict.checkOut})`);
        const moved = roomId !== r.roomId;
        await db.transaction(async () => {
          await db.run(`UPDATE reservations SET roomId=?, primaryName=?, tc=?, phone=?, adultCount=?, childCount=?, checkIn=?, checkOut=?, totalPrice=?, notes=?, updatedAt=? WHERE id=?`,
            [roomId, clean(b.primaryName ?? r.primaryName, 80), clean(b.tc ?? r.tc, 20), clean(b.phone ?? r.phone, 30), Math.max(1, parseInt(b.adultCount ?? r.adultCount, 10) || 1), Math.max(0, parseInt(b.childCount ?? r.childCount, 10) || 0), checkIn, checkOut, num(b.totalPrice ?? r.totalPrice), clean(b.notes ?? r.notes, 1000), now(), id]);
          if (moved) { await db.run(`UPDATE payments SET roomId=? WHERE reservationId=?`, [roomId, id]); await db.run(`UPDATE minibar_items SET roomId=? WHERE reservationId=?`, [roomId, id]); await this.syncRoomStatus(r.roomId); await this.syncRoomStatus(roomId); }
        });
        await db.audit(user.username, 'rezervasyon_güncelle', { id, roomId, checkIn, checkOut });
        return this.sendJson(res, 200, { ok: true });
      }
      case 'POST /reservations/:id/checkin': {
        const user = this.auth(req);
        const r = await db.get(`SELECT * FROM reservations WHERE id=?`, [id]);
        if (!r || r.status !== 'Rezerve') throw new ApiError(409, 'Sadece "Rezerve" kayıtlar için giriş yapılabilir');
        const room = await db.get(`SELECT * FROM rooms WHERE id=?`, [r.roomId]);
        if (room.status === 'Dolu') throw new ApiError(409, 'Oda şu an dolu; önce mevcut konuğun çıkışını yapın');
        if (room.status === 'Arızalı') throw new ApiError(409, 'Oda arızalı');
        await db.transaction(async () => {
          await db.run(`UPDATE reservations SET status='Dolu', checkedInAt=?, updatedAt=? WHERE id=?`, [now(), now(), id]);
          await db.run(`UPDATE rooms SET status='Dolu', updatedAt=? WHERE id=?`, [now(), r.roomId]);
        });
        await db.audit(user.username, 'checkin', id);
        return this.sendJson(res, 200, { ok: true });
      }
      case 'POST /reservations/:id/checkout': {
        const user = this.auth(req);
        const b = await this.readBody(req);
        const r = await db.get(`SELECT * FROM reservations WHERE id=?`, [id]);
        if (!r || r.status !== 'Dolu') throw new ApiError(409, 'Sadece "Dolu" kayıtlar için çıkış yapılabilir');
        const pays = Array.isArray(b.payments) ? b.payments.filter(p => num(p.amount) > 0) : [];
        await db.transaction(async () => {
          for (const p of pays) await db.run(`INSERT INTO payments (reservationId,roomId,amount,method,type,note,createdAt,createdBy) VALUES (?,?,?,?,?,?,?,?)`, [id, r.roomId, num(p.amount), clean(p.method, 20) || 'Nakit', 'Tahsilat', clean(p.note, 200) || 'Çıkış tahsilatı', now(), user.username]);
          await db.run(`UPDATE reservations SET status='Tamamlandı', checkedOutAt=?, updatedAt=? WHERE id=?`, [now(), now(), id]);
          await db.run(`UPDATE rooms SET status='Boş', clean=0, updatedAt=? WHERE id=? AND status!='Arızalı'`, [now(), r.roomId]);
        });
        await db.audit(user.username, 'checkout', { id, payments: pays });
        return this.sendJson(res, 200, { ok: true });
      }
      case 'POST /reservations/:id/cancel':
      case 'POST /reservations/:id/noshow': {
        const user = this.auth(req);
        const r = await db.get(`SELECT * FROM reservations WHERE id=?`, [id]);
        if (!r || !['Rezerve', 'Dolu'].includes(r.status)) throw new ApiError(409, 'Bu kayıt iptal edilemez');
        const st = seg[2] === 'cancel' ? 'İptal' : 'No-Show';
        await db.transaction(async () => { await db.run(`UPDATE reservations SET status=?, updatedAt=? WHERE id=?`, [st, now(), id]); await this.syncRoomStatus(r.roomId); });
        await db.audit(user.username, st.toLowerCase(), id);
        return this.sendJson(res, 200, { ok: true });
      }
      case 'DELETE /reservations/:id': {
        const user = this.auth(req, 'admin');
        const r = await db.get(`SELECT roomId FROM reservations WHERE id=?`, [id]);
        if (!r) throw new ApiError(404, 'Kayıt yok');
        await db.transaction(async () => { await db.run(`DELETE FROM payments WHERE reservationId=?`, [id]); await db.run(`DELETE FROM minibar_items WHERE reservationId=?`, [id]); await db.run(`DELETE FROM reservations WHERE id=?`, [id]); await this.syncRoomStatus(r.roomId); });
        await db.audit(user.username, 'rezervasyon_sil', id);
        return this.sendJson(res, 200, { ok: true });
      }
      case 'POST /reservations/:id/minibar': {
        const user = this.auth(req);
        const b = await this.readBody(req);
        const r = await db.get(`SELECT roomId, status FROM reservations WHERE id=?`, [id]);
        if (!r || r.status !== 'Dolu') throw new ApiError(409, 'Minibar sadece konaklayan misafire eklenir');
        if (!clean(b.name) || num(b.price) <= 0) throw new ApiError(400, 'Ürün adı ve tutar zorunlu');
        await db.transaction(() => db.run(`INSERT INTO minibar_items (reservationId,roomId,name,price,qty,createdAt,createdBy) VALUES (?,?,?,?,?,?,?)`, [id, r.roomId, clean(b.name, 60), num(b.price), Math.max(1, parseInt(b.qty, 10) || 1), now(), user.username]));
        return this.sendJson(res, 200, { ok: true });
      }
      case 'DELETE /minibar/:id': {
        const user = this.auth(req);
        await db.transaction(() => db.run(`DELETE FROM minibar_items WHERE id=?`, [parseInt(id, 10)]));
        await db.audit(user.username, 'minibar_sil', id);
        return this.sendJson(res, 200, { ok: true });
      }

      // ---- ödemeler ----
      case 'POST /payments': {
        const user = this.auth(req);
        const b = await this.readBody(req);
        const r = await db.get(`SELECT roomId, status FROM reservations WHERE id=?`, [clean(b.reservationId, 40)]);
        if (!r) throw new ApiError(404, 'Rezervasyon bulunamadı');
        if (num(b.amount) <= 0) throw new ApiError(400, 'Tutar sıfırdan büyük olmalı');
        const type = ['Kapora', 'Tahsilat', 'İade'].includes(b.type) ? b.type : 'Tahsilat';
        await db.transaction(() => db.run(`INSERT INTO payments (reservationId,roomId,amount,method,type,note,createdAt,createdBy) VALUES (?,?,?,?,?,?,?,?)`, [b.reservationId, r.roomId, num(b.amount), clean(b.method, 20) || 'Nakit', type, clean(b.note, 200), now(), user.username]));
        await db.audit(user.username, 'ödeme', b);
        return this.sendJson(res, 200, { ok: true });
      }
      case 'DELETE /payments/:id': {
        const user = this.auth(req, 'admin');
        await db.transaction(() => db.run(`DELETE FROM payments WHERE id=?`, [parseInt(id, 10)]));
        await db.audit(user.username, 'ödeme_sil', id);
        return this.sendJson(res, 200, { ok: true });
      }

      // ---- misafirler ----
      case 'PUT /guests/:id': {
        const user = this.auth(req);
        const b = await this.readBody(req);
        if (!clean(b.name)) throw new ApiError(400, 'Ad Soyad zorunlu');
        await db.transaction(() => db.run(`UPDATE guests SET name=?, tc=?, phone=?, email=?, birthDate=?, nationality=?, gender=?, notes=?, updatedAt=? WHERE key=?`,
          [clean(b.name, 80), clean(b.tc, 20), clean(b.phone, 30), clean(b.email, 80), isDate(b.birthDate) ? b.birthDate : '', clean(b.nationality, 5) || 'TC', clean(b.gender, 1), clean(b.notes, 500), now(), id]));
        await db.audit(user.username, 'misafir_güncelle', id);
        return this.sendJson(res, 200, { ok: true });
      }
      case 'DELETE /guests/:id': {
        const user = this.auth(req, 'admin');
        await db.transaction(() => db.run(`DELETE FROM guests WHERE key=?`, [id]));
        await db.audit(user.username, 'misafir_sil', id);
        return this.sendJson(res, 200, { ok: true });
      }

      // ---- ayarlar ----
      case 'PUT /settings': {
        const user = this.auth(req, 'admin');
        const b = await this.readBody(req);
        const allowed = ['hotel_name', 'hotel_subtitle', 'hotel_address', 'hotel_phone', 'hotel_tax_no', 'pricing_mode', 'child_factor', 'weekend_multiplier', 'weekend_days', 'seasons', 'checkout_hour', 'currency', 'backup_keep_days', 'backup_extra_dir', 'allow_overbooking'];
        await db.transaction(async () => { for (const k of allowed) if (b[k] !== undefined) await db.run(`INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)`, [k, typeof b[k] === 'string' ? b[k].slice(0, 5000) : JSON.stringify(b[k])]); });
        await db.audit(user.username, 'ayar_güncelle', Object.keys(b));
        return this.sendJson(res, 200, { ok: true });
      }

      // ---- kullanıcılar ----
      case 'POST /users': {
        const user = this.auth(req, 'admin');
        const b = await this.readBody(req);
        const un = clean(b.username, 40);
        if (!un || String(b.password || '').length < 4) throw new ApiError(400, 'Kullanıcı adı ve en az 4 karakter şifre zorunlu');
        if (await db.get(`SELECT id FROM users WHERE username=?`, [un])) throw new ApiError(409, 'Bu kullanıcı adı kullanımda');
        const { hash, salt } = Database.hashPassword(b.password);
        await db.transaction(() => db.run(`INSERT INTO users (username,name,role,passHash,salt,active,createdAt) VALUES (?,?,?,?,?,1,?)`, [un, clean(b.name, 60), b.role === 'admin' ? 'admin' : 'receptionist', hash, salt, now()]));
        await db.audit(user.username, 'kullanıcı_ekle', un);
        return this.sendJson(res, 200, { ok: true });
      }
      case 'PUT /users/:id': {
        const user = this.auth(req, 'admin');
        const b = await this.readBody(req);
        const u = await db.get(`SELECT * FROM users WHERE id=?`, [parseInt(id, 10)]);
        if (!u) throw new ApiError(404, 'Kullanıcı yok');
        const admins = (await db.get(`SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1`)).c;
        const newRole = b.role === 'admin' ? 'admin' : (b.role ? 'receptionist' : u.role);
        const newActive = b.active === undefined ? u.active : (b.active ? 1 : 0);
        if (u.role === 'admin' && admins <= 1 && (newRole !== 'admin' || !newActive)) throw new ApiError(409, 'Son aktif yönetici düşürülemez');
        await db.transaction(async () => {
          await db.run(`UPDATE users SET name=?, role=?, active=? WHERE id=?`, [clean(b.name ?? u.name, 60), newRole, newActive, u.id]);
          if (b.password) { const { hash, salt } = Database.hashPassword(b.password); await db.run(`UPDATE users SET passHash=?, salt=? WHERE id=?`, [hash, salt, u.id]); }
        });
        if (!newActive) for (const [t, s] of this.sessions) if (s.user.id === u.id) this.sessions.delete(t);
        await db.audit(user.username, 'kullanıcı_güncelle', u.username);
        return this.sendJson(res, 200, { ok: true });
      }
      case 'DELETE /users/:id': {
        const user = this.auth(req, 'admin');
        if (user.id === parseInt(id, 10)) throw new ApiError(409, 'Kendinizi silemezsiniz');
        await db.transaction(() => db.run(`DELETE FROM users WHERE id=?`, [parseInt(id, 10)]));
        await db.audit(user.username, 'kullanıcı_sil', id);
        return this.sendJson(res, 200, { ok: true });
      }
      case 'GET /audit': { this.auth(req, 'admin'); return this.sendJson(res, 200, await db.all(`SELECT * FROM audit_log ORDER BY id DESC LIMIT 500`)); }

      // ---- yedek / içe-dışa aktarım ----
      case 'POST /backup': {
        const user = this.auth(req, 'admin');
        const s = await db.getSettings();
        const file = await db.backup(this.backupsDir, parseInt(s.backup_keep_days, 10) || 30);
        if (s.backup_extra_dir) { try { fs.mkdirSync(s.backup_extra_dir, { recursive: true }); fs.copyFileSync(file, path.join(s.backup_extra_dir, path.basename(file))); } catch (e) { this.log('[backup] ek klasör hatası', e.message); } }
        await db.audit(user.username, 'yedek_manuel', file);
        return this.sendJson(res, 200, { ok: true, file });
      }
      case 'GET /export': {
        // /api/export?type=json|kbs|ical&... — token query'de de kabul (indirme linki için)
        const tok = url.searchParams.get('token');
        if (tok && !req.headers.authorization) req.headers.authorization = `Bearer ${tok}`;
        const type = url.searchParams.get('type');
        if (type === 'json') { this.auth(req, 'admin'); const st = await db.getState(); res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="MesoftOtel_Yedek_${todayStr()}.json"` }); return res.end(JSON.stringify({ version: 7, exportedAt: now(), ...st }, null, 2)); }
        if (type === 'kbs') { this.auth(req); return this.exportKbs(res, url.searchParams.get('date') || todayStr()); }
        if (type === 'ical') { this.auth(req); return this.exportIcal(res, url.searchParams.get('roomId')); }
        throw new ApiError(400, 'Bilinmeyen dışa aktarım türü');
      }
      case 'POST /import': {
        const user = this.auth(req, 'admin');
        const b = await this.readBody(req, 50 * 1024 * 1024);
        if (b.ics && b.roomId) return this.sendJson(res, 200, await this.importIcal(b.roomId, b.ics, user));
        if (!Array.isArray(b.rooms)) throw new ApiError(400, 'Geçersiz yedek dosyası');
        await db.transaction(async () => {
          for (const t of ['payments', 'minibar_items', 'reservations', 'guests', 'rooms']) await db.run(`DELETE FROM ${t}`);
          for (const r of b.rooms) await db.run(`INSERT OR REPLACE INTO rooms (id,type,price,extraPersonPrice,capacity,status,clean,floor,notes,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)`, [String(r.id), r.type, num(r.price), num(r.extraPersonPrice), r.capacity || 2, r.status || 'Boş', r.clean == null ? 1 : (r.clean ? 1 : 0), r.floor || '', r.notes || '', now()]);
          for (const g of (b.guests || [])) await db.run(`INSERT OR REPLACE INTO guests (key,tc,name,phone,email,birthDate,nationality,gender,notes,visits,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [g.key || genId('G'), g.tc || '', g.name, g.phone || '', g.email || '', g.birthDate || '', g.nationality || 'TC', g.gender || '', g.notes || '', g.visits || 1, now()]);
          for (const r of (b.reservations || [])) {
            await db.run(`INSERT OR REPLACE INTO reservations (id,roomId,primaryName,tc,phone,adultCount,childCount,allGuestsNames,guestsJson,checkIn,checkOut,totalPrice,status,notes,source,createdBy,createdAt,updatedAt,checkedInAt,checkedOutAt,externalUid) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              [r.id, String(r.roomId), r.primaryName, r.tc || '', r.phone || '', r.adultCount || 1, r.childCount || 0, r.allGuestsNames || r.primaryName, JSON.stringify(r.guests || []), r.checkIn, r.checkOut, num(r.totalPrice), r.status || 'Rezerve', r.notes || '', r.source || 'İçe aktarım', r.createdBy || 'import', r.createdAt || now(), now(), r.checkedInAt || null, r.checkedOutAt || null, r.externalUid || null]);
            // v6 yedeği: ödeme tablosu yoksa advancePayment'tan üret
            if (!Array.isArray(b.payments) && num(r.advancePayment) > 0) await db.run(`INSERT INTO payments (reservationId,roomId,amount,method,type,note,createdAt,createdBy) VALUES (?,?,?,?,?,?,?,?)`, [r.id, String(r.roomId), num(r.advancePayment), 'Nakit', 'Kapora', 'v6 yedek', r.checkIn, 'import']);
          }
          for (const p of (b.payments || [])) await db.run(`INSERT INTO payments (reservationId,roomId,amount,method,type,note,createdAt,createdBy) VALUES (?,?,?,?,?,?,?,?)`, [p.reservationId, String(p.roomId), num(p.amount), p.method || 'Nakit', p.type || 'Tahsilat', p.note || '', p.createdAt || now(), p.createdBy || 'import']);
          for (const m of (b.minibar || [])) await db.run(`INSERT INTO minibar_items (reservationId,roomId,name,price,qty,createdAt,createdBy) VALUES (?,?,?,?,?,?,?)`, [m.reservationId, String(m.roomId), m.name, num(m.price), m.qty || 1, m.createdAt || now(), m.createdBy || 'import']);
          if (b.settings && typeof b.settings === 'object') for (const k of ['hotel_name', 'hotel_subtitle', 'pricing_mode', 'child_factor', 'weekend_multiplier', 'seasons']) if (b.settings[k] != null) await db.run(`INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)`, [k, String(b.settings[k])]);
        });
        await db.audit(user.username, 'içe_aktarım', { rooms: b.rooms.length, reservations: (b.reservations || []).length });
        return this.sendJson(res, 200, { ok: true });
      }
      case 'POST /reset': {
        const user = this.auth(req, 'admin');
        await db.backup(this.backupsDir, 365, 'Sifirlama_Oncesi');
        await db.transaction(async () => { for (const t of ['payments', 'minibar_items', 'reservations', 'guests', 'rooms']) await db.run(`DELETE FROM ${t}`); });
        await db.audit(user.username, 'sıfırlama', '');
        return this.sendJson(res, 200, { ok: true });
      }
      default: throw new ApiError(404, 'Uç nokta bulunamadı');
    }
  }

  // ---------- KBS (Kimlik Bildirim) CSV ----------
  async exportKbs(res, date) {
    const rows = await this.db.all(`SELECT r.*, rm.type roomType FROM reservations r LEFT JOIN rooms rm ON rm.id=r.roomId WHERE r.status IN ('Dolu','Tamamlandı') AND r.checkIn <= ? AND r.checkOut > ? ORDER BY r.roomId`, [date, date]);
    const guestsByTc = {};
    for (const g of await this.db.all(`SELECT * FROM guests`)) { if (g.tc) guestsByTc[g.tc] = g; }
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    let csv = '\uFEFFOda No;Kimlik No;Ad Soyad;Uyruk;Dogum Tarihi;Cinsiyet;Telefon;Giris Tarihi;Cikis Tarihi;Rezervasyon No\n';
    for (const r of rows) {
      let gl = []; try { gl = JSON.parse(r.guestsJson || '[]'); } catch (_) {}
      if (!gl.length) gl = [{ name: r.primaryName, tc: r.tc, phone: r.phone }];
      for (const g of gl) {
        const gi = (g.tc && guestsByTc[g.tc]) || {};
        csv += [r.roomId, g.tc || '', g.name, g.nationality || gi.nationality || 'TC', g.birthDate || gi.birthDate || '', gi.gender || '', g.phone || gi.phone || '', r.checkIn, r.checkOut, r.id].map(esc).join(';') + '\n';
      }
    }
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="KBS_${date}.csv"` });
    res.end(csv);
  }

  // ---------- iCal ----------
  async exportIcal(res, roomId) {
    const where = roomId ? `AND roomId=?` : '';
    const rows = await this.db.all(`SELECT * FROM reservations WHERE status IN ('Rezerve','Dolu') ${where}`, roomId ? [String(roomId)] : []);
    const fmt = (d) => d.replace(/-/g, '');
    let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Mesoft Otel//TR\r\nCALSCALE:GREGORIAN\r\n';
    for (const r of rows) ics += `BEGIN:VEVENT\r\nUID:${r.externalUid || r.id}@mesoft-otel\r\nDTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z\r\nDTSTART;VALUE=DATE:${fmt(r.checkIn)}\r\nDTEND;VALUE=DATE:${fmt(r.checkOut)}\r\nSUMMARY:Oda ${r.roomId} - Dolu\r\nEND:VEVENT\r\n`;
    ics += 'END:VCALENDAR\r\n';
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="oda_${roomId || 'tum'}.ics"` });
    res.end(ics);
  }
  async importIcal(roomId, ics, user) {
    const events = []; let cur = null;
    for (const raw of String(ics).split(/\r?\n/)) {
      const line = raw.trim();
      if (line === 'BEGIN:VEVENT') cur = {};
      else if (line === 'END:VEVENT' && cur) { events.push(cur); cur = null; }
      else if (cur) { const i = line.indexOf(':'); if (i > 0) { const k = line.slice(0, i).split(';')[0], v = line.slice(i + 1); if (k === 'UID') cur.uid = v; if (k === 'DTSTART') cur.start = v; if (k === 'DTEND') cur.end = v; if (k === 'SUMMARY') cur.summary = v; } }
    }
    const toDate = (v) => v && /^\d{8}/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null;
    let added = 0, skipped = 0;
    const now = new Date().toISOString();
    await this.db.transaction(async () => {
      for (const ev of events) {
        const ci = toDate(ev.start), co = toDate(ev.end);
        if (!ci || !co || nightsBetween(ci, co) < 1 || co < todayStr()) { skipped++; continue; }
        if (ev.uid && await this.db.get(`SELECT id FROM reservations WHERE externalUid=?`, [ev.uid])) { skipped++; continue; }
        if (await this.checkConflict(roomId, ci, co, null)) { skipped++; continue; }
        await this.db.run(`INSERT INTO reservations (id,roomId,primaryName,tc,phone,adultCount,childCount,allGuestsNames,guestsJson,checkIn,checkOut,totalPrice,status,notes,source,createdBy,createdAt,updatedAt,externalUid) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [genId('REZ'), String(roomId), clean(ev.summary, 80) || 'Harici Rezervasyon', '', '', 1, 0, clean(ev.summary, 80) || 'Harici Rezervasyon', '[]', ci, co, 0, 'Rezerve', 'iCal içe aktarım', 'iCal', user.username, now, now, ev.uid || null]);
        added++;
      }
    });
    await this.db.audit(user.username, 'ical_import', { roomId, added, skipped });
    return { ok: true, added, skipped };
  }

  // ---------- statik ----------
  serveStatic(pathname, res) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname);
    const full = path.normalize(path.join(this.staticDir, rel));
    if (!full.startsWith(path.normalize(this.staticDir + path.sep)) && full !== path.normalize(this.staticDir)) { res.writeHead(403); return res.end('Yasak'); }
    const allowed = ['index.html', 'app.js'];
    const inAssets = full.startsWith(path.join(this.staticDir, 'assets') + path.sep);
    if (!inAssets && !allowed.includes(path.basename(full))) { res.writeHead(404); return res.end('Bulunamadı'); }
    fs.readFile(full, (err, content) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Sayfa Bulunamadı'); }
      const ext = path.extname(full).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': inAssets ? 'public, max-age=86400' : 'no-cache' });
      res.end(content);
    });
  }
}

module.exports = { Server, ApiError };
