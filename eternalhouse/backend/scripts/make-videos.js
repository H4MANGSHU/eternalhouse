'use strict';
// One product film per catalog row → frontend/public/media/<RECORD_ID>/product.mp4 (cuts through that product's 5 photos with a slow push-in).
// Resumable: node scripts/make-videos.js [--max-seconds 140] [--only E1001]   (needs ffmpeg + rsvg-convert)
const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawnSync } = require('child_process'); const art = require('../src/services/art');
const root = path.join(__dirname, '..');
const text = fs.readFileSync(path.join(root, 'data', 'catalog.csv'), 'utf8');
function parse(t) { const rows = []; let f = [], c = '', q = false; for (let i = 0; i < t.length; i++) { const ch = t[i];
  if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
  else if (ch === '"') q = true; else if (ch === ',') { f.push(c); c = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; f.push(c); c = ''; if (f.length > 1) rows.push(f); f = []; } else c += ch; }
  if (c || f.length) { f.push(c); rows.push(f); } return rows; }
const [head, ...data] = parse(text.replace(/^\uFEFF/, ''));
const rows = data.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]]))).filter((r) => r.record_id && !r.record_id.startsWith('F'));
const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
const maxMs = (Number(arg('--max-seconds')) || 1e9) * 1000, only = arg('--only'), t0 = Date.now();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-'));
let made = 0, skipped = 0, left = 0;
for (const r of rows) {
  if (only && r.record_id !== only) continue;
  const dir = path.join(require('../src/config/paths').media, r.record_id), out = path.join(dir, 'product.mp4');
  if (fs.existsSync(out) && fs.statSync(out).size > 2000) { skipped++; continue; }
  if (Date.now() - t0 > maxMs) { left++; continue; }
  const p = { brand: r.brand, name: r.item, category: r.category, subcategory: r.subcategory };
  for (let v = 1; v <= art.VARIANTS; v++) {
    fs.writeFileSync(path.join(tmp, `s${v}.svg`), art.render(p, v));
    const k = spawnSync('rsvg-convert', ['-w', '540', '-h', '675', '-o', path.join(tmp, `f${v}.png`), path.join(tmp, `s${v}.svg`)]);
    if (k.status !== 0) throw new Error('rsvg failed ' + r.record_id + ' ' + k.stderr);
  }
  const h = parseInt(require('crypto').createHash('md5').update(r.record_id).digest('hex').slice(0, 6), 16);
  const fx = ((h % 100) / 100).toFixed(2), fy = (((h >> 7) % 100) / 100).toFixed(2), zin = h % 2 === 0;
  const z = zin ? "min(1+0.0016*on,1.25)" : "max(1.25-0.0016*on,1)";
  fs.mkdirSync(dir, { recursive: true });
  const f = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '1', '-i', path.join(tmp, 'f%d.png'), '-vf',
    `zoompan=z='${z}':x='(iw-iw/zoom)*${fx}':y='(ih-ih/zoom)*${fy}':d=16:s=360x450:fps=20,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '33', '-movflags', '+faststart', out]);
  if (f.status !== 0) throw new Error('ffmpeg failed ' + r.record_id + ' ' + f.stderr);
  made++;
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`made ${made}, already had ${skipped}, remaining ${left}  (${Math.round((Date.now() - t0) / 1000)}s)`);
