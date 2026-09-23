/**
 * Offline varlık hazırlama: Font Awesome dosyalarını node_modules'ten assets/ altına kopyalar.
 * Böylece uygulama internet olmadan da tam görünümle çalışır.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const faSrc = path.join(root, 'node_modules', '@fortawesome', 'fontawesome-free');
const faDst = path.join(root, 'assets', 'fontawesome');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name), d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(faSrc)) {
  console.warn('[prepare-assets] @fortawesome/fontawesome-free bulunamadı. `npm install` çalıştırın.');
  process.exit(0);
}
fs.mkdirSync(path.join(faDst, 'css'), { recursive: true });
fs.copyFileSync(path.join(faSrc, 'css', 'all.min.css'), path.join(faDst, 'css', 'all.min.css'));
copyDir(path.join(faSrc, 'webfonts'), path.join(faDst, 'webfonts'));
console.log('[prepare-assets] Font Awesome kopyalandı →', faDst);
