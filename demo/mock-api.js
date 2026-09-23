/* DEMO MODU — sunucu yerine tarayıcı içinde çalışan bellek-içi API taklidi.
   Gerçek üründe bu dosya yoktur; iş kuralları server.js'ten birebir taşınmıştır. */
(function () {
  const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => localDate(new Date());
  const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return localDate(new Date(y, m - 1, d + n)); };
  const nightsBetween = (a, b) => { const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number); return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000); };
  const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  const now = () => new Date().toISOString();
  let seq = 1; const gid = (p) => `${p}-DEMO${String(seq++).padStart(3, '0')}`;
  const T = today();

  const DB = {
    revision: 1,
    users: [{ id: 1, username: 'admin', name: 'Yönetici (Demo)', role: 'admin', pass: '1234', active: 1 }, { id: 2, username: 'resep', name: 'Resepsiyon (Demo)', role: 'receptionist', pass: '1234', active: 1 }],
    rooms: [
      { id: '101', type: 'Standart', price: 1600, extraPersonPrice: 500, capacity: 2, status: 'Dolu', clean: 1 },
      { id: '102', type: 'Standart', price: 1600, extraPersonPrice: 500, capacity: 2, status: 'Boş', clean: 0 },
      { id: '103', type: 'Standart', price: 1800, extraPersonPrice: 500, capacity: 2, status: 'Boş', clean: 1 },
      { id: '104', type: 'Deluxe', price: 2400, extraPersonPrice: 700, capacity: 3, status: 'Dolu', clean: 1 },
      { id: '201', type: 'Aile', price: 3200, extraPersonPrice: 600, capacity: 4, status: 'Boş', clean: 1 },
      { id: '202', type: 'Suit', price: 4500, extraPersonPrice: 900, capacity: 2, status: 'Boş', clean: 1 },
      { id: '203', type: 'Standart', price: 1800, extraPersonPrice: 500, capacity: 2, status: 'Arızalı', clean: 1, notes: 'Klima arızası' },
      { id: '204', type: 'Deluxe', price: 2400, extraPersonPrice: 700, capacity: 3, status: 'Boş', clean: 1 }
    ],
    guests: [
      { key: 'G1', tc: '11111111110', name: 'Ali Veli', phone: '0555 111 22 33', email: 'ali@ornek.com', birthDate: '1988-04-12', nationality: 'TC', notes: 'Deniz manzarası ister', visits: 3 },
      { key: 'G2', tc: '22222222220', name: 'Ayşe Kaya', phone: '0532 444 55 66', email: '', birthDate: '1992-09-01', nationality: 'TC', notes: '', visits: 1 },
      { key: 'G3', tc: 'P1234567', name: 'John Smith', phone: '+44 7700 900123', email: 'john@example.co.uk', birthDate: '1975-01-20', nationality: 'GBR', notes: '', visits: 2 },
      { key: 'G4', tc: '33333333330', name: 'Mehmet Demir', phone: '0505 777 88 99', email: '', birthDate: '', nationality: 'TC', notes: '', visits: 1 }
    ],
    reservations: [
      { id: 'REZ-DEMO001', roomId: '101', primaryName: 'Ali Veli', tc: '11111111110', phone: '0555 111 22 33', adultCount: 2, childCount: 0, allGuestsNames: 'Ali Veli, Zeynep Veli', guestsJson: JSON.stringify([{ name: 'Ali Veli', tc: '11111111110', phone: '0555 111 22 33' }, { name: 'Zeynep Veli', tc: '44444444440' }]), checkIn: addDays(T, -2), checkOut: addDays(T, 1), totalPrice: 4800, status: 'Dolu', notes: 'Geç çıkış talebi', source: 'Telefon', createdBy: 'admin', createdAt: now(), checkedInAt: now() },
      { id: 'REZ-DEMO002', roomId: '104', primaryName: 'John Smith', tc: 'P1234567', phone: '+44 7700 900123', adultCount: 2, childCount: 1, allGuestsNames: 'John Smith, Mary Smith (+1 Çocuk)', guestsJson: JSON.stringify([{ name: 'John Smith', tc: 'P1234567', nationality: 'GBR' }, { name: 'Mary Smith', nationality: 'GBR' }]), checkIn: addDays(T, -1), checkOut: T, totalPrice: 4800, status: 'Dolu', notes: '', source: 'Booking.com', createdBy: 'admin', createdAt: now(), checkedInAt: now() },
      { id: 'REZ-DEMO003', roomId: '103', primaryName: 'Ayşe Kaya', tc: '22222222220', phone: '0532 444 55 66', adultCount: 1, childCount: 0, allGuestsNames: 'Ayşe Kaya', guestsJson: '[]', checkIn: T, checkOut: addDays(T, 2), totalPrice: 3600, status: 'Rezerve', notes: '', source: 'Resepsiyon', createdBy: 'resep', createdAt: now() },
      { id: 'REZ-DEMO004', roomId: '201', primaryName: 'Mehmet Demir', tc: '33333333330', phone: '0505 777 88 99', adultCount: 4, childCount: 0, allGuestsNames: 'Mehmet Demir', guestsJson: '[]', checkIn: addDays(T, 3), checkOut: addDays(T, 6), totalPrice: 9600, status: 'Rezerve', notes: 'Bayram tatili', source: 'Airbnb', createdBy: 'admin', createdAt: now() },
      { id: 'REZ-DEMO005', roomId: '102', primaryName: 'Fatma Şahin', tc: '', phone: '0533 000 11 22', adultCount: 2, childCount: 0, allGuestsNames: 'Fatma Şahin', guestsJson: '[]', checkIn: addDays(T, -4), checkOut: addDays(T, -1), totalPrice: 4800, status: 'Tamamlandı', notes: '', source: 'Resepsiyon', createdBy: 'resep', createdAt: now(), checkedOutAt: now() },
      { id: 'REZ-DEMO006', roomId: '202', primaryName: 'Can Yılmaz', tc: '', phone: '0542 123 45 67', adultCount: 2, childCount: 0, allGuestsNames: 'Can Yılmaz', guestsJson: '[]', checkIn: addDays(T, -3), checkOut: addDays(T, -2), totalPrice: 4500, status: 'No-Show', notes: '', source: 'Telefon', createdBy: 'admin', createdAt: now() },
      { id: 'REZ-DEMO007', roomId: '204', primaryName: 'Elif Arslan', tc: '', phone: '0544 987 65 43', adultCount: 2, childCount: 0, allGuestsNames: 'Elif Arslan', guestsJson: '[]', checkIn: addDays(T, 8), checkOut: addDays(T, 12), totalPrice: 9600, status: 'Rezerve', notes: '', source: 'Etstur', createdBy: 'admin', createdAt: now() }
    ],
    payments: [
      { id: 1, reservationId: 'REZ-DEMO001', roomId: '101', amount: 1500, method: 'Kart', type: 'Kapora', note: 'Rezervasyon sırasında', createdAt: new Date(Date.now() - 2 * 86400000).toISOString(), createdBy: 'admin' },
      { id: 2, reservationId: 'REZ-DEMO002', roomId: '104', amount: 4800, method: 'Havale', type: 'Kapora', note: 'Booking ön ödeme', createdAt: new Date(Date.now() - 86400000).toISOString(), createdBy: 'admin' },
      { id: 3, reservationId: 'REZ-DEMO005', roomId: '102', amount: 1000, method: 'Nakit', type: 'Kapora', note: '', createdAt: new Date(Date.now() - 4 * 86400000).toISOString(), createdBy: 'resep' },
      { id: 4, reservationId: 'REZ-DEMO005', roomId: '102', amount: 3800, method: 'Kart', type: 'Tahsilat', note: 'Çıkış tahsilatı', createdAt: new Date(Date.now() - 86400000).toISOString(), createdBy: 'resep' },
      { id: 5, reservationId: 'REZ-DEMO005', roomId: '102', amount: 120, method: 'Kart', type: 'Tahsilat', note: 'Minibar', createdAt: new Date(Date.now() - 86400000).toISOString(), createdBy: 'resep' },
      { id: 6, reservationId: 'REZ-DEMO003', roomId: '103', amount: 500, method: 'Nakit', type: 'Kapora', note: '', createdAt: new Date(Date.now() - 3600000).toISOString(), createdBy: 'resep' }
    ],
    minibar: [
      { id: 1, reservationId: 'REZ-DEMO001', roomId: '101', name: 'Su (2x)', price: 20, qty: 2, createdAt: now(), createdBy: 'resep' },
      { id: 2, reservationId: 'REZ-DEMO001', roomId: '101', name: 'Kola', price: 60, qty: 1, createdAt: now(), createdBy: 'resep' },
      { id: 3, reservationId: 'REZ-DEMO002', roomId: '104', name: 'Çamaşır servisi', price: 250, qty: 1, createdAt: now(), createdBy: 'admin' },
      { id: 4, reservationId: 'REZ-DEMO005', roomId: '102', name: 'Bira (2x)', price: 60, qty: 2, createdAt: now(), createdBy: 'resep' }
    ],
    settings: { hotel_name: 'MESOFT DEMO OTEL', hotel_subtitle: 'Canlı Demo — veriler bellekte', hotel_address: 'Kadıköy, İstanbul', hotel_phone: '0216 000 00 00', hotel_tax_no: '1234567890', pricing_mode: 'per_room', child_factor: '0.5', weekend_multiplier: '1.25', weekend_days: '5,6', seasons: JSON.stringify([{ name: 'Yaz', start: '06-15', end: '09-15', multiplier: 1.3 }]), checkout_hour: '12:00', currency: '₺', backup_keep_days: '30', backup_extra_dir: '', allow_overbooking: '0', force_password_change: '0' },
    audit: []
  };
  let session = null, payId = 100, mbId = 100;
  const audit = (u, a, d) => DB.audit.unshift({ id: DB.audit.length + 1, ts: now(), user: u, action: a, detail: typeof d === 'string' ? d : JSON.stringify(d || {}) });
  audit('sistem', 'demo_başlat', 'Bellek-içi demo verisi yüklendi');
  const bump = () => DB.revision++;
  class E extends Error { constructor(s, m) { super(m); this.status = s; } }
  const auth = (role) => { if (!session) throw new E(401, 'Oturum geçersiz'); if (role === 'admin' && session.role !== 'admin') throw new E(403, 'Bu işlem için yönetici yetkisi gerekir'); return session; };
  const room = (id) => DB.rooms.find(r => r.id === String(id));
  const rez = (id) => DB.reservations.find(r => r.id === id);

  function state() {
    const paySum = {}, mbSum = {};
    for (const p of DB.payments) paySum[p.reservationId] = (paySum[p.reservationId] || 0) + (p.type === 'İade' ? -p.amount : p.amount);
    for (const m of DB.minibar) mbSum[m.reservationId] = (mbSum[m.reservationId] || 0) + m.price * (m.qty || 1);
    const reservations = DB.reservations.map(r => { const o = { ...r }; o.collectedTotal = +(paySum[r.id] || 0).toFixed(2); o.minibarTotal = +(mbSum[r.id] || 0).toFixed(2); o.grandTotal = +((num(r.totalPrice)) + o.minibarTotal).toFixed(2); o.remainingBalance = +Math.max(0, o.grandTotal - o.collectedTotal).toFixed(2); try { o.guests = JSON.parse(r.guestsJson || '[]'); } catch (_) { o.guests = []; } delete o.guestsJson; return o; });
    const st = { rooms: DB.rooms.map(r => ({ ...r })), guests: DB.guests.map(g => ({ ...g })), reservations, payments: DB.payments.map(p => ({ ...p })), minibar: DB.minibar.map(m => ({ ...m })), settings: { ...DB.settings }, revision: DB.revision, me: session };
    if (session && session.role === 'admin') st.users = DB.users.map(u => ({ id: u.id, username: u.username, name: u.name, role: u.role, active: u.active }));
    return st;
  }
  function quote({ roomId, checkIn, checkOut, adultCount = 1, childCount = 0 }) {
    const r = room(roomId); if (!r) throw new E(404, 'Oda bulunamadı');
    const n = nightsBetween(checkIn, checkOut); if (!(n >= 1)) throw new E(400, 'Çıkış tarihi giriş tarihinden sonra olmalıdır');
    const s = DB.settings, mode = s.pricing_mode, cf = num(s.child_factor, .5), wm = num(s.weekend_multiplier, 1), wd = s.weekend_days.split(',').map(Number); let seasons = []; try { seasons = JSON.parse(s.seasons); } catch (_) {}
    const adults = Math.max(1, +adultCount || 1), children = Math.max(0, +childCount || 0); let total = 0; const breakdown = [];
    for (let i = 0; i < n; i++) { const ds = addDays(checkIn, i); const [y, m, d] = ds.split('-').map(Number); const dow = new Date(y, m - 1, d).getDay(); let nightly = mode === 'per_person' ? r.price * (adults + children * cf) : r.price + Math.max(0, adults - r.capacity) * r.extraPersonPrice + children * cf * r.extraPersonPrice; let mult = wd.includes(dow) ? wm : 1; const mmdd = ds.slice(5); for (const se of seasons) if (se.start <= se.end ? (mmdd >= se.start && mmdd <= se.end) : (mmdd >= se.start || mmdd <= se.end)) mult *= num(se.multiplier, 1); nightly = Math.round(nightly * mult); total += nightly; breakdown.push({ date: ds, price: nightly }); }
    return { nights: n, total, breakdown, mode, room: { id: r.id, type: r.type, price: r.price, capacity: r.capacity } };
  }
  const conflict = (roomId, ci, co, ex) => DB.settings.allow_overbooking === '1' ? null : DB.reservations.find(r => r.roomId === String(roomId) && ['Rezerve', 'Dolu'].includes(r.status) && r.id !== ex && r.checkIn < co && r.checkOut > ci);
  const syncRoom = (id) => { const r = room(id); if (!r || r.status === 'Arızalı') return; r.status = DB.reservations.some(x => x.roomId === id && x.status === 'Dolu') ? 'Dolu' : 'Boş'; };
  function upsertGuests(list) { for (const g of list) { if (!g.name) continue; let ex = g.tc && DB.guests.find(x => x.tc === g.tc); if (!ex && g.phone) ex = DB.guests.find(x => x.name.toLowerCase() === g.name.toLowerCase() && x.phone === g.phone); if (ex) { Object.assign(ex, { name: g.name, tc: g.tc || ex.tc, phone: g.phone || ex.phone, email: g.email || ex.email, birthDate: g.birthDate || ex.birthDate, nationality: g.nationality || ex.nationality }); ex.visits = (ex.visits || 0) + 1; } else DB.guests.push({ key: gid('G'), tc: g.tc || '', name: g.name, phone: g.phone || '', email: g.email || '', birthDate: g.birthDate || '', nationality: g.nationality || 'TC', notes: '', visits: 1 }); } }

  function handle(method, path, body) {
    const seg = path.replace(/^\/api\//, '').split('?')[0].split('/').filter(Boolean); const id = seg[1] ? decodeURIComponent(seg[1]) : null;
    const route = seg[0] === 'me' ? `${method} /me${seg[1] ? '/' + seg[1] : ''}` : `${method} /${seg[0]}${seg[1] ? '/:id' : ''}${seg[2] ? '/' + seg[2] : ''}`;
    switch (route) {
      case 'GET /health': return { ok: true };
      case 'GET /revision': return { revision: DB.revision };
      case 'POST /login': { const u = DB.users.find(x => x.username === body.username && x.active); if (!u || u.pass !== body.password) throw new E(401, 'Kullanıcı adı veya şifre hatalı (demo: admin/1234 veya resep/1234)'); session = { id: u.id, username: u.username, name: u.name, role: u.role }; audit(u.username, 'giriş', 'demo'); return { token: 'demo-token', user: session, forcePasswordChange: false }; }
      case 'POST /logout': session = null; return { ok: true };
      case 'GET /me': return { user: auth() };
      case 'POST /me/password': { const u = DB.users.find(x => x.id === auth().id); if (u.pass !== body.current) throw new E(400, 'Mevcut şifre hatalı'); if (String(body.next || '').length < 4) throw new E(400, 'Yeni şifre en az 4 karakter'); u.pass = body.next; audit(u.username, 'şifre_değişti', ''); return { ok: true }; }
      case 'GET /state': auth(); return state();
      case 'POST /quote': auth(); return quote(body);
      case 'POST /rooms': { auth('admin'); const rid = String(body.id || '').trim(); if (!rid || !body.type) throw new E(400, 'Oda numarası ve tipi zorunlu'); if (room(rid)) throw new E(409, `${rid} numaralı oda zaten var`); DB.rooms.push({ id: rid, type: body.type, price: num(body.price), extraPersonPrice: num(body.extraPersonPrice), capacity: Math.max(1, +body.capacity || 2), status: 'Boş', clean: 1 }); DB.rooms.sort((a, b) => (+a.id || 0) - (+b.id || 0)); bump(); audit(session.username, 'oda_ekle', rid); return { ok: true }; }
      case 'PUT /rooms/:id': { auth('admin'); const r = room(id); if (!r) throw new E(404, 'Oda bulunamadı'); const nid = String(body.id || id); if (nid !== id && room(nid)) throw new E(409, `${nid} numaralı oda zaten var`); Object.assign(r, { id: nid, type: body.type ?? r.type, price: num(body.price ?? r.price), extraPersonPrice: num(body.extraPersonPrice ?? r.extraPersonPrice), capacity: Math.max(1, +(body.capacity ?? r.capacity) || 2) }); if (nid !== id) for (const c of [DB.reservations, DB.payments, DB.minibar]) c.forEach(x => { if (x.roomId === id) x.roomId = nid; }); bump(); audit(session.username, 'oda_güncelle', { id, nid }); return { ok: true }; }
      case 'DELETE /rooms/:id': { auth('admin'); if (DB.reservations.some(x => x.roomId === id && ['Rezerve', 'Dolu'].includes(x.status))) throw new E(409, 'Aktif rezervasyonu/konuğu olan oda silinemez'); DB.rooms = DB.rooms.filter(r => r.id !== id); bump(); audit(session.username, 'oda_sil', id); return { ok: true }; }
      case 'POST /rooms/:id/status': { auth(); const r = room(id); if (!['Boş', 'Arızalı'].includes(body.status)) throw new E(400, 'Geçersiz durum'); if (DB.reservations.some(x => x.roomId === id && x.status === 'Dolu')) throw new E(409, 'Konuğu olan odanın durumu değiştirilemez; önce çıkış yapın'); r.status = body.status; bump(); audit(session.username, 'oda_durum', { id, status: body.status }); return { ok: true }; }
      case 'POST /rooms/:id/clean': { auth(); room(id).clean = body.clean ? 1 : 0; bump(); audit(session.username, 'oda_temizlik', { id, clean: !!body.clean }); return { ok: true }; }
      case 'POST /reservations': { auth(); const guests = (body.guests || []).filter(g => g.name); if (!guests.length || !guests[0].phone) throw new E(400, '1. misafirin adı ve telefonu zorunludur'); const q = quote(body); const c = conflict(body.roomId, body.checkIn, body.checkOut, null); if (c) throw new E(409, `Çakışma: ${c.primaryName} (${c.checkIn} → ${c.checkOut})`); const r = room(body.roomId); if (r.status === 'Arızalı') throw new E(409, 'Arızalı odaya rezervasyon yapılamaz'); const status = body.checkIn <= today() && r.status !== 'Dolu' ? 'Dolu' : 'Rezerve'; const rid = gid('REZ'); const children = +body.childCount || 0; DB.reservations.push({ id: rid, roomId: String(body.roomId), primaryName: guests[0].name, tc: guests[0].tc || '', phone: guests[0].phone, adultCount: +body.adultCount || 1, childCount: children, allGuestsNames: guests.map(g => g.name).join(', ') + (children ? ` (+${children} Çocuk)` : ''), guestsJson: JSON.stringify(guests), checkIn: body.checkIn, checkOut: body.checkOut, totalPrice: body.totalPrice != null ? num(body.totalPrice) : q.total, status, notes: body.notes || '', source: body.source || 'Resepsiyon', createdBy: session.username, createdAt: now(), checkedInAt: status === 'Dolu' ? now() : null }); if (num(body.advancePayment) > 0) DB.payments.push({ id: payId++, reservationId: rid, roomId: String(body.roomId), amount: num(body.advancePayment), method: body.advanceMethod || 'Nakit', type: 'Kapora', note: 'Rezervasyon sırasında', createdAt: now(), createdBy: session.username }); upsertGuests(guests); if (status === 'Dolu') r.status = 'Dolu'; bump(); audit(session.username, 'rezervasyon_oluştur', { rid, status }); return { ok: true, id: rid, status, quote: q }; }
      case 'PUT /reservations/:id': { auth(); const r = rez(id); if (!r) throw new E(404, 'Rezervasyon bulunamadı'); if (['Tamamlandı', 'İptal', 'No-Show'].includes(r.status)) throw new E(409, 'Kapanmış rezervasyon düzenlenemez'); const roomId = String(body.roomId ?? r.roomId), ci = body.checkIn ?? r.checkIn, co = body.checkOut ?? r.checkOut; if (nightsBetween(ci, co) < 1) throw new E(400, 'Geçersiz tarih aralığı'); const c = conflict(roomId, ci, co, id); if (c) throw new E(409, `Çakışma: ${c.primaryName} (${c.checkIn} → ${c.checkOut})`); const old = r.roomId; Object.assign(r, { roomId, checkIn: ci, checkOut: co, primaryName: body.primaryName ?? r.primaryName, tc: body.tc ?? r.tc, phone: body.phone ?? r.phone, adultCount: +(body.adultCount ?? r.adultCount) || 1, childCount: +(body.childCount ?? r.childCount) || 0, totalPrice: num(body.totalPrice ?? r.totalPrice), notes: body.notes ?? r.notes }); if (old !== roomId) { for (const c2 of [DB.payments, DB.minibar]) c2.forEach(x => { if (x.reservationId === id) x.roomId = roomId; }); syncRoom(old); syncRoom(roomId); } bump(); audit(session.username, 'rezervasyon_güncelle', id); return { ok: true }; }
      case 'POST /reservations/:id/checkin': { auth(); const r = rez(id); if (!r || r.status !== 'Rezerve') throw new E(409, 'Sadece "Rezerve" kayıtlar için giriş yapılabilir'); const rm = room(r.roomId); if (rm.status === 'Dolu') throw new E(409, 'Oda şu an dolu; önce mevcut konuğun çıkışını yapın'); if (rm.status === 'Arızalı') throw new E(409, 'Oda arızalı'); r.status = 'Dolu'; r.checkedInAt = now(); rm.status = 'Dolu'; bump(); audit(session.username, 'checkin', id); return { ok: true }; }
      case 'POST /reservations/:id/checkout': { auth(); const r = rez(id); if (!r || r.status !== 'Dolu') throw new E(409, 'Sadece "Dolu" kayıtlar için çıkış yapılabilir'); for (const p of (body.payments || [])) if (num(p.amount) > 0) DB.payments.push({ id: payId++, reservationId: id, roomId: r.roomId, amount: num(p.amount), method: p.method || 'Nakit', type: 'Tahsilat', note: 'Çıkış tahsilatı', createdAt: now(), createdBy: session.username }); r.status = 'Tamamlandı'; r.checkedOutAt = now(); const rm = room(r.roomId); if (rm.status !== 'Arızalı') { rm.status = 'Boş'; rm.clean = 0; } bump(); audit(session.username, 'checkout', id); return { ok: true }; }
      case 'POST /reservations/:id/cancel': case 'POST /reservations/:id/noshow': { auth(); const r = rez(id); if (!r || !['Rezerve', 'Dolu'].includes(r.status)) throw new E(409, 'Bu kayıt iptal edilemez'); r.status = seg[2] === 'cancel' ? 'İptal' : 'No-Show'; syncRoom(r.roomId); bump(); audit(session.username, r.status.toLowerCase(), id); return { ok: true }; }
      case 'DELETE /reservations/:id': { auth('admin'); const r = rez(id); if (!r) throw new E(404, 'Kayıt yok'); DB.payments = DB.payments.filter(p => p.reservationId !== id); DB.minibar = DB.minibar.filter(m => m.reservationId !== id); DB.reservations = DB.reservations.filter(x => x.id !== id); syncRoom(r.roomId); bump(); audit(session.username, 'rezervasyon_sil', id); return { ok: true }; }
      case 'POST /reservations/:id/minibar': { auth(); const r = rez(id); if (!r || r.status !== 'Dolu') throw new E(409, 'Minibar sadece konaklayan misafire eklenir'); if (!body.name || num(body.price) <= 0) throw new E(400, 'Ürün adı ve tutar zorunlu'); DB.minibar.push({ id: mbId++, reservationId: id, roomId: r.roomId, name: body.name, price: num(body.price), qty: Math.max(1, +body.qty || 1), createdAt: now(), createdBy: session.username }); bump(); return { ok: true }; }
      case 'DELETE /minibar/:id': auth(); DB.minibar = DB.minibar.filter(m => m.id !== +id); bump(); return { ok: true };
      case 'POST /payments': { auth(); const r = rez(body.reservationId); if (!r) throw new E(404, 'Rezervasyon bulunamadı'); if (num(body.amount) <= 0) throw new E(400, 'Tutar sıfırdan büyük olmalı'); DB.payments.push({ id: payId++, reservationId: r.id, roomId: r.roomId, amount: num(body.amount), method: body.method || 'Nakit', type: ['Kapora', 'Tahsilat', 'İade'].includes(body.type) ? body.type : 'Tahsilat', note: body.note || '', createdAt: now(), createdBy: session.username }); bump(); audit(session.username, 'ödeme', body); return { ok: true }; }
      case 'DELETE /payments/:id': auth('admin'); DB.payments = DB.payments.filter(p => p.id !== +id); bump(); audit(session.username, 'ödeme_sil', id); return { ok: true };
      case 'PUT /guests/:id': { auth(); const g = DB.guests.find(x => x.key === id); if (!g) throw new E(404, 'Misafir yok'); if (!body.name) throw new E(400, 'Ad Soyad zorunlu'); Object.assign(g, { name: body.name, tc: body.tc || '', phone: body.phone || '', email: body.email || '', birthDate: body.birthDate || '', nationality: body.nationality || 'TC', gender: body.gender || '', notes: body.notes || '' }); bump(); audit(session.username, 'misafir_güncelle', id); return { ok: true }; }
      case 'DELETE /guests/:id': auth('admin'); DB.guests = DB.guests.filter(g => g.key !== id); bump(); return { ok: true };
      case 'PUT /settings': { auth('admin'); for (const [k, v] of Object.entries(body)) if (k in DB.settings) DB.settings[k] = typeof v === 'string' ? v : JSON.stringify(v); bump(); audit(session.username, 'ayar_güncelle', Object.keys(body)); return { ok: true }; }
      case 'POST /users': { auth('admin'); if (!body.username || String(body.password || '').length < 4) throw new E(400, 'Kullanıcı adı ve en az 4 karakter şifre zorunlu'); if (DB.users.some(u => u.username === body.username)) throw new E(409, 'Bu kullanıcı adı kullanımda'); DB.users.push({ id: Math.max(...DB.users.map(u => u.id)) + 1, username: body.username, name: body.name || '', role: body.role === 'admin' ? 'admin' : 'receptionist', pass: body.password, active: 1 }); bump(); audit(session.username, 'kullanıcı_ekle', body.username); return { ok: true }; }
      case 'PUT /users/:id': { auth('admin'); const u = DB.users.find(x => x.id === +id); if (!u) throw new E(404, 'Kullanıcı yok'); const admins = DB.users.filter(x => x.role === 'admin' && x.active).length; const nr = body.role ? (body.role === 'admin' ? 'admin' : 'receptionist') : u.role; const na = body.active === undefined ? u.active : (body.active ? 1 : 0); if (u.role === 'admin' && admins <= 1 && (nr !== 'admin' || !na)) throw new E(409, 'Son aktif yönetici düşürülemez'); Object.assign(u, { name: body.name ?? u.name, role: nr, active: na }); if (body.password) u.pass = body.password; bump(); audit(session.username, 'kullanıcı_güncelle', u.username); return { ok: true }; }
      case 'DELETE /users/:id': { auth('admin'); if (session.id === +id) throw new E(409, 'Kendinizi silemezsiniz'); DB.users = DB.users.filter(u => u.id !== +id); bump(); return { ok: true }; }
      case 'GET /audit': auth('admin'); return DB.audit.slice(0, 500);
      case 'POST /backup': auth('admin'); audit(session.username, 'yedek_manuel', 'demo'); return { ok: true, file: 'DEMO/yedekler/Mesoft_Yedek_' + T + '.db (demo modunda gerçek dosya yazılmaz)' };
      case 'POST /reset': auth('admin'); DB.reservations = []; DB.payments = []; DB.minibar = []; DB.guests = []; DB.rooms = []; bump(); audit(session.username, 'sıfırlama', ''); return { ok: true };
      case 'POST /import': { auth('admin'); if (body.ics && body.roomId) { let added = 0, skipped = 0, cur = null; for (const line of String(body.ics).split(/\r?\n/)) { const l = line.trim(); if (l === 'BEGIN:VEVENT') cur = {}; else if (l === 'END:VEVENT' && cur) { const d = (v) => v && /^\d{8}/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null; const ci = d(cur.start), co = d(cur.end); if (!ci || !co || nightsBetween(ci, co) < 1 || co < today() || (cur.uid && DB.reservations.some(r => r.externalUid === cur.uid)) || conflict(body.roomId, ci, co, null)) skipped++; else { DB.reservations.push({ id: gid('REZ'), roomId: String(body.roomId), primaryName: cur.summary || 'Harici Rezervasyon', tc: '', phone: '', adultCount: 1, childCount: 0, allGuestsNames: cur.summary || 'Harici Rezervasyon', guestsJson: '[]', checkIn: ci, checkOut: co, totalPrice: 0, status: 'Rezerve', notes: 'iCal içe aktarım', source: 'iCal', createdBy: session.username, createdAt: now(), externalUid: cur.uid }); added++; } cur = null; } else if (cur) { const i = l.indexOf(':'); if (i > 0) { const k = l.slice(0, i).split(';')[0], v = l.slice(i + 1); if (k === 'UID') cur.uid = v; if (k === 'DTSTART') cur.start = v; if (k === 'DTEND') cur.end = v; if (k === 'SUMMARY') cur.summary = v; } } } bump(); return { ok: true, added, skipped }; } throw new E(400, 'Demo modunda JSON içe aktarım devre dışı'); }
      default: throw new E(404, 'Uç nokta bulunamadı: ' + route);
    }
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, opt = {}) => {
    const u = String(url); if (!u.includes('/api/')) return realFetch(url, opt);
    await new Promise(r => setTimeout(r, 40 + Math.random() * 60)); // ağ gecikmesi hissi
    let body = {}; try { body = opt.body ? JSON.parse(opt.body) : {}; } catch (_) {}
    try { const data = handle((opt.method || 'GET').toUpperCase(), u.slice(u.indexOf('/api/')), body); return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: e.status || 500, headers: { 'Content-Type': 'application/json' } }); }
  };
  window.open = (u) => { const t = /type=kbs/.test(u) ? 'KBS CSV' : /type=ical/.test(u) ? 'iCal (.ics)' : 'JSON yedek'; alert(`Demo modu: gerçek uygulamada burada ${t} dosyası indirilir.`); return null; };
  window.print = () => { const el = document.getElementById('printArea'); alert('Demo modu — 72 mm fiş içeriği:\n\n' + el.innerText.replace(/\n{3,}/g, '\n\n')); };
})();
