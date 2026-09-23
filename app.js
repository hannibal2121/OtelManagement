'use strict';
/* Mesoft Otel — Arayüz Mantığı v7 */

// ============ DURUM ============
const S = { rooms: [], guests: [], reservations: [], payments: [], minibar: [], settings: {}, users: [], me: null, revision: -1 };
let token = sessionStorage.getItem('ms_token') || null;
let desktopInfo = null;
let currentDetailRoomId = null, currentCheckoutRezId = null, confirmCb = null, monthDate = new Date(), quoteTimer = null, pollTimer = null, offline = false;
const isDesktop = !!window.mesoft;
const API = `${location.protocol === 'file:' ? 'http://127.0.0.1:8080' : location.origin}/api`;

// ============ YARDIMCILAR ============
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cur = () => S.settings.currency || '₺';
const money = (n) => `${cur()}${(parseFloat(n) || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`;
const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => localDate(new Date());
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return localDate(new Date(y, m - 1, d + n)); };
const nights = (a, b) => { const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number); return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000); };
const fmtDate = (s) => { if (!s) return '-'; const p = s.split('-'); return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : s; };
const fmtDT = (iso) => iso ? new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
const isAdmin = () => S.me && S.me.role === 'admin';
const room = (id) => S.rooms.find(r => String(r.id) === String(id));
const rez = (id) => S.reservations.find(r => r.id === id);
const activeRez = (roomId) => S.reservations.find(r => String(r.roomId) === String(roomId) && r.status === 'Dolu');
const statusBadge = (st) => `<span class="badge ${({ Dolu: 'badge-rose', Rezerve: 'badge-amber', Tamamlandı: 'badge-emerald', İptal: 'badge-slate', 'No-Show': 'badge-stone' })[st] || 'badge-slate'}">${esc(st)}</span>`;

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `${type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'} text-white px-4 py-3 rounded-xl shadow-2xl text-xs font-bold flex items-center space-x-2 transition-all duration-300 opacity-0 translate-y-2 pointer-events-auto`;
  el.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i><span>${esc(msg)}</span>`;
  $('toastContainer').appendChild(el);
  requestAnimationFrame(() => el.classList.remove('opacity-0', 'translate-y-2'));
  setTimeout(() => { el.classList.add('opacity-0'); setTimeout(() => el.remove(), 300); }, 3500);
}
const openModal = (id) => $(id).classList.remove('hidden');
const closeModal = (id) => $(id).classList.add('hidden');
function confirmAsk(title, message, cb) { $('confirmModalTitle').innerText = title; $('confirmModalMessage').innerText = message; confirmCb = cb; openModal('confirmModal'); }
function toggleMobileMenu(force) { const s = $('sidebarNav'), o = $('mobileOverlay'); const open = typeof force === 'boolean' ? force : s.classList.contains('-translate-x-full'); s.classList.toggle('-translate-x-full', !open); o.classList.toggle('hidden', !open); }
function toggleTheme() { const light = document.body.classList.toggle('light-theme'); localStorage.setItem('ms_theme', light ? 'light' : 'dark'); $('themeIcon').className = `fa-solid ${light ? 'fa-moon' : 'fa-sun'} text-base`; }
function download(name, content, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }

// ============ API ============
async function api(path, method = 'GET', body) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opt.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) opt.body = JSON.stringify(body);
  let res;
  try { res = await fetch(`${API}${path}`, opt); setOffline(false); }
  catch (e) { setOffline(true); throw new Error('Sunucuya ulaşılamıyor'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { logoutLocal(); throw new Error(data.error || 'Oturum süresi doldu'); }
  if (!res.ok) throw new Error(data.error || `Hata ${res.status}`);
  return data;
}
function setOffline(v) { if (offline === v) return; offline = v; $('offlineBanner').classList.toggle('hidden', !v); $('syncDot').className = `w-2 h-2 rounded-full inline-block ${v ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`; }
async function act(fn, okMsg) { try { const r = await fn(); if (okMsg) toast(okMsg); await refresh(true); return r; } catch (e) { toast(e.message, 'error'); return null; } }

async function refresh(force) {
  try {
    if (!force) { const { revision } = await api('/revision'); if (revision === S.revision) return; }
    const st = await api('/state');
    Object.assign(S, st);
    applyRole(); renderAll();
  } catch (e) { /* offline banner zaten gösteriliyor */ }
}
function startPolling() { clearInterval(pollTimer); pollTimer = setInterval(() => refresh(false), 3000); }

// ============ KİMLİK ============
function applyRole() {
  document.body.classList.toggle('is-admin', !!isAdmin());
  $('currentUserName').innerText = S.me ? `${S.me.name || S.me.username} (${S.me.role === 'admin' ? 'Yönetici' : 'Resepsiyon'})` : '-';
  $('currentUserBadge').classList.remove('hidden');
}
async function handleLogin(e) {
  e.preventDefault();
  $('loginBtn').disabled = true; $('loginError').classList.add('hidden');
  try {
    const r = await api('/login', 'POST', { username: $('loginUsername').value.trim(), password: $('loginPassword').value });
    token = r.token; sessionStorage.setItem('ms_token', token);
    $('loginOverlay').classList.add('hidden'); $('loginPassword').value = '';
    await refresh(true); startPolling();
    toast(`Hoş geldiniz, ${r.user.name || r.user.username}!`);
    if (r.forcePasswordChange) openChangePassword(true);
  } catch (err) { $('loginError').innerText = err.message; $('loginError').classList.remove('hidden'); }
  finally { $('loginBtn').disabled = false; }
}
function logoutLocal() { token = null; sessionStorage.removeItem('ms_token'); clearInterval(pollTimer); document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden')); S.me = null; S.revision = -1; $('loginOverlay').classList.remove('hidden'); $('loginUsername').focus(); }
function handleLogout() { confirmAsk('Oturum Kapatma', 'Oturumu kapatmak istiyor musunuz?', async () => { try { await api('/logout', 'POST'); } catch (_) {} logoutLocal(); }); }
function openChangePassword(force) { $('passwordForceNote').classList.toggle('hidden', !force); $('pwCancelBtn').classList.toggle('hidden', !!force); openModal('passwordModal'); }
async function handleChangePassword(e) {
  e.preventDefault();
  if ($('pw_next').value !== $('pw_next2').value) return toast('Yeni şifreler eşleşmiyor', 'error');
  const ok = await act(() => api('/me/password', 'POST', { current: $('pw_current').value, next: $('pw_next').value }), 'Şifre değiştirildi');
  if (ok) { closeModal('passwordModal'); e.target.reset(); }
}

// ============ SEKME ============
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.add('hidden'));
  document.querySelectorAll('.nav-btn').forEach(b => { b.className = 'nav-btn w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg text-slate-400 hover:bg-slate-800 font-medium transition' + (b.classList.contains('role-admin') ? ' role-admin' : ''); });
  $(`tab-${tab}`).classList.remove('hidden');
  const nb = document.querySelector(`.nav-btn[data-tab="${tab}"]`); if (nb) nb.className = nb.className.replace('text-slate-400 hover:bg-slate-800', 'bg-amber-500/10 text-amber-400 border border-amber-500/20');
  toggleMobileMenu(false);
  ({ reports: renderReports, monthly: renderMonthly, cash: renderCash, today: renderToday })[tab]?.();
}

// ============ RENDER ============
function renderAll() {
  loadHotelUI(); renderRoomsGrid(); renderStats(); renderToday(); renderGuestTable(); renderReservationTable();
  if (!$('tab-monthly').classList.contains('hidden')) renderMonthly();
  if (!$('tab-reports').classList.contains('hidden')) renderReports();
  if (!$('tab-cash').classList.contains('hidden')) renderCash();
  if (!$('roomDetailModal').classList.contains('hidden') && currentDetailRoomId) openRoomAction(currentDetailRoomId, true);
  if (!$('roomSettingsModal').classList.contains('hidden')) populateRoomSettingsTable();
  if (!$('usersModal').classList.contains('hidden')) renderUsers();
}
function loadHotelUI() {
  const n = S.settings.hotel_name || 'MESOFT BİLİŞİM';
  $('displayHotelName').innerText = n; $('loginHotelName').innerText = n; $('displayHotelSubtitle').innerText = S.settings.hotel_subtitle || '';
  $('headerHotelTitle').innerHTML = `<i class="fa-solid fa-building text-amber-500 me-1.5"></i>${esc(n)} Resepsiyon ${desktopInfo ? `<span class="text-slate-600">v${esc(desktopInfo.version)}</span>` : ''}`;
  document.title = `${n} - Otel Yönetim`;
}
function renderRoomsGrid() {
  const grid = $('roomsGrid'); grid.innerHTML = '';
  const f = $('roomFilter').value;
  const list = S.rooms.filter(r => !f || (f === 'Kirli' ? !r.clean && r.status !== 'Arızalı' : r.status === f));
  if (!S.rooms.length) { grid.innerHTML = '<div class="col-span-full p-8 text-center text-slate-500">Kayıtlı oda yok. Yönetici olarak <b class="text-amber-400">Odalar & Fiyatlar</b> menüsünden ekleyin.</div>'; return; }
  for (const r of list) {
    const ar = activeRez(r.id);
    let card, badge, line, extra = '';
    if (r.status === 'Arızalı') { card = 'bg-stone-950/40 border-stone-500/70 opacity-70'; badge = 'bg-stone-500'; line = '<i class="fa-solid fa-wrench me-1 text-stone-400"></i>Arızalı / Tadilatta'; }
    else if (r.status === 'Dolu' && ar) { card = 'bg-rose-950/30 border-rose-500/80 hover:border-rose-400'; badge = 'bg-rose-500'; line = `<i class="fa-solid fa-users me-1 text-amber-400"></i>${esc(ar.primaryName)}`; extra = `<span class="text-[10px] ${ar.checkOut <= todayStr() ? 'text-rose-300 font-bold' : 'text-slate-500'}">Çıkış: ${fmtDate(ar.checkOut)}${ar.remainingBalance > 0 ? ` • Kalan ${money(ar.remainingBalance)}` : ''}</span>`; }
    else if (!r.clean) { card = 'bg-amber-950/20 border-amber-500/60 hover:border-amber-400'; badge = 'bg-amber-500'; line = '<i class="fa-solid fa-broom me-1 text-amber-400"></i>Kirli — temizlik bekliyor'; }
    else { card = 'bg-emerald-950/20 border-emerald-500/70 hover:border-emerald-400'; badge = 'bg-emerald-500'; line = '<i class="fa-solid fa-bed me-1 text-emerald-400"></i>Müsait'; const next = S.reservations.filter(x => String(x.roomId) === String(r.id) && x.status === 'Rezerve' && x.checkIn >= todayStr()).sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0]; if (next) extra = `<span class="text-[10px] text-amber-400">${next.checkIn === todayStr() ? 'BUGÜN GİRİŞ' : 'Sonraki: ' + fmtDate(next.checkIn)} • ${esc(next.primaryName)}</span>`; }
    const el = document.createElement('div');
    el.className = `${card} border-2 rounded-2xl p-4 flex flex-col justify-between h-44 cursor-pointer transition hover:-translate-y-0.5 shadow-lg`;
    el.onclick = () => openRoomAction(r.id);
    el.innerHTML = `<div class="flex justify-between items-start"><div><span class="text-[10px] text-slate-400 font-mono">ODA</span><h3 class="text-2xl font-black">${esc(r.id)}</h3></div><span class="px-2.5 py-0.5 rounded-full text-[10px] uppercase font-black text-slate-950 ${badge}">${r.status === 'Dolu' ? 'DOLU' : r.status === 'Arızalı' ? 'ARIZALI' : (!r.clean ? 'KİRLİ' : 'BOŞ')}</span></div>
      <div><p class="text-[11px] text-slate-300 truncate">${esc(r.type)} • ${r.capacity || 2} kişi</p><p class="text-xs font-bold text-amber-400">${money(r.price)} <span class="text-[10px] text-slate-500 font-normal">/${S.settings.pricing_mode === 'per_person' ? 'kişi' : 'gece'}</span></p></div>
      <div class="border-t border-slate-800/80 pt-2 text-[11px] text-slate-300 truncate font-medium flex flex-col">${line}${extra}</div>`;
    grid.appendChild(el);
  }
}
function renderStats() {
  const total = S.rooms.length, occ = S.rooms.filter(r => r.status === 'Dolu').length, broken = S.rooms.filter(r => r.status === 'Arızalı').length, dirty = S.rooms.filter(r => !r.clean && r.status !== 'Arızalı').length;
  const vac = Math.max(0, total - occ - broken), rate = total - broken > 0 ? Math.round(occ / (total - broken) * 100) : 0;
  const t = todayStr();
  const arrivals = S.reservations.filter(r => r.status === 'Rezerve' && r.checkIn === t).length, departures = S.reservations.filter(r => r.status === 'Dolu' && r.checkOut <= t).length;
  const todayPay = S.payments.filter(p => p.createdAt && p.createdAt.slice(0, 10) === new Date().toISOString().slice(0, 10) || (p.createdAt && localDate(new Date(p.createdAt)) === t)).reduce((a, p) => a + (p.type === 'İade' ? -p.amount : p.amount), 0);
  $('totalRoomsBadge').innerText = `${total} Oda`; $('occupancyRate').innerText = `${rate}%`; $('occupancyBar').style.width = `${rate}%`;
  $('statOccupied').innerText = occ; $('statVacant').innerText = vac; $('statDirty').innerText = dirty;
  $('dashVacant').innerText = `${vac} Oda`; $('dashOccupied').innerText = `${occ} Oda`; $('dashToday').innerText = `${arrivals} / ${departures}`; $('dashRevenue').innerText = money(todayPay);
  const tb = $('todayBadge'); tb.innerText = arrivals + departures; tb.classList.toggle('hidden', !(arrivals + departures));
}
function renderToday() {
  const t = todayStr();
  const item = (r, btn) => `<div class="flex justify-between items-center bg-slate-950 border border-slate-800 rounded-lg p-2"><div><b class="text-amber-400">Oda ${esc(r.roomId)}</b> • ${esc(r.primaryName)}<div class="text-[10px] text-slate-500">${fmtDate(r.checkIn)} → ${fmtDate(r.checkOut)} • ${esc(r.phone || '')}${r.remainingBalance > 0 ? ` • Kalan <b class="text-rose-400">${money(r.remainingBalance)}</b>` : ''}</div></div>${btn}</div>`;
  const arr = S.reservations.filter(r => r.status === 'Rezerve' && r.checkIn <= t).sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  $('todayArrivals').innerHTML = arr.length ? arr.map(r => item(r, `<button onclick="doCheckin('${esc(r.id)}')" class="btn btn-emerald !py-1">Check-in</button>`)).join('') : '<p class="text-slate-500 italic">Bekleyen giriş yok</p>';
  const dep = S.reservations.filter(r => r.status === 'Dolu' && r.checkOut <= t);
  $('todayDepartures').innerHTML = dep.length ? dep.map(r => item(r, `<button onclick="openCheckout('${esc(r.id)}')" class="btn btn-rose !py-1">Check-out</button>`)).join('') : '<p class="text-slate-500 italic">Bekleyen çıkış yok</p>';
  const dirty = S.rooms.filter(r => !r.clean && r.status !== 'Arızalı');
  $('todayDirty').innerHTML = dirty.length ? dirty.map(r => `<div class="flex justify-between items-center bg-slate-950 border border-slate-800 rounded-lg p-2"><span><b class="text-amber-400">Oda ${esc(r.id)}</b> • ${esc(r.type)}${r.status === 'Dolu' ? ' <span class="text-[10px] text-rose-400">(dolu)</span>' : ''}</span><button onclick="setClean('${esc(r.id)}',true)" class="btn btn-emerald !py-1"><i class="fa-solid fa-check me-1"></i>Temizlendi</button></div>`).join('') : '<p class="text-slate-500 italic">Tüm odalar temiz</p>';
}
function renderGuestTable() {
  const q = ($('guestSearchInput').value || '').toLowerCase().replace(/\s/g, '');
  const rows = S.guests.filter(g => !q || `${g.name}${g.tc}${g.phone}${g.email}`.toLowerCase().replace(/\s/g, '').includes(q));
  $('guestTableBody').innerHTML = rows.map(g => `<tr class="hover:bg-slate-800/30"><td class="p-3 font-semibold">${esc(g.name)}</td><td class="p-3 font-mono text-slate-400">${esc(g.tc || '-')}</td><td class="p-3">${esc(g.phone || '-')}</td><td class="p-3 text-slate-400">${esc(g.nationality || 'TC')}${g.birthDate ? ' • ' + fmtDate(g.birthDate) : ''}</td><td class="p-3"><span class="badge badge-amber">${g.visits || 1} Kez</span></td><td class="p-3 text-slate-400 truncate max-w-[200px]">${esc(g.notes || '-')}</td>
    <td class="p-3 text-right space-x-1 whitespace-nowrap"><button onclick="openEditGuest('${esc(g.key)}')" class="btn btn-sky !py-1"><i class="fa-solid fa-pen"></i></button><button onclick="bookForGuest('${esc(g.key)}')" class="btn btn-amber !py-1">Oda Ver</button><button onclick="deleteGuest('${esc(g.key)}')" class="btn btn-rose !py-1 role-admin inline-flex"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('') || '<tr><td colspan="7" class="p-4 text-center text-slate-500">Kayıt yok</td></tr>';
}
function rezActions(r) {
  const b = [];
  if (r.status === 'Rezerve' && r.checkIn <= todayStr()) b.push(`<button onclick="doCheckin('${esc(r.id)}')" class="btn btn-emerald !py-1" title="Check-in"><i class="fa-solid fa-arrow-right-to-bracket"></i></button>`);
  if (r.status === 'Dolu') b.push(`<button onclick="openCheckout('${esc(r.id)}')" class="btn btn-rose !py-1" title="Check-out"><i class="fa-solid fa-cash-register"></i></button>`);
  if (['Rezerve', 'Dolu'].includes(r.status)) b.push(`<button onclick="openEditRez('${esc(r.id)}')" class="btn btn-sky !py-1" title="Düzenle"><i class="fa-solid fa-pen"></i></button><button onclick="cancelRez('${esc(r.id)}')" class="btn btn-ghost !py-1" title="İptal / No-Show"><i class="fa-solid fa-ban"></i></button>`);
  if (r.status !== 'Rezerve') b.push(`<button onclick="printReceipt('${esc(r.id)}')" class="btn btn-ghost !py-1" title="Fiş"><i class="fa-solid fa-print"></i></button>`);
  b.push(`<button onclick="deleteRez('${esc(r.id)}')" class="btn btn-ghost !py-1 text-rose-400 role-admin inline-flex" title="Kalıcı sil"><i class="fa-solid fa-trash"></i></button>`);
  return b.join('');
}
function renderReservationTable() {
  const q = ($('rezSearch').value || '').toLowerCase(), f = $('rezStatusFilter').value;
  const rows = S.reservations.filter(r => (f === '*' || (f ? r.status === f : ['Rezerve', 'Dolu'].includes(r.status))) && (!q || `${r.primaryName} ${r.allGuestsNames} ${r.roomId} ${r.phone} ${r.id}`.toLowerCase().includes(q))).sort((a, b) => (b.checkIn || '').localeCompare(a.checkIn || ''));
  $('reservationTableBody').innerHTML = rows.map(r => `<tr class="hover:bg-slate-800/30"><td class="p-3 font-bold text-amber-500">Oda ${esc(r.roomId)}</td><td class="p-3"><p class="font-medium">${esc(r.allGuestsNames || r.primaryName)}</p><p class="text-[10px] text-slate-500">${esc(r.phone || '')} • ${esc(r.id)}</p></td><td class="p-3">${fmtDate(r.checkIn)} → ${fmtDate(r.checkOut)}<div class="text-[10px] text-slate-500">${nights(r.checkIn, r.checkOut)} gece</div></td><td class="p-3 font-bold text-emerald-400">${money(r.grandTotal)}</td><td class="p-3 text-amber-400">${money(r.collectedTotal)}</td><td class="p-3 font-bold ${r.remainingBalance > 0 ? 'text-rose-400' : 'text-slate-500'}">${money(r.remainingBalance)}</td><td class="p-3 text-slate-400">${esc(r.source || '-')}</td><td class="p-3">${statusBadge(r.status)}</td><td class="p-3 text-right whitespace-nowrap space-x-1">${rezActions(r)}</td></tr>`).join('') || '<tr><td colspan="9" class="p-4 text-center text-slate-500">Kayıt yok</td></tr>';
}

