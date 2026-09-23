const { chromium } = require('playwright');
const { Server } = require('/home/claude/otel/v7/server.js');
const fs = require('fs');
(async () => {
  fs.rmSync('/tmp/e2e/db', { recursive: true, force: true });
  const s = new Server({ dbPath: '/tmp/e2e/db/e2e.db', staticDir: '/home/claude/otel/v7', port: 18090, host: '127.0.0.1', backupsDir: '/tmp/e2e/db/yedek', log: () => {} });
  await s.start();
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message)); page.on('console', m => { if (m.type() === 'error' && !/cdn|Failed to load resource|Content Security/i.test(m.text())) errors.push('CONSOLE: ' + m.text()); });
  const ok = (c, m) => console.log((c ? 'ok   ' : 'FAIL ') + m); const T = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const toast = async () => { await page.waitForTimeout(400); return (await page.locator('#toastContainer').innerText()).trim(); };

  await page.goto('http://127.0.0.1:18090/'); await page.waitForTimeout(500);
  ok(await page.locator('#loginOverlay').isVisible(), 'giriş ekranı görünür');

  // yanlış şifre
  await page.fill('#loginUsername', 'admin'); await page.fill('#loginPassword', 'yanlis'); await page.click('#loginBtn'); await page.waitForTimeout(300);
  ok(await page.locator('#loginError').isVisible() && (await page.locator('#loginError').innerText()).includes('hatalı'), 'yanlış şifre mesajı');
  // doğru
  await page.fill('#loginPassword', '1234'); await page.click('#loginBtn'); await page.waitForTimeout(800);
  ok(await page.locator('#loginOverlay').isHidden(), 'giriş yapıldı');
  ok(await page.locator('#passwordModal').isVisible() && await page.locator('#pwCancelBtn').isHidden(), 'zorunlu şifre değişimi (vazgeç yok)');
  await page.fill('#pw_current', '1234'); await page.fill('#pw_next', 'Otel2026'); await page.fill('#pw_next2', 'Otel2026'); await page.click('#passwordModal button[type=submit]'); 
  ok((await toast()).includes('Şifre değiştirildi'), 'şifre değişti');
  ok(await page.evaluate(() => document.body.classList.contains('is-admin')), 'admin rolü uygulandı');
  ok((await page.locator('#roomsGrid > div').count()) === 4, '4 oda kartı render edildi');
  ok((await page.locator('#currentUserName').innerText()).includes('Yönetici'), 'kullanıcı rozeti');

  // Rezervasyon (bugün) → Dolu
  await page.click('aside button:has-text("Hızlı Rezervasyon")'); await page.waitForTimeout(200);
  await page.selectOption('#modalRoomSelect', '101'); await page.selectOption('#modalAdultCount', '2');
  await page.fill('#modalCheckIn', T()); await page.fill('#modalCheckOut', ((d)=>{d.setDate(d.getDate()+2);return d.toISOString().slice(0,10)})(new Date())); 
  await page.dispatchEvent('#modalCheckOut', 'change'); await page.waitForTimeout(600);
  const total = await page.inputValue('#modalTotalPriceInput'); ok(total === '3200', 'sunucudan fiyat teklifi: ' + total + ' (2 gece × 1600)');
  ok((await page.locator('#additionalGuestsContainer input').count()) > 0, '2. misafir alanları açıldı');
  await page.fill('#g1_tc', '11111111110'); await page.fill('#g1_name', 'Ali Veli'); await page.fill('#g1_phone', '05551112233'); await page.fill('#g1_birth', '1990-05-05');
  await page.fill('#g2_name', 'Ayşe Veli'); await page.selectOption('#modalAdvanceMethod','Kart'); await page.fill('#modalAdvancePaymentInput', '500'); await page.dispatchEvent('#modalAdvancePaymentInput', 'input');
  ok((await page.inputValue('#modalRemainingBalanceInput')) === '2700.00', 'kalan borç canlı hesap 2700');
  await page.click('#bookingSubmitBtn'); const t1 = await toast(); ok(t1.includes('Check-in yapıldı'), 'bugün giriş → check-in toast: ' + t1.split('\n')[0]);
  await page.waitForTimeout(500);
  ok((await page.locator('#roomsGrid').innerText()).includes('Ali Veli') && (await page.locator('#statOccupied').innerText()) === '1', 'oda kartı Dolu + istatistik');

  // Çakışma: aynı odaya yarın
  await page.click('aside button:has-text("Hızlı Rezervasyon")'); await page.selectOption('#modalRoomSelect', '101');
  const tm = new Date(); tm.setDate(tm.getDate()+1); await page.fill('#modalCheckIn', tm.toISOString().slice(0,10)); await page.dispatchEvent('#modalCheckIn','change'); await page.waitForTimeout(600);
  ok(await page.locator('#bookingSubmitBtn').isDisabled() && (await page.locator('#calculatedNights').innerText()).includes('ÇAKIŞMA'), 'çakışma uyarısı + buton kilitli');
  await page.click('#bookingModal button:has-text("İptal")');

  // Misafir önerisi
  await page.click('aside button:has-text("Hızlı Rezervasyon")'); await page.selectOption('#modalRoomSelect', '102'); await page.fill('#g1_name', 'ali'); await page.waitForTimeout(200);
  ok(await page.locator('#suggest1').isVisible() && (await page.locator('#suggest1').innerText()).includes('Ali Veli'), 'kayıtlı misafir önerisi');
  await page.click('#suggest1 > div'); ok((await page.inputValue('#g1_phone')) === '05551112233', 'öneri seçildi → telefon dolduruldu');
  await page.click('#bookingModal button:has-text("İptal")');

  // Oda detay → minibar → ödeme
  await page.click('#roomsGrid > div:first-child'); await page.waitForTimeout(300);
  ok(await page.locator('#roomDetailModal').isVisible() && await page.locator('#folioSection').isVisible(), 'oda detay + folyo açıldı');
  await page.fill('#minibarItemName', 'Kola'); await page.fill('#minibarItemPrice', '50'); await page.fill('#minibarItemQty', '2'); await page.click('#folioSection button:has-text("Ekle")'); await toast(); await page.waitForTimeout(400);
  ok((await page.locator('#detailMinibarTotalText').innerText()).includes('100'), 'minibar toplam 100');
  await page.fill('#payAmount', '1000'); await page.selectOption('#payMethod', 'Kart'); await page.click('button:has-text("Ödeme Al")'); await toast(); await page.waitForTimeout(400);
  ok((await page.locator('#detailBalanceText').innerText()).includes('1.800'), 'kalan 1.800 (3200+100-500-1000)');

  // Checkout bölünmüş
  await page.click('#detailRoomActions button:has-text("Çıkış")'); await page.waitForTimeout(200);
  ok(await page.locator('#checkoutModal').isVisible() && (await page.inputValue('.co-amt')) === '1800', 'checkout modal, kalan önerildi');
  await page.fill('.co-amt', '1000'); await page.locator('.co-method').first().selectOption('Kart'); await page.click('#checkoutModal button:has-text("Ödeme Satırı Ekle")'); const rows = page.locator('.co-amt'); await rows.nth(1).fill('800'); await page.locator('.co-method').nth(1).selectOption('Nakit');
  await page.click('#checkoutModal button:has-text("Çıkışı Tamamla")'); const t2 = await toast(); ok(t2.includes('Çıkış tamamlandı'), 'çıkış tamamlandı');
  await page.waitForTimeout(500); ok(await page.locator('#confirmModal').isVisible() && (await page.locator('#confirmModalMessage').innerText()).includes('fiş'), 'fiş yazdır sorusu'); await page.click('#confirmModalCancelBtn');
  const card = await page.locator('#roomsGrid > div:first-child').innerText(); ok(card.includes('KİRLİ'), 'oda KİRLİ oldu');

  // Bugün sekmesi → temizlendi
  await page.click('button[data-tab="today"]'); await page.waitForTimeout(200);
  ok((await page.locator('#todayDirty').innerText()).includes('Oda 101'), 'temizlik bekleyen listesinde');
  await page.click('#todayDirty button'); await toast(); await page.waitForTimeout(400);
  ok((await page.locator('#todayDirty').innerText()).includes('temiz'), 'temizlendi');

  // Kasa
  await page.click('button[data-tab="cash"]'); await page.waitForTimeout(300);
  const cash = await page.locator('#cashSummary').innerText(); ok(cash.includes('3.300') && cash.includes('2.500') && cash.includes('800'), 'kasa: toplam 3.300 / kart 2.500 / nakit 800');

  // Rapor
  await page.click('button[data-tab="reports"]'); await page.waitForTimeout(300);
  ok((await page.locator('#reportTotalRevenue').innerText()).includes('3.300') && (await page.locator('#reportOutstanding').innerText()).includes('yok'), 'rapor: ciro 3.300, açık bakiye yok');

  // Rezervasyonlar filtresi
  await page.click('button[data-tab="reservations"]'); await page.selectOption('#rezStatusFilter', 'Tamamlandı'); await page.waitForTimeout(200);
  ok((await page.locator('#reservationTableBody tr').count()) === 1, 'tamamlanan rezervasyon listelendi');

  // Resepsiyonist ekle, çık, onunla gir → yönetici menüsü gizli
  await page.click('aside button:has-text("Kullanıcılar")'); await page.fill('#nu_username', 'resep'); await page.fill('#nu_password', 'abcd'); await page.click('#usersModal form button[type=submit]'); await toast();
  ok((await page.locator('#usersTableBody').innerText()).includes('resep'), 'resepsiyonist eklendi');
  await page.evaluate(() => { logoutLocal(); });
  await page.fill('#loginUsername', 'resep'); await page.fill('#loginPassword', 'abcd'); await page.click('#loginBtn'); await page.waitForTimeout(800);
  ok(!(await page.evaluate(() => document.body.classList.contains('is-admin'))), 'resepsiyonist rolü');
  ok(await page.locator('button[data-tab="reports"]').isHidden() && await page.locator('aside button:has-text("Kullanıcılar")').isHidden(), 'yönetici menüleri gizli');
  ok(await page.locator('button[data-tab="rooms"]').isVisible(), 'resepsiyonist menüleri açık');

  // Ekran görüntüsü (CSS'siz olacak)
  await page.click('button[data-tab="rooms"]'); await page.waitForTimeout(300); await page.screenshot({ path: '/tmp/e2e/rooms.png' });
  await page.click('button[data-tab="monthly"]'); await page.waitForTimeout(400); await page.screenshot({ path: '/tmp/e2e/gantt.png' });
  await page.click('aside button:has-text("Hızlı Rezervasyon")'); await page.waitForTimeout(500); await page.screenshot({ path: '/tmp/e2e/booking.png' });
  console.log(errors.length ? '\nJS HATALARI:\n' + errors.join('\n') : '\nJS hatası yok');
  await browser.close(); await s.stop();
})().catch(e => { console.error('E2E HATA:', e); process.exit(1); });
