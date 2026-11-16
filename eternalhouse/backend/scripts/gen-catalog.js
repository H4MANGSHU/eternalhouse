'use strict';
// Appends 800 EternalHouse house-line products (E1001–E1800) to data/catalog.csv. Deterministic + idempotent.
// Brands are original EternalHouse labels; names are unique; prices stay inside the existing USD range so the ₹199–₹499 mapping is unchanged.
const fs = require('fs'); const path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'catalog.csv');
const text = fs.readFileSync(FILE, 'utf8');
if (/^E1001,/m.test(text)) { console.log('already generated'); process.exit(0); }
const usd = [...text.matchAll(/^R\d+,(?:[^,"]*|"[^"]*"),[^,]*,[^,]*,(?:[^,"]*|"[^"]*"),[^,]*,[^,]*,([\d.]+),/gm)].map((m) => Number(m[1]));
const LO = Math.min(...usd), HI = Math.max(...usd);
let s = 20260615; const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const BRANDS = ['Maison Verve', 'Atelier Noor', 'Noir & Co.', 'Casa Lumière', 'Studio Sable', 'Velour Row', 'Orchid Lane', 'Kasa Indigo', 'Aurum House', 'Saffron & Sage', 'Dune Atelier', 'Marlowe & Finch', 'Ivory Tide', 'Onyx Parade', 'Rouge Alley', 'Lotus Loom', 'Zephyr Mode', 'Ember Thread', 'Opal Street', 'Mira Vale', 'Halo Edit', 'Juniper & Jade', 'Pearl District', 'Cobalt Cove'];
const COLORS = ['Midnight', 'Ivory', 'Oxblood', 'Emerald', 'Saffron', 'Ink', 'Sand', 'Dune', 'Onyx', 'Rose', 'Cobalt', 'Olive', 'Plum', 'Ochre', 'Slate', 'Pearl', 'Cinder', 'Maroon', 'Teal', 'Amber', 'Blush', 'Charcoal', 'Indigo', 'Moss', 'Copper', 'Mint', 'Lilac', 'Cream'];
const M = {
  bag: ['Leather', 'Suede', 'Canvas', 'Quilted', 'Woven', 'Patent', 'Crochet', 'Nylon', 'Satin', 'Velvet'],
  watch: ['Steel', 'Gold-tone', 'Rose-gold', 'Leather-strap', 'Mesh-strap', 'Ceramic'],
  glasses: ['Acetate', 'Metal-rim', 'Tortoise', 'Oversized', 'Round', 'Cat-eye'],
  jewel: ['Gold-tone', 'Silver-tone', 'Pearl', 'Enamel', 'Crystal', 'Brass', 'Resin', 'Beaded'],
  belt: ['Leather', 'Suede', 'Woven', 'Patent', 'Chain', 'Canvas'],
  scarf: ['Silk', 'Wool-blend', 'Cashmere-blend', 'Linen', 'Jacquard', 'Satin'],
  cap: ['Cotton', 'Corduroy', 'Wool-blend', 'Nylon', 'Denim', 'Canvas'],
  shoe: ['Leather', 'Suede', 'Canvas', 'Mesh', 'Patent', 'Knit', 'Satin', 'Velvet'],
  cloth: ['Cotton', 'Linen', 'Satin', 'Denim', 'Wool-blend', 'Velvet', 'Jacquard', 'Organza', 'Tweed', 'Corduroy', 'Knit', 'Silk-blend', 'Crepe'],
};
const G = { W: ['Women'], U: ['Unisex'], M: ['Men', 'Unisex'], A: ['Women', 'Men', 'Unisex'] };
// [category, subcategory, type, materials, count, genders]
const PLAN = [
  ['Accessory', 'Bag', 'Tote Bag', 'bag', 25, 'W'], ['Accessory', 'Bag', 'Baguette Bag', 'bag', 20, 'W'], ['Accessory', 'Clutch', 'Clutch', 'bag', 20, 'W'],
  ['Accessory', 'Bag', 'Pouch', 'bag', 15, 'A'], ['Accessory', 'Bag', 'Bucket Bag', 'bag', 20, 'W'], ['Accessory', 'Watch', 'Watch', 'watch', 30, 'A'],
  ['Accessory', 'Sunglasses', 'Sunglasses', 'glasses', 30, 'A'], ['Accessory', 'Jewellery', 'Necklace', 'jewel', 15, 'W'], ['Accessory', 'Jewellery', 'Earrings', 'jewel', 15, 'W'],
  ['Accessory', 'Jewellery', 'Brooch', 'jewel', 10, 'A'], ['Accessory', 'Belt', 'Belt', 'belt', 15, 'A'], ['Accessory', 'Scarf', 'Scarf', 'scarf', 15, 'A'], ['Accessory', 'Cap', 'Cap', 'cap', 10, 'U'],
  ['Footwear', 'Sneaker', 'Sneaker', 'shoe', 35, 'U'], ['Footwear', 'Sneaker', 'Chunky Sneaker', 'shoe', 20, 'U'], ['Footwear', 'Loafer', 'Loafer', 'shoe', 25, 'A'],
  ['Footwear', 'Flat', 'Ballet Flat', 'shoe', 20, 'W'], ['Footwear', 'Mule', 'Mule', 'shoe', 20, 'W'], ['Footwear', 'Boot', 'Boot', 'shoe', 25, 'A'],
  ['Footwear', 'Boot', 'Chelsea Boot', 'shoe', 15, 'A'], ['Footwear', 'Heel', 'Heel', 'shoe', 15, 'W'], ['Footwear', 'Sandal', 'Sandal', 'shoe', 15, 'A'], ['Footwear', 'Heel', 'Slingback', 'shoe', 10, 'W'],
  ['Outfit', 'Jacket', 'Jacket', 'cloth', 25, 'A'], ['Outfit', 'Blazer', 'Blazer', 'cloth', 20, 'A'], ['Outfit', 'Shirt', 'Shirt', 'cloth', 25, 'A'], ['Outfit', 'Hoodie', 'Hoodie', 'cloth', 20, 'U'],
  ['Outfit', 'Knitwear', 'Knit Top', 'cloth', 20, 'A'], ['Outfit', 'T-Shirt', 'T-Shirt', 'cloth', 20, 'U'], ['Outfit', 'Trousers', 'Trousers', 'cloth', 25, 'A'], ['Outfit', 'Jeans', 'Jeans', 'cloth', 20, 'A'],
  ['Outfit', 'Skirt', 'Skirt', 'cloth', 15, 'W'], ['Outfit', 'Co-ord', 'Co-ord Set', 'cloth', 10, 'W'],
  ['Dress', 'Maxi', 'Maxi Dress', 'cloth', 30, 'W'], ['Dress', 'Slip', 'Slip Dress', 'cloth', 25, 'W'], ['Dress', 'Midi', 'Midi Dress', 'cloth', 30, 'W'], ['Dress', 'Shirt', 'Shirt Dress', 'cloth', 20, 'W'],
  ['Dress', 'Wrap', 'Wrap Dress', 'cloth', 20, 'W'], ['Dress', 'Gown', 'Gown', 'cloth', 15, 'W'], ['Dress', 'Mini', 'Mini Dress', 'cloth', 20, 'W'],
];
const q = (v) => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
const out = []; const seen = new Set(); let n = 1001;
for (const [cat, sub, type, mk, count, g] of PLAN) {
  const combos = shuffle(COLORS.flatMap((c) => M[mk].map((m) => `${c} ${m} ${type}`)));
  for (let i = 0; i < count; i++) {
    const item = combos[i]; if (seen.has(item)) throw new Error('dup ' + item); seen.add(item);
    const price = Math.round(Math.exp(Math.log(LO) + rnd() * (Math.log(HI * 0.97) - Math.log(LO))));
    out.push(['E' + n++, 'EternalHouse Collection 2026', cat, sub, item, pick(BRANDS), pick(G[g]), price, 2026, 'New in: EternalHouse house line', 'House catalogue', 'EternalHouse', '/shop'].map((v) => q(String(v))).join(','));
  }
}
fs.appendFileSync(FILE, (text.endsWith('\n') ? '' : '\n') + out.join('\n') + '\n');
console.log('added', out.length, 'products; usd range', LO, '-', HI);