// ============ ODA DETAY ============
function openRoomAction(roomId, silent) {
  const r = room(roomId); if (!r) return;
  currentDetailRoomId = roomId;
  const ar = activeRez(roomId);
  $('detailRoomTitle').innerText = `Oda ${r.id} (${r.type})`; $('detailRoomSub').innerText = `Kapasite ${r.capacity || 2} • ${r.floor ? 'Kat ' + r.floor + ' • ' : ''}${r.notes || ''}`;
  const sb = $('detailRoomStatusBadge');
  if (r.status === 'Arızalı') { sb.innerText = 'Arızalı / Tadilatta'; sb.className = 'badge badge-stone'; } else if (ar) { sb.innerText = 'Dolu'; sb.className = 'badge badge-rose'; } else { sb.innerText = 'Boş (Müsait)'; sb.className = 'badge badge-emerald'; }
  $('detailCleanBadge').innerText = r.clean ? 'Temiz' : 'Kirli'; $('detailCleanBadge').className = `badge ${r.clean ? 'badge-emerald' : 'badge-amber'}`;
  $('detailRoomPriceText').innerText = `${money(r.price)} / ${S.settings.pricing_mode === 'per_person' ? 'kişi' : 'gece'}${r.extraPersonPrice ? ` • Ek kişi ${money(r.extraPersonPrice)}` : ''}`;
  $('detailGuestInfo').innerHTML = ar ? `<p><b>${esc(ar.allGuestsNames || ar.primaryName)}</b> • ${esc(ar.phone || '')}</p><p class="text-slate-400">${fmtDate(ar.checkIn)} → ${fmtDate(ar.checkOut)} (${nights(ar.checkIn, ar.checkOut)} gece) • Giriş: ${fmtDT(ar.checkedInAt)}</p>${ar.notes ? `<p class="text-amber-400/80 italic">${esc(ar.notes)}</p>` : ''}` : '';

  const acts = [];
  if (ar) {
    acts.push(`<button onclick="openCheckout('${esc(ar.id)}')" class="btn btn-emerald"><i class="fa-solid fa-cash-register me-1"></i>Çıkış & Tahsilat (${money(ar.remainingBalance)})</button>`);
    acts.push(`<button onclick="openEditRez('${esc(ar.id)}')" class="btn btn-sky"><i class="fa-solid fa-user-pen me-1"></i>Düzenle</button>`);
    acts.push(`<button onclick="printReceipt('${esc(ar.id)}')" class="btn btn-ghost"><i class="fa-solid fa-print me-1"></i>Ara Fiş</button>`);
  } else {
    const pending = S.reservations.find(x => String(x.roomId) === String(roomId) && x.status === 'Rezerve' && x.checkIn <= todayStr());
    if (pending && r.status !== 'Arızalı') acts.push(`<button onclick="doCheckin('${esc(pending.id)}')" class="btn btn-emerald"><i class="fa-solid fa-arrow-right-to-bracket me-1"></i>Check-in: ${esc(pending.primaryName)}</button>`);
    if (r.status !== 'Arızalı') acts.push(`<button onclick="closeModal('roomDetailModal'); openNewBookingModal('${esc(r.id)}')" class="btn btn-amber"><i class="fa-solid fa-calendar-plus me-1"></i>Yeni Rezervasyon</button>`);
    acts.push(`<button onclick="setRoomStatus('${esc(r.id)}','${r.status === 'Arızalı' ? 'Boş' : 'Arızalı'}')" class="btn btn-ghost"><i class="fa-solid fa-wrench me-1"></i>${r.status === 'Arızalı' ? 'Arıza Giderildi' : 'Arızaya Al'}</button>`);
  }
  acts.push(`<button onclick="setClean('${esc(r.id)}',${r.clean ? 'false' : 'true'})" class="btn ${r.clean ? 'btn-ghost' : 'btn-amber'}"><i class="fa-solid fa-broom me-1"></i>${r.clean ? 'Kirli İşaretle' : 'Temizlendi'}</button>`);
  if (!ar) acts.push(`<button onclick="deleteRoom('${esc(r.id)}')" class="btn btn-rose role-admin inline-flex">Odayı Sil</button>`);
  $('detailRoomActions').innerHTML = acts.join('');

  $('folioSection').classList.toggle('hidden', !ar);
  if (ar) {
    const items = S.minibar.filter(m => m.reservationId === ar.id), pays = S.payments.filter(p => p.reservationId === ar.id);
    $('detailMinibarTotalText').innerText = money(ar.minibarTotal);
    $('minibarItemsList').innerHTML = items.map(m => `<div class="flex justify-between items-center bg-slate-900 p-2 rounded-lg border border-slate-800"><span>${esc(m.name)} ${m.qty > 1 ? `× ${m.qty}` : ''} <span class="text-slate-500 text-[10px]">${fmtDT(m.createdAt)}</span></span><span class="flex items-center gap-2"><b class="text-amber-400 font-mono">${money(m.price * (m.qty || 1))}</b><button onclick="removeMinibar(${m.id})" class="text-rose-400"><i class="fa-solid fa-xmark"></i></button></span></div>`).join('') || '<p class="text-slate-500 italic">Harcama yok</p>';
    $('detailBalanceText').innerHTML = `Kalan: <span class="${ar.remainingBalance > 0 ? 'text-rose-400' : 'text-emerald-400'}">${money(ar.remainingBalance)}</span>`;
    $('folioSummary').innerHTML = [['Oda', ar.totalPrice, 'text-slate-200'], ['Minibar', ar.minibarTotal, 'text-sky-400'], ['Tahsil', ar.collectedTotal, 'text-emerald-400']].map(([l, v, c]) => `<div class="bg-slate-900 rounded-lg p-2"><div class="text-[10px] text-slate-500">${l}</div><b class="${c}">${money(v)}</b></div>`).join('');
    $('paymentsList').innerHTML = pays.map(p => `<div class="flex justify-between items-center bg-slate-900 p-2 rounded-lg border border-slate-800"><span>${esc(p.type)} • ${esc(p.method)} <span class="text-slate-500 text-[10px]">${fmtDT(p.createdAt)} ${esc(p.createdBy || '')}</span></span><span class="flex items-center gap-2"><b class="${p.type === 'İade' ? 'text-rose-400' : 'text-emerald-400'} font-mono">${p.type === 'İade' ? '-' : ''}${money(p.amount)}</b><button onclick="deletePayment(${p.id})" class="text-rose-400 role-admin inline-flex"><i class="fa-solid fa-xmark"></i></button></span></div>`).join('') || '<p class="text-slate-500 italic">Ödeme yok</p>';
    $('payAmount').placeholder = `Kalan ${money(ar.remainingBalance)}`;
  }

  const grid = $('roomCalendarGrid'); grid.innerHTML = '';
  const roomRez = S.reservations.filter(x => String(x.roomId) === String(roomId) && ['Rezerve', 'Dolu'].includes(x.status));
  for (let i = 0; i < 30; i++) {
    const ds = addDays(todayStr(), i); const [y, m, d] = ds.split('-').map(Number); const dt = new Date(y, m - 1, d);
    const mr = roomRez.find(x => ds >= x.checkIn && ds < x.checkOut);
    const c = document.createElement('div');
    c.className = `rounded-xl p-2 text-center cursor-pointer border ${mr ? (mr.status === 'Dolu' ? 'bg-rose-500/20 border-rose-500/40' : 'bg-amber-500/20 border-amber-500/40') : 'bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20'}`;
    c.innerHTML = `<p class="font-bold text-[11px]">${d} ${dt.toLocaleDateString('tr-TR', { month: 'short' })}</p><span class="text-[9px] block truncate">${mr ? esc(mr.primaryName) : 'Müsait'}</span>`;
    c.title = mr ? `${mr.primaryName} • ${fmtDate(mr.checkIn)} → ${fmtDate(mr.checkOut)}` : 'Rezervasyon oluştur';
    c.onclick = () => { if (mr) openEditRez(mr.id); else { closeModal('roomDetailModal'); openNewBookingModal(roomId, ds); } };
    grid.appendChild(c);
  }
  const all = S.reservations.filter(x => String(x.roomId) === String(roomId)).sort((a, b) => (b.checkIn || '').localeCompare(a.checkIn || ''));
  $('detailRoomReservationTable').innerHTML = all.map(x => `<tr class="hover:bg-slate-800/30"><td class="p-3 font-semibold">${esc(x.allGuestsNames || x.primaryName)}</td><td class="p-3">${fmtDate(x.checkIn)} → ${fmtDate(x.checkOut)}</td><td class="p-3 text-emerald-400 font-bold">${money(x.grandTotal)}</td><td class="p-3 text-amber-400">${money(x.collectedTotal)}</td><td class="p-3 ${x.remainingBalance > 0 ? 'text-rose-400 font-bold' : 'text-slate-500'}">${money(x.remainingBalance)}</td><td class="p-3">${statusBadge(x.status)}</td><td class="p-3 text-right whitespace-nowrap space-x-1">${rezActions(x)}</td></tr>`).join('') || '<tr><td colspan="7" class="p-4 text-center text-slate-500">Rezervasyon yok</td></tr>';
  if (!silent) openModal('roomDetailModal');
}
const setClean = (id, c) => act(() => api(`/rooms/${encodeURIComponent(id)}/clean`, 'POST', { clean: c }), c ? 'Oda temiz olarak işaretlendi' : 'Oda kirli olarak işaretlendi');
const setRoomStatus = (id, status) => act(() => api(`/rooms/${encodeURIComponent(id)}/status`, 'POST', { status }), `Oda durumu: ${status}`);
function deleteRoom(id) { confirmAsk('Oda Silme', `Oda ${id} silinecek. Emin misiniz?`, async () => { if (await act(() => api(`/rooms/${encodeURIComponent(id)}`, 'DELETE'), 'Oda silindi')) closeModal('roomDetailModal'); }); }
async function addMinibar() {
  const ar = activeRez(currentDetailRoomId); if (!ar) return;
  const name = $('minibarItemName').value.trim(), price = parseFloat($('minibarItemPrice').value), qty = parseInt($('minibarItemQty').value, 10) || 1;
  if (!name || !(price > 0)) return toast('Ürün adı ve tutar girin', 'error');
  if (await act(() => api(`/reservations/${ar.id}/minibar`, 'POST', { name, price, qty }), `"${name}" eklendi`)) { $('minibarItemName').value = ''; $('minibarItemPrice').value = ''; $('minibarItemQty').value = 1; }
}
const removeMinibar = (id) => act(() => api(`/minibar/${id}`, 'DELETE'), 'Minibar kalemi silindi');
async function addPayment() {
  const ar = activeRez(currentDetailRoomId); if (!ar) return;
  const amount = parseFloat($('payAmount').value); if (!(amount > 0)) return toast('Tutar girin', 'error');
  if (await act(() => api('/payments', 'POST', { reservationId: ar.id, amount, method: $('payMethod').value, type: $('payType').value }), 'Ödeme kaydedildi')) $('payAmount').value = '';
}
function deletePayment(id) { confirmAsk('Ödeme Sil', 'Bu ödeme kaydı silinecek.', () => act(() => api(`/payments/${id}`, 'DELETE'), 'Ödeme silindi')); }

