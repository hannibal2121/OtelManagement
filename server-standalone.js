'use strict';
/**
 * Electron olmadan yalnızca sunucuyu çalıştırır (Linux/NAS/sunucu kurulumları için).
 * Kullanım: MESOFT_DATA=/veri/klasoru MESOFT_PORT=8080 node server-standalone.js
 */
const path = require('path');
const fs = require('fs');
const { Server } = require('./server');

const dataDir = process.env.MESOFT_DATA || path.join(process.cwd(), 'data');
fs.mkdirSync(path.join(dataDir, 'yedekler'), { recursive: true });
const server = new Server({ dbPath: path.join(dataDir, 'mesoft_otel.db'), staticDir: __dirname, port: parseInt(process.env.MESOFT_PORT || '8080', 10), backupsDir: path.join(dataDir, 'yedekler') });

server.start().catch(e => { console.error(e); process.exit(1); });

// günlük yedek 03:00
let last = null;
setInterval(async () => { const n = new Date(); if (n.getHours() === 3 && last !== n.toDateString()) { last = n.toDateString(); try { console.log('Yedek:', await server.db.backup(path.join(dataDir, 'yedekler'))); } catch (e) { console.error(e); } } }, 60000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await server.stop(); process.exit(0); });
