const sqlite3 = require('sqlite3'); const { Database } = require('/home/claude/otel/v7/db.js');
(async () => {
  // v6 şemasını ve verisini oluştur (orijinal main.js'e göre)
  const raw = new sqlite3.Database('/tmp/mtest/v6.db');
  const ex = (sql)=>new Promise((r,j)=>raw.exec(sql,e=>e?j(e):r()));
  await ex(`CREATE TABLE rooms (id INTEGER PRIMARY KEY, type TEXT, price REAL, status TEXT, guest TEXT, minibar TEXT);
  CREATE TABLE guests (key TEXT PRIMARY KEY, tc TEXT, name TEXT, phone TEXT, email TEXT, notes TEXT, visits INTEGER);
  CREATE TABLE reservations (id TEXT PRIMARY KEY, roomId INTEGER, primaryName TEXT, tc TEXT, phone TEXT, adultCount INTEGER, childCount INTEGER, allGuestsNames TEXT, checkIn TEXT, checkOut TEXT, totalPrice REAL, advancePayment REAL, collectedTotal REAL, status TEXT, minibarTotal REAL);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  INSERT INTO rooms VALUES (101,'Standart',800,'Dolu','{"name":"Mehmet"}','[{"name":"Su","price":20},{"name":"Kola","price":40}]');
  INSERT INTO rooms VALUES (102,'Deluxe',1200,'Boş',NULL,'[]');
  INSERT INTO guests VALUES ('k1','123','Mehmet Kaya','0555','', 'VIP', 3);
  INSERT INTO reservations VALUES ('R1',101,'Mehmet Kaya','123','0555',2,0,'Mehmet Kaya','2026-09-20','2026-09-25',4000,1000,0,'Dolu',60);
  INSERT INTO reservations VALUES ('R0',102,'Eski Konuk','','0111',1,0,'Eski Konuk','2026-08-01','2026-08-03',2400,500,2400,'Tamamlandı',150);
  INSERT INTO settings VALUES ('config','{"hotel_name":"GRAND OTEL","hotel_subtitle":"Test","admin_username":"patron","admin_password":"gizli99"}');`);
  await new Promise(r=>raw.close(r));

  const db = new Database('/tmp/mtest/v6.db'); await db.open();
  const st = await db.getState();
  const ok=(c,m)=>console.log((c?'ok   ':'FAIL ')+m);
  ok(st.settings.hotel_name==='GRAND OTEL','otel adı taşındı');
  const u = await db.get(`SELECT * FROM users WHERE username='patron'`); ok(u && Database.verifyPassword('gizli99',u.passHash,u.salt) && u.role==='admin','admin kullanıcı hash ile taşındı');
  ok(!(await db.get(`SELECT * FROM settings WHERE key='config'`)),'düz metin şifre settings\'ten silindi');
  const R1 = st.reservations.find(r=>r.id==='R1'); ok(R1.roomId==='101' && R1.collectedTotal===1000 && R1.minibarTotal===60 && R1.remainingBalance===3060,'aktif rez: kapora→payment, oda minibarı→items, kalan 3060');
  const R0 = st.reservations.find(r=>r.id==='R0'); ok(R0.collectedTotal===2400 && R0.minibarTotal===150 && R0.remainingBalance===150,'tamamlanmış rez: 500 kapora + 1900 tahsilat; v6 minibar totalı korundu');
  ok(st.rooms.find(r=>r.id==='101').clean===1 && st.rooms.find(r=>r.id==='101').capacity===2,'oda yeni kolonlar default');
  ok((await db.get(`SELECT value FROM meta WHERE key='schema_version'`)).value==='7','schema_version=7');
  await db.close();
  // ikinci açılış idempotent
  const db2 = new Database('/tmp/mtest/v6.db'); await db2.open(); const c=(await db2.get(`SELECT COUNT(*) c FROM payments`)).c; ok(c===3,'ikinci açılışta ödeme tekrarlanmadı ('+c+')'); await db2.close();
})().catch(e=>{console.error(e);process.exit(1)});