// ============ CHECK-IN / OUT / İPTAL ============
const doCheckin = (id) => act(() => api(`/reservations/${id}/checkin`, 'POST'), 'Check-in yapıldı');
function cancelRez(id) {
  const r = rez(id); if (!r) return;
  confirmAsk('İptal / No-Show', `${r.primaryName} — Oda ${r.roomId}\n\n"Onayla" = İptal. Misafir gelmedi ise sonraki soruda No-Show seçin.`, async () => {
    confirmAsk('Tür', 'Misafir hiç gelmedi mi? (Onayla = No-Show, İptal = normal iptal)', () => act(() => api(`/reservations/${id}/noshow`, 'POST'), 'No-Show olarak işaretlendi'));
    $('confirmModalCancelBtn').onclick = () => { closeModal('confirmModal'); confirmCb = null; act(() => api(`/reservations/${id}/cancel`, 'POST'), 'Rezervasyon iptal edildi'); bindConfirmButtons(); };
  });
}
function deleteRez(id) { confirmAsk('Kalıcı Silme', 'Rezervasyon, ödemeleri ve minibar kayıtları kalıcı olarak silinir. Raporları etkiler!', () => act(() => api(`/reservations/${id}`, 'DELETE'), 'Kayıt silindi')); }
function openCheckout(id) {
  const r = rez(id); if (!r) return; currentCheckoutRezId = id;
  $('checkoutSummary').innerHTML = `<div class="flex justify-between"><span>Oda ${esc(r.roomId)} • ${esc(r.primaryName)}</span><span>${fmtDate(r.checkIn)} → ${fmtDate(r.checkOut)}</span></div><div class="flex justify-between text-slate-400"><span>Konaklama</span><span>${money(r.totalPrice)}</span></div><div class="flex justify-between text-slate-400"><span>Minibar</span><span>${money(r.minibarTotal)}</span></div><div class="flex justify-between text-slate-400"><span>Tahsil edilen</span><span>-${money(r.collectedTotal)}</span></div><div class="flex justify-between font-black text-base border-t border-slate-800 pt-1 mt-1"><span>KALAN</span><span class="${r.remainingBalance > 0 ? 'text-rose-400' : 'text-emerald-400'}">${money(r.remainingBalance)}</span></div>`;
  $('checkoutPayments').innerHTML = ''; $('checkoutWarning').classList.add('hidden');
  if (r.remainingBalance > 0) addCheckoutPayRow(r.remainingBalance);
  openModal('checkoutModal');
}
function addCheckoutPayRow(amount) { const d = document.createElement('div'); d.className = 'grid grid-cols-3 gap-2 co-row'; d.innerHTML = `<input type="number" min="0" step="0.01" value="${amount || ''}" placeholder="Tutar" class="inp co-amt"><select class="inp co-method"><option>Nakit</option><option>Kart</option><option>Havale</option></select><button onclick="this.parentElement.remove()" class="btn btn-ghost"><i class="fa-solid fa-xmark"></i></button>`; $('checkoutPayments').appendChild(d); }
async function confirmCheckout() {
  const r = rez(currentCheckoutRezId); if (!r) return;
  const payments = [...document.querySelectorAll('.co-row')].map(x => ({ amount: parseFloat(x.querySelector('.co-amt').value) || 0, method: x.querySelector('.co-method').value })).filter(p => p.amount > 0);
  const sum = payments.reduce((a, p) => a + p.amount, 0);
  if (Math.abs(sum - r.remainingBalance) > 0.01) {
    const w = $('checkoutWarning'); w.classList.remove('hidden');
    if (w.dataset.ack !== currentCheckoutRezId) { w.innerText = sum < r.remainingBalance ? `Dikkat: ${money(r.remainingBalance - sum)} eksik tahsilat. Tekrar "Çıkışı Tamamla"ya basarsanız kalan borç açık kalır.` : `Dikkat: ${money(sum - r.remainingBalance)} fazla tahsilat. Tekrar basarsanız kaydedilir.`; w.dataset.ack = currentCheckoutRezId; return; }
  }
  $('checkoutWarning').dataset.ack = '';
  if (await act(() => api(`/reservations/${r.id}/checkout`, 'POST', { payments }), 'Çıkış tamamlandı, oda temizliğe alındı')) { closeModal('checkoutModal'); closeModal('roomDetailModal'); setTimeout(() => confirmAsk('Fiş', 'Konaklama fişi yazdırılsın mı?', () => printReceipt(r.id)), 300); }
}

