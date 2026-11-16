'use strict';
// Seeds the catalog from data/catalog.csv (idempotent; preserves live stock on re-run).
// Drop real photos/videos in frontend/public/media/<RECORD_ID>/ (1.jpg 2.jpg 3.jpg, *.mp4) and re-run to attach them.
const fs = require('fs');
const path = require('path');
const cfg = require('../src/config/env');
const { makeMapper } = require('./pricing');
const { pool, query } = require('../src/db/pool');

function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [head, ...rest] = rows;
  return rest.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i].trim()])));
}

const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');

function mediaFor(recordId) {
  const dir = path.join(require('../src/config/paths').media, recordId);
  if (!fs.existsSync(dir)) return { images: [], videos: [] };
  const files = fs.readdirSync(dir).sort();
  return {
    images: files.filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f)).slice(0, 5).map((f) => `/media-files/${recordId}/${f}`),
    videos: files.filter((f) => /\.(mp4|webm)$/i.test(f)).slice(0, 1).map((f) => `/media-files/${recordId}/${f}`),
  };
}

async function main() {
  await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  const data = parseCsv(fs.readFileSync(path.join(__dirname, '..', 'data', 'catalog.csv'), 'utf8'));
  const priceOf = makeMapper(data.filter((r) => !r.record_id.startsWith('F')).map((r) => Number(r.price_usd)));
  const sold = /low stock|sold out|sellout|elusive|forecast to sell|predicted sellout|near-instant/i;
  let np = 0; let nl = 0; const slugs = new Set();

  for (const r of data) {
    const n = parseInt(r.record_id.slice(1), 10);
    if (r.record_id.startsWith('F')) {
      await query(
        `INSERT INTO lookbook (record_id, title, designer, category, gender, year, note, source, link)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (record_id) DO UPDATE SET title=EXCLUDED.title, designer=EXCLUDED.designer, category=EXCLUDED.category,
           gender=EXCLUDED.gender, year=EXCLUDED.year, note=EXCLUDED.note, source=EXCLUDED.source, link=EXCLUDED.link`,
        [r.record_id, r.item, r.brand, r.subcategory || r.category, r.gender, parseInt(r.year, 10) || null, r.demand_signal, r.source, r.link]);
      nl++; continue;
    }
    const usd = Number(r.price_usd);
    if (!Number.isFinite(usd)) continue;
    let slug = slugify(`${r.brand} ${r.item}`);
    if (slugs.has(slug)) slug += '-' + r.record_id.toLowerCase();
    slugs.add(slug);
    const stock = sold.test(r.demand_signal) ? 3 : 6 + ((n * 7) % 17);
    const { rows } = await query(
      `INSERT INTO products (record_id, slug, name, brand, category, subcategory, gender, price_usd, price_inr, stock,
         section, demand_signal, evidence_type, source, source_link, year, rank)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (record_id) DO UPDATE SET name=EXCLUDED.name, brand=EXCLUDED.brand, category=EXCLUDED.category,
         subcategory=EXCLUDED.subcategory, gender=EXCLUDED.gender, section=EXCLUDED.section, demand_signal=EXCLUDED.demand_signal,
         evidence_type=EXCLUDED.evidence_type, source=EXCLUDED.source, source_link=EXCLUDED.source_link, year=EXCLUDED.year, rank=EXCLUDED.rank
       RETURNING id`,
      [r.record_id, slug, r.item, r.brand, r.category, r.subcategory, r.gender, usd, priceOf(usd), stock,
        r.section, r.demand_signal, r.evidence_type, r.source, r.link, parseInt(r.year, 10) || null, n]);
    const id = rows[0].id;
    const real = mediaFor(r.record_id);
    await query('DELETE FROM product_media WHERE product_id=$1', [id]);
    for (let k = 1; k <= 5; k++) {
      const url = real.images[k - 1] || `/media/p/${id}/${k}.svg`;
      await query('INSERT INTO product_media (product_id, kind, url, position, alt) VALUES ($1,$2,$3,$4,$5)',
        [id, 'image', url, k, `${r.brand} ${r.item} — view ${k}`]);
    }
    if (real.videos[0]) await query('INSERT INTO product_media (product_id, kind, url, position, alt) VALUES ($1,$2,$3,1,$4)',
      [id, 'video', real.videos[0], `${r.brand} ${r.item} — film`]);
    np++;
  }
  console.log(`Seeded ${np} products and ${nl} lookbook entries.`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
