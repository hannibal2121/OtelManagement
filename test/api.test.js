const { Server } = require('/home/claude/otel/v7/server.js');
const path='path', fs=require('fs');
(async () => {
  const s = new Server({ dbPath: '/tmp/mtest/test.db', staticDir: '/home/claude/otel/v7', port: 18080, host: '127.0.0.1', backupsDir: '/tmp/mtest/yedek', log: ()=>{} });
  await s.start();
  const base='http://127.0.0.1:18080';
  let token=null;
  const call = async (m, p, b) => { const r = await fetch(base+p,{method:m,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:b?JSON.stringify(b):undefined}); const j=await r.json().catch(()=>({})); return {status:r.status, ...j}; };
  const assert=(c,msg)=>{ if(!c){ console.error('FAIL:',msg); process.exitCode=1; } else console.log('ok  ',msg); };

  // static & security
  let r = await fetch(base+'/'); assert(r.status===200 && (await r.text()).includes('<title>'), 'index.html servis');
  r = await fetch(base+'/app.js'); assert(r.status===200,'app.js servis');
  r = await fetch(base+'/main.js'); assert(r.status===404,'main.js gizli');
  r = await fetch(base+'/..%2F..%2Fetc%2Fpasswd'); assert(r.status===403||r.status===404,'path traversal engellendi');
  r = await call('GET','/api/state'); assert(r.status===401,'auth olmadan state 401');

  // login
  r = await call('POST','/api/login',{username:'admin',password:'yanlis'}); assert(r.status===401,'yanlış şifre');
  r = await call('POST','/api/login',{username:'admin',password:'1234'}); assert(r.status===200 && r.token && r.forcePasswordChange,'login + şifre değiştir zorunlu'); token=r.token;
  r = await call('POST','/api/me/password',{current:'1234',next:'Otel2026!'}); assert(r.ok,'şifre değişti');
  r = await call('GET','/api/state'); assert(r.rooms.length===4 && r.users && r.settings.hotel_name,'state (admin) geldi');

  // rooms
  r = await call('POST','/api/rooms',{id:'201',type:'Suit',price:3000,extraPersonPrice:800,capacity:2}); assert(r.ok,'oda ekle');
  r = await call('POST','/api/rooms',{id:'201',type:'Suit',price:3000}); assert(r.status===409,'mükerrer oda engellendi');

  // quote: per_room, 2 adults within cap, 3 nights
  const today = new Date(); const d=(n)=>{const x=new Date(today.getFullYear(),today.getMonth(),today.getDate()+n); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;};
  r = await call('POST','/api/quote',{roomId:'201',checkIn:d(10),checkOut:d(13),adultCount:3,childCount:0}); assert(r.nights===3 && r.total===3*(3000+800),'fiyat: oda bazlı + ek kişi = '+r.total);
  r = await call('PUT','/api/settings',{weekend_multiplier:'2',weekend_days:'0,1,2,3,4,5,6'}); assert(r.ok,'ayar: hafta sonu çarpanı');
  r = await call('POST','/api/quote',{roomId:'201',checkIn:d(10),checkOut:d(11),adultCount:1}); assert(r.total===6000,'çarpan uygulandı = '+r.total);
  await call('PUT','/api/settings',{weekend_multiplier:'1'});
  r = await call('POST','/api/quote',{roomId:'201',checkIn:d(3),checkOut:d(3)}); assert(r.status===400,'0 gece reddedildi');

  // reservation today -> Dolu
  r = await call('POST','/api/reservations',{roomId:'101',checkIn:d(0),checkOut:d(2),adultCount:2,guests:[{name:'Ali Veli',phone:'05551112233',tc:'11111111110',birthDate:'1990-01-01'},{name:'Ayşe Veli',tc:'22222222220'}],advancePayment:500,advanceMethod:'Kart',source:'Telefon'}); assert(r.ok && r.status==='Dolu','bugün giriş → Dolu'); const rez1=r.id;
  r = await call('POST','/api/reservations',{roomId:'101',checkIn:d(1),checkOut:d(3),guests:[{name:'Çakışan',phone:'1'}]}); assert(r.status===409,'çakışma engellendi');
  r = await call('POST','/api/reservations',{roomId:'101',checkIn:d(2),checkOut:d(4),guests:[{name:'Bitişik',phone:'2'}]}); assert(r.ok && r.status==='Rezerve','bitişik (checkout günü giriş) kabul → Rezerve'); const rez2=r.id;
  r = await call('POST','/api/reservations',{roomId:'101',checkIn:d(0),checkOut:d(1),guests:[{name:'X'}]}); assert(r.status===400,'telefon zorunlu');
  let st = await call('GET','/api/state');
  assert(st.rooms.find(x=>x.id==='101').status==='Dolu','oda 101 Dolu');
  assert(st.guests.length===3 && st.guests.find(g=>g.tc==='11111111110').visits===1,'misafirler upsert edildi (3)');
  let R1 = st.reservations.find(x=>x.id===rez1); assert(R1.totalPrice===2*1600 && R1.collectedTotal===500 && R1.remainingBalance===2700,'folyo hesap doğru');

  // minibar + payment
  r = await call('POST',`/api/reservations/${rez1}/minibar`,{name:'Kola',price:50,qty:2}); assert(r.ok,'minibar eklendi');
  r = await call('POST',`/api/reservations/${rez2}/minibar`,{name:'Kola',price:50}); assert(r.status===409,'rezerve kayda minibar yok');
  r = await call('POST','/api/payments',{reservationId:rez1,amount:1000,method:'Nakit'}); assert(r.ok,'ara ödeme');
  st = await call('GET','/api/state'); R1 = st.reservations.find(x=>x.id===rez1);
  assert(R1.minibarTotal===100 && R1.grandTotal===3300 && R1.collectedTotal===1500 && R1.remainingBalance===1800,'folyo güncel: kalan '+R1.remainingBalance);

  // receptionist role
  r = await call('POST','/api/users',{username:'resep',name:'Resepsiyon',password:'abcd',role:'receptionist'}); assert(r.ok,'resepsiyonist eklendi');
  const adminTok=token; r = await call('POST','/api/login',{username:'resep',password:'abcd'}); token=r.token; assert(!!token,'resep login');
  r = await call('GET','/api/state'); assert(r.status===200 && !r.users,'resep state (users gizli)');
  r = await call('POST','/api/rooms',{id:'999',type:'x',price:1}); assert(r.status===403,'resep oda ekleyemez');
  r = await call('DELETE',`/api/reservations/${rez2}`); assert(r.status===403,'resep silemez');
  // checkout as receptionist with split payment
  r = await call('POST',`/api/reservations/${rez1}/checkout`,{payments:[{amount:1000,method:'Kart'},{amount:800,method:'Nakit'}]}); assert(r.ok,'resep checkout (bölünmüş ödeme)');
  st = await call('GET','/api/state'); R1 = st.reservations.find(x=>x.id===rez1);
  assert(R1.status==='Tamamlandı' && R1.remainingBalance===0 && R1.collectedTotal===3300,'checkout sonrası kalan 0');
  const room101 = st.rooms.find(x=>x.id==='101'); assert(room101.status==='Boş' && room101.clean===0,'oda Boş + Kirli');
  r = await call('POST','/api/rooms/101/clean',{clean:true}); assert(r.ok,'temizlendi');
  // checkin rez2 early? checkIn=d(2) — allowed by checkin endpoint (Rezerve) 
  r = await call('POST',`/api/reservations/${rez2}/checkin`); assert(r.ok,'erken check-in');
  r = await call('POST',`/api/reservations/${rez2}/cancel`); assert(r.ok,'iptal'); 
  st = await call('GET','/api/state'); assert(st.rooms.find(x=>x.id==='101').status==='Boş','iptal sonrası oda Boş');

  // move via PUT, rename room propagates
  token=adminTok;
  r = await call('POST','/api/reservations',{roomId:'102',checkIn:d(5),checkOut:d(7),guests:[{name:'Taşınacak',phone:'3'}]}); const rez3=r.id;
  r = await call('PUT',`/api/reservations/${rez3}`,{roomId:'103',checkIn:d(6),checkOut:d(8)}); assert(r.ok,'rezervasyon taşındı');
  r = await call('PUT','/api/rooms/103',{id:'303'}); assert(r.ok,'oda yeniden adlandırıldı');
  st = await call('GET','/api/state'); assert(st.reservations.find(x=>x.id===rez3).roomId==='303','rezervasyon yeni oda no aldı');
  r = await call('DELETE','/api/rooms/303'); assert(r.status===409,'aktif rezervasyonlu oda silinemez');

  // KBS & ical
  r = await fetch(base+`/api/export?type=kbs&date=${d(0)}&token=${token}`); const kbs=await r.text(); assert(kbs.includes('11111111110') && kbs.includes('22222222220'),'KBS csv iki misafiri içeriyor');
  r = await fetch(base+`/api/export?type=ical&roomId=303&token=${token}`); const ics=await r.text(); assert(ics.includes('BEGIN:VEVENT'),'ical export');
  r = await call('POST','/api/import',{roomId:'104',ics:`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:abc@booking\nDTSTART;VALUE=DATE:${d(20).replace(/-/g,'')}\nDTEND;VALUE=DATE:${d(22).replace(/-/g,'')}\nSUMMARY:Booking.com\nEND:VEVENT\nEND:VCALENDAR`}); assert(r.added===1,'ical import 1 eklendi');
  r = await call('POST','/api/import',{roomId:'104',ics:`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:abc@booking\nDTSTART;VALUE=DATE:${d(20).replace(/-/g,'')}\nDTEND;VALUE=DATE:${d(22).replace(/-/g,'')}\nEND:VEVENT\nEND:VCALENDAR`}); assert(r.added===0 && r.skipped===1,'ical tekrar → atlandı');

  // backup & json roundtrip
  r = await call('POST','/api/backup'); assert(r.ok && fs.existsSync(r.file),'yedek dosyası var');
  r = await fetch(base+`/api/export?type=json&token=${token}`); const dump=await r.json(); assert(dump.reservations.length>=3,'json export');
  r = await call('POST','/api/reset'); assert(r.ok,'reset');
  st = await call('GET','/api/state'); assert(st.rooms.length===0,'reset sonrası boş');
  r = await call('POST','/api/import',dump); assert(r.ok,'json import');
  st = await call('GET','/api/state'); const RR=st.reservations.find(x=>x.id===rez1); assert(RR && RR.collectedTotal===3300 && RR.minibarTotal===100,'import sonrası folyo korundu');

  // rate limit
  token=null; for(let i=0;i<5;i++) await call('POST','/api/login',{username:'admin',password:'x'}); r=await call('POST','/api/login',{username:'admin',password:'Otel2026!'}); assert(r.status===429,'5 hatalı → kilit');

  // audit
  token=adminTok; r = await (await fetch(base+'/api/audit',{headers:{Authorization:'Bearer '+token}})).json(); assert(Array.isArray(r) && r.length>10,'audit log dolu ('+r.length+')');
  await s.stop(); console.log(process.exitCode?'\nSOME TESTS FAILED':'\nALL TESTS PASSED');
})().catch(e=>{console.error(e);process.exit(1);});