// ============ REZERVASYON FORMU ============
function populateRoomSelect(sel, selectedId) { sel.innerHTML = S.rooms.filter(r => r.status !== 'Arızalı').map(r => `<option value="${esc(r.id)}" ${String(r.id) === String(selectedId) ? 'selected' : ''}>Oda ${esc(r.id)} — ${esc(r.type)} (${money(r.price)}) [${r.status}]</option>`).join(''); }
function firstFreeDates(roomId) {
  const rr = S.reservations.filter(r => String(r.roomId) === String(roomId) && ['Rezerve', 'Dolu'].includes(r.status));
  for (let i = 0; i < 180; i++) { const ci = addDays(todayStr(), i); if (!rr.some(r => ci >= r.checkIn && ci < r.checkOut)) return { checkIn: ci, checkOut: addDays(ci, 1) }; }
  return { checkIn: todayStr(), checkOut: addDays(todayStr(), 1) };
}
function openNewBookingModal(roomId, preferredCheckIn, guest) {
  if (!S.rooms.length) return toast('Önce oda ekleyin', 'error');
  $('bookingForm').reset(); $('additionalGuestsContainer').innerHTML = ''; $('g1_nat').value = 'TC'; $('modalAdvancePaymentInput').value = 0;
  const rid = roomId || S.rooms.find(r => r.status === 'Boş')?.id || S.rooms[0].id;
  populateRoomSelect($('modalRoomSelect'), rid);
  const d = preferredCheckIn ? { checkIn: preferredCheckIn, checkOut: addDays(preferredCheckIn, 1) } : firstFreeDates(rid);
  $('modalCheckIn').value = d.checkIn; $('modalCheckOut').value = d.checkOut; $('modalCheckIn').min = todayStr();
  if (guest) { $('g1_tc').value = guest.tc || ''; $('g1_name').value = guest.name || ''; $('g1_phone').value = guest.phone || ''; $('g1_email').value = guest.email || ''; $('g1_birth').value = guest.birthDate || ''; $('g1_nat').value = guest.nationality || 'TC'; }
  requestQuote(); openModal('bookingModal');
}
function bookForGuest(key) { const g = S.guests.find(x => x.key === key); switchTab('rooms'); openNewBookingModal(null, null, g); }
function handleModalRoomChange() { const d = firstFreeDates($('modalRoomSelect').value); $('modalCheckIn').value = d.checkIn; $('modalCheckOut').value = d.checkOut; requestQuote(); }
function requestQuote() {
  clearTimeout(quoteTimer);
  quoteTimer = setTimeout(async () => {
    const roomId = $('modalRoomSelect').value, checkIn = $('modalCheckIn').value, checkOut = $('modalCheckOut').value;
    if (!roomId || !checkIn || !checkOut || nights(checkIn, checkOut) < 1) { $('calculatedNights').innerText = 'Geçersiz tarih'; $('modalTotalPriceInput').value = 0; return updateBalance(); }
    try {
      const q = await api('/quote', 'POST', { roomId, checkIn, checkOut, adultCount: $('modalAdultCount').value, childCount: $('modalChildCount').value });
      $('calculatedNights').innerText = `${q.nights} gece • ${$('modalAdultCount').value} yet. + ${$('modalChildCount').value} çoc. → ${money(q.total)}` + (q.breakdown.some(b => b.price !== q.breakdown[0].price) ? ' (değişken gecelik)' : '');
      $('modalTotalPriceInput').value = q.total;
      const conflict = S.reservations.find(r => String(r.roomId) === String(roomId) && ['Rezerve', 'Dolu'].includes(r.status) && checkIn < r.checkOut && checkOut > r.checkIn);
      $('bookingSubmitBtn').disabled = !!conflict && S.settings.allow_overbooking !== '1';
      if (conflict) { $('calculatedNights').innerText = `ÇAKIŞMA: ${conflict.primaryName} (${fmtDate(conflict.checkIn)} → ${fmtDate(conflict.checkOut)})`; $('calculatedNights').className = 'text-rose-400 font-bold'; } else $('calculatedNights').className = 'text-amber-400 font-bold';
    } catch (e) { $('calculatedNights').innerText = e.message; }
    updateBalance();
  }, 250);
}
function updateBalance() { const t = parseFloat($('modalTotalPriceInput').value) || 0, a = parseFloat($('modalAdvancePaymentInput').value) || 0; $('modalRemainingBalanceInput').value = Math.max(0, t - a).toFixed(2); }
function updateGuestInputFields() {
  const n = parseInt($('modalAdultCount').value, 10) || 1, c = $('additionalGuestsContainer'); c.innerHTML = '';
  for (let i = 2; i <= n; i++) c.insertAdjacentHTML('beforeend', `<div class="bg-slate-950/60 p-3 rounded-xl border border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-2 relative"><span class="col-span-full text-[11px] font-bold text-slate-400">${i}. Misafir (KBS için önerilir)</span><div class="relative"><input type="text" id="g${i}_tc" placeholder="Kimlik No" oninput="suggestGuest(this.value,${i})" class="inp"><div id="suggest${i}" class="absolute left-0 right-0 top-full mt-1 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-20 max-h-40 overflow-y-auto hidden"></div></div><input type="text" id="g${i}_name" placeholder="Ad Soyad" oninput="suggestGuest(this.value,${i})" class="inp"><input type="date" id="g${i}_birth" class="inp"><input type="text" id="g${i}_nat" value="TC" maxlength="3" placeholder="Uyruk" class="inp uppercase"></div>`);
}
function suggestGuest(q, idx) {
  const box = $(`suggest${idx}`); if (!box) return; q = q.trim().toLowerCase().replace(/\s/g, '');
  if (q.length < 2) return box.classList.add('hidden');
  const m = S.guests.filter(g => `${g.name}`.toLowerCase().replace(/\s/g, '').includes(q) || (g.tc || '').includes(q) || (g.phone || '').replace(/\s/g, '').includes(q)).slice(0, 8);
  if (!m.length) return box.classList.add('hidden');
  box.innerHTML = m.map(g => `<div onclick="pickGuest('${esc(g.key)}',${idx})" class="p-2.5 hover:bg-amber-500/20 cursor-pointer border-b border-slate-800/80 flex justify-between text-xs"><div><p class="font-bold">${esc(g.name)}</p><p class="text-[10px] text-slate-400 font-mono">${esc(g.tc || '-')} • ${esc(g.phone || '-')}</p></div><span class="badge badge-amber">${g.visits || 1}×</span></div>`).join('');
  box.classList.remove('hidden');
}
function pickGuest(key, idx) {
  const g = S.guests.find(x => x.key === key); if (!g) return;
  const set = (id, v) => { const el = $(id); if (el) el.value = v || ''; };
  set(`g${idx}_tc`, g.tc); set(`g${idx}_name`, g.name); set(`g${idx}_birth`, g.birthDate); set(`g${idx}_nat`, g.nationality || 'TC');
  if (idx === 1) { set('g1_phone', g.phone); set('g1_email', g.email); if (g.notes) $('modalNotes').value = g.notes; }
  $(`suggest${idx}`).classList.add('hidden'); toast(`Misafir seçildi: ${g.name}`);
}
async function handleSaveBooking(e) {
  e.preventDefault();
  const n = parseInt($('modalAdultCount').value, 10) || 1, guests = [];
  for (let i = 1; i <= n; i++) { const name = ($(`g${i}_name`)?.value || '').trim(); if (!name) continue; guests.push({ name, tc: $(`g${i}_tc`)?.value, phone: i === 1 ? $('g1_phone').value : '', email: i === 1 ? $('g1_email').value : '', birthDate: $(`g${i}_birth`)?.value, nationality: ($(`g${i}_nat`)?.value || 'TC').toUpperCase() }); }
  const body = { roomId: $('modalRoomSelect').value, checkIn: $('modalCheckIn').value, checkOut: $('modalCheckOut').value, adultCount: n, childCount: parseInt($('modalChildCount').value, 10) || 0, guests, notes: $('modalNotes').value, source: $('modalSource').value, totalPrice: parseFloat($('modalTotalPriceInput').value) || 0, advancePayment: parseFloat($('modalAdvancePaymentInput').value) || 0, advanceMethod: $('modalAdvanceMethod').value };
  const r = await act(() => api('/reservations', 'POST', body));
  if (r) { closeModal('bookingModal'); toast(r.status === 'Dolu' ? `Check-in yapıldı — Oda ${body.roomId}` : `Rezervasyon oluşturuldu — Oda ${body.roomId}`); }
}
function openEditRez(id) {
  const r = rez(id); if (!r) return;
  $('er_id').value = id; populateRoomSelect($('er_room'), r.roomId); $('er_in').value = r.checkIn; $('er_out').value = r.checkOut; $('er_name').value = r.primaryName; $('er_tc').value = r.tc || ''; $('er_phone').value = r.phone || ''; $('er_adult').value = r.adultCount || 1; $('er_child').value = r.childCount || 0; $('er_total').value = r.totalPrice; $('er_notes').value = r.notes || '';
  $('er_in').disabled = r.status === 'Dolu'; openModal('editRezModal');
}
async function handleSaveEditedRez(e) {
  e.preventDefault(); const id = $('er_id').value;
  if (await act(() => api(`/reservations/${id}`, 'PUT', { roomId: $('er_room').value, checkIn: $('er_in').value, checkOut: $('er_out').value, primaryName: $('er_name').value, tc: $('er_tc').value, phone: $('er_phone').value, adultCount: $('er_adult').value, childCount: $('er_child').value, totalPrice: $('er_total').value, notes: $('er_notes').value }), 'Rezervasyon güncellendi')) closeModal('editRezModal');
}

// ============ MİSAFİR ============
function openEditGuest(key) { const g = S.guests.find(x => x.key === key); if (!g) return; $('eg_key').value = key; $('eg_name').value = g.name; $('eg_tc').value = g.tc || ''; $('eg_phone').value = g.phone || ''; $('eg_email').value = g.email || ''; $('eg_birth').value = g.birthDate || ''; $('eg_nat').value = g.nationality || 'TC'; $('eg_gender').value = g.gender || ''; $('eg_notes').value = g.notes || ''; openModal('editGuestModal'); }
async function handleSaveEditedGuest(e) { e.preventDefault(); if (await act(() => api(`/guests/${encodeURIComponent($('eg_key').value)}`, 'PUT', { name: $('eg_name').value, tc: $('eg_tc').value, phone: $('eg_phone').value, email: $('eg_email').value, birthDate: $('eg_birth').value, nationality: $('eg_nat').value.toUpperCase(), gender: $('eg_gender').value, notes: $('eg_notes').value }), 'Müşteri güncellendi')) closeModal('editGuestModal'); }
function deleteGuest(key) { confirmAsk('Müşteri Silme', 'Bu müşteri kaydı silinecek (rezervasyon geçmişi kalır).', () => act(() => api(`/guests/${encodeURIComponent(key)}`, 'DELETE'), 'Müşteri silindi')); }

// ============ AYLIK GANTT ============
function changeMonth(d) { monthDate = d === 0 ? new Date() : new Date(monthDate.getFullYear(), monthDate.getMonth() + d, 1); renderMonthly(); }
function renderMonthly() {
  const y = monthDate.getFullYear(), m = monthDate.getMonth(), dim = new Date(y, m + 1, 0).getDate(), t = todayStr();
  $('monthlyOverviewLabel').innerText = `${['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'][m]} ${y}`;
  const days = []; for (let d = 1; d <= dim; d++) { const ds = localDate(new Date(y, m, d)); days.push({ d, ds, dow: new Date(y, m, d).getDay() }); }
  $('monthlyOverviewHead').innerHTML = `<tr><th class="p-2 sticky left-0 bg-slate-950 z-20 border-r border-slate-800 min-w-[110px] text-left">Oda</th>${days.map(x => `<th class="p-1.5 text-center min-w-[34px] border-r border-slate-800/60 ${x.ds === t ? 'bg-fuchsia-500/25 text-fuchsia-400' : (x.dow === 0 || x.dow === 6 ? 'text-amber-500' : 'text-slate-400')} ${x.ds < t ? 'opacity-40' : ''}"><div>${x.d}</div><div class="text-[9px] font-normal opacity-70">${['Pz', 'Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct'][x.dow]}</div></th>`).join('')}</tr>`;
  const body = $('monthlyOverviewBody'); body.innerHTML = '';
  for (const r of S.rooms) {
    const rr = S.reservations.filter(x => String(x.roomId) === String(r.id) && ['Rezerve', 'Dolu'].includes(x.status));
    let html = `<td class="p-2 sticky left-0 bg-slate-900 z-10 border-r border-slate-800 font-bold ${r.status === 'Arızalı' ? 'text-stone-500' : 'text-amber-500'} whitespace-nowrap">Oda ${esc(r.id)}<div class="text-[9px] font-normal text-slate-500 truncate max-w-[95px]">${esc(r.status === 'Arızalı' ? 'Arızalı' : r.type)}</div></td>`;
    for (const x of days) {
      const mr = rr.find(z => x.ds >= z.checkIn && x.ds < z.checkOut);
      let cls = r.status === 'Arızalı' ? 'bg-stone-500/20' : (mr ? (mr.status === 'Dolu' ? 'bg-rose-500/40 hover:bg-rose-500/60 rez-draggable' : 'bg-amber-500/40 hover:bg-amber-500/60 rez-draggable') : (x.ds < t ? 'bg-slate-800/30' : 'bg-emerald-500/10 hover:bg-emerald-500/25'));
      if (x.ds === t) cls += ' ring-2 ring-inset ring-fuchsia-400';
      const first = mr && (mr.checkIn === x.ds || x.d === 1);
      html += `<td class="p-0 text-center border-r border-slate-800/40 h-9 ${cls} transition relative" ${mr && mr.status === 'Rezerve' ? `draggable="true" ondragstart="dragStart(event,'${esc(mr.id)}')"` : ''} ${r.status !== 'Arızalı' && x.ds >= t ? `ondragover="dragOver(event)" ondragleave="dragLeave(event)" ondrop="drop(event,'${esc(r.id)}','${x.ds}')"` : ''} onmouseenter="showTip(event,'${esc(r.id)}','${x.ds}')" onmousemove="moveTip(event)" onmouseleave="hideTip()" onclick="cellClick('${esc(r.id)}','${x.ds}')">${first ? `<span class="absolute inset-y-0 left-1 flex items-center text-[9px] font-bold text-slate-950 whitespace-nowrap overflow-hidden pointer-events-none">${esc(mr.primaryName.split(' ')[0])}</span>` : ''}</td>`;
    }
    body.insertAdjacentHTML('beforeend', `<tr class="hover:bg-slate-800/20">${html}</tr>`);
  }
  if (!S.rooms.length) body.innerHTML = '<tr><td colspan="32" class="p-4 text-center text-slate-500">Oda yok</td></tr>';
}
function dragStart(e, id) { e.dataTransfer.setData('text/plain', id); }
function dragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function dragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
function drop(e, roomId, ds) {
  e.preventDefault(); e.currentTarget.classList.remove('drag-over');
  const r = rez(e.dataTransfer.getData('text/plain')); if (!r || r.status !== 'Rezerve') return;
  const co = addDays(ds, nights(r.checkIn, r.checkOut));
  confirmAsk('Rezervasyon Taşıma', `${r.primaryName} → Oda ${roomId}, ${fmtDate(ds)} - ${fmtDate(co)}`, () => act(() => api(`/reservations/${r.id}`, 'PUT', { roomId, checkIn: ds, checkOut: co }), 'Rezervasyon taşındı'));
}
function cellClick(roomId, ds) { const mr = S.reservations.find(z => String(z.roomId) === String(roomId) && ['Rezerve', 'Dolu'].includes(z.status) && ds >= z.checkIn && ds < z.checkOut); if (mr) openRoomAction(roomId); else if (ds >= todayStr() && room(roomId)?.status !== 'Arızalı') openNewBookingModal(roomId, ds); }
function showTip(e, roomId, ds) { const r = room(roomId), mr = S.reservations.find(z => String(z.roomId) === String(roomId) && ['Rezerve', 'Dolu'].includes(z.status) && ds >= z.checkIn && ds < z.checkOut), tip = $('monthlyTooltip'); tip.innerHTML = mr ? `<p class="font-bold text-amber-400">Oda ${esc(roomId)} • ${esc(r.type)}</p><p class="font-semibold">${esc(mr.allGuestsNames || mr.primaryName)}</p><p class="text-slate-400">${fmtDate(mr.checkIn)} → ${fmtDate(mr.checkOut)} • ${money(mr.grandTotal)}</p><p class="mt-1">${statusBadge(mr.status)} ${esc(mr.source || '')}</p>` : `<p class="font-bold text-amber-400">Oda ${esc(roomId)}</p><p class="text-emerald-400">${r.status === 'Arızalı' ? 'Kapalı' : 'Müsait'} — ${fmtDate(ds)}</p>`; tip.classList.remove('hidden'); moveTip(e); }
function moveTip(e) { const tip = $('monthlyTooltip'); if (tip.classList.contains('hidden')) return; let l = e.clientX + 16, t = e.clientY + 16; if (l + 230 > innerWidth) l = e.clientX - 240; if (t + 100 > innerHeight) t = e.clientY - 110; tip.style.left = l + 'px'; tip.style.top = t + 'px'; }
function hideTip() { $('monthlyTooltip').classList.add('hidden'); }

// ============ RAPORLAR ============
function setReportQuickDate(type) {
  const n = new Date(); let s = new Date(), e = new Date();
  if (type === 'this_month') s = new Date(n.getFullYear(), n.getMonth(), 1); else if (type === 'last_month') { s = new Date(n.getFullYear(), n.getMonth() - 1, 1); e = new Date(n.getFullYear(), n.getMonth(), 0); } else if (type === 'last_3_months') s = new Date(n.getFullYear(), n.getMonth() - 3, 1); else if (type === 'this_year') s = new Date(n.getFullYear(), 0, 1);
  $('reportStartDate').value = localDate(s); $('reportEndDate').value = localDate(e); renderReports();
}
function filteredReport() {
  const s = $('reportStartDate').value, e = $('reportEndDate').value, src = $('reportSource').value, basis = $('reportBasis').value;
  if (basis === 'payment') {
    const payIds = new Set(S.payments.filter(p => { const d = localDate(new Date(p.createdAt)); return (!s || d >= s) && (!e || d <= e); }).map(p => p.reservationId));
    return S.reservations.filter(r => payIds.has(r.id) && (!src || r.source === src));
  }
  return S.reservations.filter(r => !['İptal', 'No-Show'].includes(r.status) && (!src || r.source === src) && (!e || r.checkIn <= e) && (!s || r.checkOut > s));
}
function renderReports() {
  const s = $('reportStartDate').value, e = $('reportEndDate').value;
  const srcSel = $('reportSource'); const cur0 = srcSel.value; srcSel.innerHTML = '<option value="">Tüm Kaynaklar</option>' + [...new Set(S.reservations.map(r => r.source).filter(Boolean))].map(x => `<option ${x === cur0 ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const rows = filteredReport();
  $('reportPeriodText').innerText = `${fmtDate(s)} — ${fmtDate(e)} • ${rows.length} kayıt`;
  let roomRev = 0, mbRev = 0, col = 0, out = 0, nightSum = 0;
  $('reportTableBody').innerHTML = rows.sort((a, b) => a.checkIn.localeCompare(b.checkIn)).map(r => { roomRev += +r.totalPrice || 0; mbRev += r.minibarTotal; col += r.collectedTotal; out += r.remainingBalance; const nn = nights(r.checkIn, r.checkOut); nightSum += nn; return `<tr class="hover:bg-slate-800/30"><td class="p-3 font-bold text-amber-500">Oda ${esc(r.roomId)}</td><td class="p-3">${esc(r.primaryName)}<div class="text-[10px] text-slate-500">${esc(r.source || '')}</div></td><td class="p-3">${fmtDate(r.checkIn)} → ${fmtDate(r.checkOut)}</td><td class="p-3">${nn}</td><td class="p-3 font-mono">${money(r.totalPrice)}</td><td class="p-3 font-mono text-sky-400">${money(r.minibarTotal)}</td><td class="p-3 font-bold text-emerald-400">${money(r.grandTotal)}</td><td class="p-3 text-amber-400">${money(r.collectedTotal)}</td><td class="p-3 ${r.remainingBalance > 0 ? 'text-rose-400 font-bold' : 'text-slate-500'}">${money(r.remainingBalance)}</td><td class="p-3">${statusBadge(r.status)}</td></tr>`; }).join('') || '<tr><td colspan="10" class="p-4 text-center text-slate-500 italic">Kayıt yok</td></tr>';
  $('reportTotalRevenue').innerText = money(roomRev + mbRev); $('reportRoomRevenue').innerText = money(roomRev); $('reportMinibarRevenue').innerText = money(mbRev); $('reportCollected').innerText = money(col); $('reportOutstanding').innerText = out > 0 ? `Açık bakiye: ${money(out)}` : 'Açık bakiye yok';
  const daysInPeriod = s && e ? Math.max(1, nights(s, e) + 1) : 1, avail = S.rooms.filter(r => r.status !== 'Arızalı').length * daysInPeriod;
  const occNights = s && e ? rows.reduce((a, r) => a + Math.max(0, nights(r.checkIn < s ? s : r.checkIn, r.checkOut > addDays(e, 1) ? addDays(e, 1) : r.checkOut)), 0) : nightSum;
  $('reportOccupancy').innerText = avail ? `${Math.round(occNights / avail * 100)}%` : '-'; $('reportNights').innerText = `${occNights} dolu gece / ${avail} müsait gece`;
  const ids = new Set(rows.map(r => r.id)), byM = {}, byS = {};
  for (const p of S.payments) { if (!ids.has(p.reservationId)) continue; if ($('reportBasis').value === 'payment') { const d = localDate(new Date(p.createdAt)); if ((s && d < s) || (e && d > e)) continue; } byM[p.method] = (byM[p.method] || 0) + (p.type === 'İade' ? -p.amount : p.amount); }
  for (const r of rows) byS[r.source || '-'] = (byS[r.source || '-'] || 0) + r.grandTotal;
  $('reportByMethod').innerHTML = Object.entries(byM).map(([k, v]) => `<div class="flex justify-between"><span>${esc(k)}</span><b>${money(v)}</b></div>`).join('') || '<span class="text-slate-500">-</span>';
  $('reportBySource').innerHTML = Object.entries(byS).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="flex justify-between"><span>${esc(k)}</span><b>${money(v)}</b></div>`).join('') || '<span class="text-slate-500">-</span>';
}
function exportReportsCSV() {
  const rows = filteredReport(); if (!rows.length) return toast('Kayıt yok', 'error');
  const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  let csv = '\uFEFFRezervasyon No;Oda;Misafir;Kimlik;Telefon;Kaynak;Giris;Cikis;Gece;Oda Tutari;Minibar;Toplam;Tahsil;Kalan;Durum\n';
  for (const r of rows) csv += [r.id, r.roomId, r.primaryName, r.tc, r.phone, r.source, fmtDate(r.checkIn), fmtDate(r.checkOut), nights(r.checkIn, r.checkOut), r.totalPrice, r.minibarTotal, r.grandTotal, r.collectedTotal, r.remainingBalance, r.status].map(q).join(';') + '\n';
  download(`ciro_${$('reportStartDate').value}_${$('reportEndDate').value}.csv`, csv, 'text/csv;charset=utf-8'); toast('CSV indirildi');
}
function exportKbs() { const d = prompt('KBS bildirim tarihi (YYYY-AA-GG):', todayStr()); if (!d) return; window.open(`${API}/export?type=kbs&date=${encodeURIComponent(d)}&token=${token}`, '_blank'); }

// ============ KASA ============
function renderCash() {
  if (!$('cashDate').value) $('cashDate').value = todayStr();
  const d = $('cashDate').value;
  const pays = S.payments.filter(p => localDate(new Date(p.createdAt)) === d).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const sum = (f) => pays.filter(f).reduce((a, p) => a + (p.type === 'İade' ? -p.amount : p.amount), 0);
  $('cashSummary').innerHTML = [['Toplam', sum(() => true), 'text-emerald-400'], ['Nakit', sum(p => p.method === 'Nakit'), 'text-amber-400'], ['Kart', sum(p => p.method === 'Kart'), 'text-sky-400'], ['Havale', sum(p => p.method === 'Havale'), 'text-fuchsia-400']].map(([l, v, c]) => `<div class="bg-slate-900 border border-slate-800 rounded-xl p-3"><span class="text-xs text-slate-400">${l}</span><h3 class="text-xl font-black ${c}">${money(v)}</h3></div>`).join('');
  $('cashTableBody').innerHTML = pays.map(p => { const r = rez(p.reservationId); return `<tr class="hover:bg-slate-800/30"><td class="p-3 font-mono">${new Date(p.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</td><td class="p-3 font-bold text-amber-500">${esc(p.roomId)}</td><td class="p-3">${esc(r ? r.primaryName : '-')}</td><td class="p-3">${esc(p.type)}</td><td class="p-3">${esc(p.method)}</td><td class="p-3 font-bold ${p.type === 'İade' ? 'text-rose-400' : 'text-emerald-400'}">${p.type === 'İade' ? '-' : ''}${money(p.amount)}</td><td class="p-3 text-slate-400">${esc(p.createdBy || '')}</td><td class="p-3 text-slate-500">${esc(p.note || '')}</td><td class="p-3 text-right role-admin"><button onclick="deletePayment(${p.id})" class="text-rose-400"><i class="fa-solid fa-trash"></i></button></td></tr>`; }).join('') || '<tr><td colspan="9" class="p-4 text-center text-slate-500 italic">Bu tarihte ödeme yok</td></tr>';
}
function printCash() {
  const d = $('cashDate').value, pays = S.payments.filter(p => localDate(new Date(p.createdAt)) === d);
  const tot = pays.reduce((a, p) => a + (p.type === 'İade' ? -p.amount : p.amount), 0);
  $('printArea').innerHTML = `<div style="text-align:center"><b>${esc(S.settings.hotel_name)}</b><br>KASA RAPORU — ${fmtDate(d)}</div><hr><table>${pays.map(p => `<tr><td>${new Date(p.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} Oda ${esc(p.roomId)} ${esc(p.method)}</td><td class="r">${p.type === 'İade' ? '-' : ''}${money(p.amount)}</td></tr>`).join('')}</table><hr><table><tr><td><b>TOPLAM</b></td><td class="r"><b>${money(tot)}</b></td></tr></table><hr><div style="text-align:center">${new Date().toLocaleString('tr-TR')} • ${esc(S.me?.username || '')}</div>`;
  window.print();
}

// ============ FİŞ ============
function printReceipt(id) {
  const r = rez(id); if (!r) return;
  const items = S.minibar.filter(m => m.reservationId === id), pays = S.payments.filter(p => p.reservationId === id), st = S.settings;
  $('printArea').innerHTML = `<div style="text-align:center"><b style="font-size:14px">${esc(st.hotel_name)}</b><br>${esc(st.hotel_address || '')}<br>${esc(st.hotel_phone || '')}${st.hotel_tax_no ? '<br>VN: ' + esc(st.hotel_tax_no) : ''}</div><hr>
  <table><tr><td>Fiş No</td><td class="r">${esc(r.id)}</td></tr><tr><td>Oda</td><td class="r">${esc(r.roomId)}</td></tr><tr><td>Misafir</td><td class="r">${esc(r.primaryName)}</td></tr><tr><td>Giriş</td><td class="r">${fmtDate(r.checkIn)}</td></tr><tr><td>Çıkış</td><td class="r">${fmtDate(r.checkOut)}</td></tr><tr><td>Gece</td><td class="r">${nights(r.checkIn, r.checkOut)}</td></tr></table><hr>
  <table><tr><td>Konaklama</td><td class="r">${money(r.totalPrice)}</td></tr>${items.map(m => `<tr><td>${esc(m.name)}${m.qty > 1 ? ' x' + m.qty : ''}</td><td class="r">${money(m.price * (m.qty || 1))}</td></tr>`).join('')}<tr><td><b>TOPLAM</b></td><td class="r"><b>${money(r.grandTotal)}</b></td></tr></table><hr>
  <table>${pays.map(p => `<tr><td>${esc(p.type)} (${esc(p.method)}) ${fmtDate(localDate(new Date(p.createdAt)))}</td><td class="r">${p.type === 'İade' ? '-' : ''}${money(p.amount)}</td></tr>`).join('')}<tr><td>Tahsil Edilen</td><td class="r">${money(r.collectedTotal)}</td></tr><tr><td><b>KALAN</b></td><td class="r"><b>${money(r.remainingBalance)}</b></td></tr></table><hr>
  <div style="text-align:center">${new Date().toLocaleString('tr-TR')}<br>Bizi tercih ettiğiniz için teşekkürler.<br><small>Bu belge mali değeri olan fatura/fiş yerine geçmez.</small></div>`;
  window.print();
}

// ============ ODA AYARLARI ============
function openRoomSettings() { populateRoomSettingsTable(); $('pricingModeHint').innerText = S.settings.pricing_mode === 'per_person' ? 'Mod: Kişi başı — baz fiyat × (yetişkin + çocuk×katsayı)' : 'Mod: Oda bazlı — baz fiyat + kapasite üstü her kişi için ek kişi ücreti'; $('icalRoom').innerHTML = S.rooms.map(r => `<option value="${esc(r.id)}">Oda ${esc(r.id)}</option>`).join(''); openModal('roomSettingsModal'); toggleMobileMenu(false); }
function populateRoomSettingsTable() {
  $('roomSettingsTableBody').innerHTML = S.rooms.map(r => `<tr><td class="p-2"><input type="text" id="rs_id_${esc(r.id)}" value="${esc(r.id)}" class="inp w-20 text-amber-400 font-bold"></td><td class="p-2"><input type="text" id="rs_type_${esc(r.id)}" value="${esc(r.type)}" class="inp"></td><td class="p-2"><input type="number" id="rs_price_${esc(r.id)}" value="${r.price}" class="inp w-24"></td><td class="p-2"><input type="number" id="rs_extra_${esc(r.id)}" value="${r.extraPersonPrice || 0}" class="inp w-24"></td><td class="p-2"><input type="number" id="rs_cap_${esc(r.id)}" value="${r.capacity || 2}" min="1" class="inp w-16"></td><td class="p-2 text-right whitespace-nowrap space-x-1"><button onclick="saveRoom('${esc(r.id)}')" class="btn btn-amber !py-1"><i class="fa-solid fa-floppy-disk"></i></button><button onclick="deleteRoom('${esc(r.id)}')" class="btn btn-rose !py-1"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('') || '<tr><td colspan="6" class="p-4 text-center text-slate-500">Oda yok</td></tr>';
}
async function handleAddNewRoom(e) { e.preventDefault(); if (await act(() => api('/rooms', 'POST', { id: $('newRoomId').value, type: $('newRoomType').value, price: $('newRoomPrice').value, extraPersonPrice: $('newRoomExtra').value, capacity: $('newRoomCap').value }), 'Oda eklendi')) e.target.reset(); }
const saveRoom = (id) => act(() => api(`/rooms/${encodeURIComponent(id)}`, 'PUT', { id: $(`rs_id_${id}`).value, type: $(`rs_type_${id}`).value, price: $(`rs_price_${id}`).value, extraPersonPrice: $(`rs_extra_${id}`).value, capacity: $(`rs_cap_${id}`).value }), 'Oda güncellendi');
function exportIcal() { window.open(`${API}/export?type=ical&roomId=${encodeURIComponent($('icalRoom').value)}&token=${token}`, '_blank'); }
function importIcal(e) { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = async (ev) => { const r = await act(() => api('/import', 'POST', { roomId: $('icalRoom').value, ics: ev.target.result })); if (r) toast(`iCal: ${r.added} eklendi, ${r.skipped} atlandı`); }; rd.readAsText(f); e.target.value = ''; }

// ============ OTEL AYARLARI ============
function openSettings() {
  for (const k of ['hotel_name', 'hotel_subtitle', 'hotel_address', 'hotel_phone', 'hotel_tax_no', 'pricing_mode', 'child_factor', 'weekend_multiplier', 'weekend_days', 'checkout_hour', 'backup_keep_days', 'backup_extra_dir']) { const el = $(`s_${k}`); if (el) el.value = S.settings[k] ?? ''; }
  $('s_allow_overbooking').checked = S.settings.allow_overbooking === '1';
  $('seasonRows').innerHTML = ''; let seasons = []; try { seasons = JSON.parse(S.settings.seasons || '[]'); } catch (_) {}
  seasons.forEach(addSeasonRow);
  $('pickFolderBtn').classList.toggle('hidden', !isDesktop);
  openModal('settingsModal'); toggleMobileMenu(false);
}
function addSeasonRow(s = {}) { const d = document.createElement('div'); d.className = 'grid grid-cols-5 gap-2 season-row'; d.innerHTML = `<input type="text" placeholder="Ad (Yaz)" value="${esc(s.name || '')}" class="inp se-name col-span-2"><input type="text" placeholder="06-15" maxlength="5" value="${esc(s.start || '')}" class="inp se-start"><input type="text" placeholder="09-15" maxlength="5" value="${esc(s.end || '')}" class="inp se-end"><div class="flex gap-1"><input type="number" step="0.05" placeholder="1.3" value="${s.multiplier || ''}" class="inp se-mult"><button type="button" onclick="this.closest('.season-row').remove()" class="btn btn-ghost"><i class="fa-solid fa-xmark"></i></button></div>`; $('seasonRows').appendChild(d); }
async function pickBackupFolder() { if (!isDesktop) return; const p = await window.mesoft.pickFolder(); if (p) $('s_backup_extra_dir').value = p; }
async function handleSaveSettings(e) {
  e.preventDefault(); const b = {};
  for (const k of ['hotel_name', 'hotel_subtitle', 'hotel_address', 'hotel_phone', 'hotel_tax_no', 'pricing_mode', 'child_factor', 'weekend_multiplier', 'weekend_days', 'checkout_hour', 'backup_keep_days', 'backup_extra_dir']) b[k] = $(`s_${k}`).value;
  b.allow_overbooking = $('s_allow_overbooking').checked ? '1' : '0';
  b.seasons = JSON.stringify([...document.querySelectorAll('.season-row')].map(r => ({ name: r.querySelector('.se-name').value, start: r.querySelector('.se-start').value, end: r.querySelector('.se-end').value, multiplier: parseFloat(r.querySelector('.se-mult').value) || 1 })).filter(s => /^\d{2}-\d{2}$/.test(s.start) && /^\d{2}-\d{2}$/.test(s.end)));
  if (await act(() => api('/settings', 'PUT', b), 'Ayarlar kaydedildi')) closeModal('settingsModal');
}

// ============ KULLANICILAR ============
async function openUsers() { renderUsers(); openModal('usersModal'); toggleMobileMenu(false); try { const a = await api('/audit'); $('auditList').innerHTML = a.map(x => `<div>${esc(x.ts.slice(0, 16).replace('T', ' '))} <b>${esc(x.user)}</b> ${esc(x.action)} <span class="text-slate-600">${esc(x.detail)}</span></div>`).join(''); } catch (_) {} }
function renderUsers() { $('usersTableBody').innerHTML = (S.users || []).map(u => `<tr><td class="p-2.5 font-bold">${esc(u.username)}</td><td class="p-2.5">${esc(u.name || '-')}</td><td class="p-2.5"><select onchange="updateUser(${u.id},{role:this.value})" class="inp w-auto !py-1"><option value="receptionist" ${u.role !== 'admin' ? 'selected' : ''}>Resepsiyonist</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Yönetici</option></select></td><td class="p-2.5"><button onclick="updateUser(${u.id},{active:${u.active ? 'false' : 'true'}})" class="badge ${u.active ? 'badge-emerald' : 'badge-slate'}">${u.active ? 'Aktif' : 'Pasif'}</button></td><td class="p-2.5 text-right space-x-1 whitespace-nowrap"><button onclick="resetUserPassword(${u.id},'${esc(u.username)}')" class="btn btn-sky !py-1" title="Şifre sıfırla"><i class="fa-solid fa-key"></i></button>${u.id !== S.me.id ? `<button onclick="deleteUser(${u.id})" class="btn btn-rose !py-1"><i class="fa-solid fa-trash"></i></button>` : ''}</td></tr>`).join(''); }
async function handleAddUser(e) { e.preventDefault(); if (await act(() => api('/users', 'POST', { username: $('nu_username').value, name: $('nu_name').value, password: $('nu_password').value, role: $('nu_role').value }), 'Kullanıcı eklendi')) e.target.reset(); }
const updateUser = (id, b) => act(() => api(`/users/${id}`, 'PUT', b), 'Kullanıcı güncellendi');
function resetUserPassword(id, un) { const p = prompt(`${un} için yeni şifre (en az 4):`); if (p && p.length >= 4) updateUser(id, { password: p }); }
function deleteUser(id) { confirmAsk('Kullanıcı Sil', 'Kullanıcı silinecek. İşlem günlüğü kayıtları kalır.', () => act(() => api(`/users/${id}`, 'DELETE'), 'Kullanıcı silindi')); }

// ============ YEDEK / DB ============
async function backupNow() { const r = await act(() => api('/backup', 'POST')); if (r) toast(`Yedek alındı: ${r.file.split(/[\\/]/).pop()}`); }
function openBackupsFolder() { if (isDesktop) window.mesoft.openBackups(); else toast('Yalnızca masaüstü uygulamasında', 'error'); }
function exportJson() { window.open(`${API}/export?type=json&token=${token}`, '_blank'); }
function importJson(e) { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = (ev) => { let data; try { data = JSON.parse(ev.target.result); } catch (_) { return toast('Geçersiz dosya', 'error'); } confirmAsk('İçe Aktarım', 'Mevcut tüm odalar, misafirler ve rezervasyonlar bu yedekle DEĞİŞTİRİLECEK. Devam?', async () => { if (await act(() => api('/import', 'POST', data), 'Yedek geri yüklendi')) closeModal('dbModal'); }); }; rd.readAsText(f); e.target.value = ''; }
function resetDatabase() { confirmAsk('Fabrika Ayarları', 'Tüm odalar, misafirler, rezervasyonlar ve ödemeler silinecek. Kullanıcılar ve ayarlar kalır. Önce otomatik yedek alınır.', async () => { if (await act(() => api('/reset', 'POST'), 'Veritabanı sıfırlandı')) closeModal('dbModal'); }); }

// ============ GÜNCELLEME (masaüstü) ============
async function checkUpdates() { if (!isDesktop) return; const r = await window.mesoft.checkUpdates(); if (r && r.reason) $('updateStatusText').innerText = r.reason; else $('updateStatusText').innerText = 'Kontrol ediliyor…'; }
function setupDesktop() {
  if (!isDesktop) return;
  window.mesoft.info().then(info => {
    desktopInfo = info; loadHotelUI();
    $('dbStoragePathText').innerText = info.dbPath; $('dbStorageInfoBox').classList.remove('hidden'); $('autoBackupsRow').classList.remove('hidden');
    $('updateRow').classList.toggle('hidden', !info.isPackaged);
    $('networkUrlList').innerHTML = info.ips.map(ip => `<div class="bg-slate-950 border border-emerald-500/40 p-3 rounded-xl flex items-center justify-between"><div><span class="font-mono text-emerald-400 font-bold text-sm select-all">http://${esc(ip.address)}:${info.port}</span><div class="text-[10px] text-slate-500">${esc(ip.name)}</div></div><button onclick="navigator.clipboard.writeText('http://${esc(ip.address)}:${info.port}').then(()=>toast('Kopyalandı'))" class="btn btn-emerald !py-1"><i class="fa-solid fa-copy"></i></button></div>`).join('');
  });
  window.mesoft.onUpdate((ev, p) => { const t = $('updateStatusText'); if (ev === 'available') t.innerText = `Yeni sürüm v${p.version} indiriliyor…`; if (ev === 'progress') t.innerText = `İndiriliyor %${Math.round(p.percent)}`; if (ev === 'not-available') { t.innerText = 'Uygulama güncel'; toast('Uygulama güncel'); } if (ev === 'error') t.innerText = `Hata: ${p}`; if (ev === 'downloaded') { t.innerText = `v${p.version} hazır`; confirmAsk('Güncelleme Hazır', `v${p.version} indirildi. Şimdi yeniden başlatılsın mı? (Diğer cihazların bağlantısı kısa süre kesilir)`, () => window.mesoft.installUpdate()); } });
}
if (!isDesktop) $('networkUrlList').innerHTML = `<div class="bg-slate-950 border border-emerald-500/40 p-3 rounded-xl"><span class="font-mono text-emerald-400 font-bold text-sm select-all">${esc(location.origin)}</span><div class="text-[10px] text-slate-500 mt-1">Bu cihaz tarayıcı üzerinden bağlı. IP listesi ana bilgisayardaki uygulamada görünür.</div></div>`;

// ============ BAŞLANGIÇ ============
function bindConfirmButtons() {
  $('confirmModalOkBtn').onclick = async () => { closeModal('confirmModal'); const cb = confirmCb; confirmCb = null; if (typeof cb === 'function') await cb(); };
  $('confirmModalCancelBtn').onclick = () => { closeModal('confirmModal'); confirmCb = null; };
}
window.addEventListener('DOMContentLoaded', async () => {
  if (localStorage.getItem('ms_theme') === 'light') { document.body.classList.add('light-theme'); $('themeIcon').className = 'fa-solid fa-moon text-base'; }
  setInterval(() => { $('liveClock').innerText = new Date().toLocaleTimeString('tr-TR'); }, 1000);
  $('loginForm').addEventListener('submit', handleLogin);
  bindConfirmButtons(); setupDesktop();
  document.addEventListener('click', (e) => { if (!e.target.closest('[id^="suggest"]') && !e.target.matches('input')) document.querySelectorAll('[id^="suggest"]').forEach(b => b.classList.add('hidden')); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.modal:not(.hidden)').forEach(m => { if (m.id !== 'passwordModal' || !$('pwCancelBtn').classList.contains('hidden')) m.classList.add('hidden'); }); });
  const t = todayStr(); $('reportStartDate').value = localDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)); $('reportEndDate').value = t; $('cashDate').value = t;
  switchTab('rooms');
  if (token) { try { await api('/me'); $('loginOverlay').classList.add('hidden'); await refresh(true); startPolling(); } catch (_) { logoutLocal(); } }
  else { try { const s = await fetch(`${API}/health`); if (s.ok) setOffline(false); } catch (_) { setOffline(true); } }
});
