'use strict';
// Deterministic, lightweight (~3-6 KB) SVG product visuals. 5 views per product:
//   1 = Studio, 2 = Detail close-up, 3 = Editorial. Real photos in frontend/public/media/<RECORD_ID>/ override these.
const crypto = require('crypto');

const PALETTES = [
  { bg1: '#15120d', bg2: '#2b2216', c1: '#d9b66a', c2: '#8a6a2b', hi: '#f6e7bd' }, // ink & gold
  { bg1: '#1b0a0d', bg2: '#3a1218', c1: '#b3283a', c2: '#5e0f1e', hi: '#f0b8bf' }, // oxblood
  { bg1: '#06161a', bg2: '#0c2a30', c1: '#2f9c8a', c2: '#0f5a55', hi: '#bff0e3' }, // emerald
  { bg1: '#0a0d18', bg2: '#16203c', c1: '#8fa3d6', c2: '#3b4d86', hi: '#e2e9ff' }, // midnight
  { bg1: '#150b17', bg2: '#2c1530', c1: '#c07ac6', c2: '#6b2a77', hi: '#f2d3f5' }, // aubergine
  { bg1: '#140e0a', bg2: '#2a1d14', c1: '#c08a5b', c2: '#6b4427', hi: '#f1d9c0' }, // espresso
  { bg1: '#101010', bg2: '#242424', c1: '#d8d8d8', c2: '#7c7c7c', hi: '#ffffff' }, // noir & silver
  { bg1: '#1a1408', bg2: '#33280f', c1: '#e6c35c', c2: '#9b7414', hi: '#fff3c4' }, // sun gold
];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hash = (s) => parseInt(crypto.createHash('md5').update(s).digest('hex').slice(0, 8), 16);

function groupOf(p) {
  const t = `${p.category} ${p.subcategory} ${p.name}`.toLowerCase();
  if (/watch/.test(t)) return 'watch';
  if (/sunglass/.test(t)) return 'glasses';
  if (/necklace/.test(t)) return 'necklace';
  if (/earring/.test(t)) return 'earrings';
  if (/brooch/.test(t)) return 'brooch';
  if (/belt/.test(t) && !/cummerbund/.test(t)) return 'belt';
  if (/scarf|stole|cummerbund/.test(t)) return 'scarf';
  if (/\bcap\b/.test(t)) return 'cap';
  if (/clutch/.test(t)) return 'clutch';
  if (/\bbag|tote|pouch|baguette/.test(t)) return 'bag';
  if (/boot/.test(t)) return 'boot';
  if (/sneaker|samba|mexico 66|moon shoe|air max|speedcat|jelly|boat/.test(t)) return 'sneaker';
  if (/heel|pump|slingback|wedge|sandal|thong/.test(t)) return 'heel';
  if (/flat|ballet|loafer|mule|slipper|shoe/.test(t)) return 'flat';
  if (/dress|gown/.test(t)) return 'dress';
  if (/skirt/.test(t)) return 'skirt';
  if (/trouser|pant|jean|bloomer|bottom/.test(t)) return 'trousers';
  return 'top';
}

// local coordinate space: roughly -200..200 square, origin at centre
const SHAPES = {
  bag: () => `<path d="M-70 -92C-70 -200 70 -200 70 -92" fill="none" stroke="url(#pg)" stroke-width="14" stroke-linecap="round"/><path d="M-150 -40Q-150 -92 -100 -92H100Q150 -92 150 -40L172 120Q174 162 130 162H-130Q-174 162 -172 120Z" fill="url(#pg)"/><path d="M-152 -38Q0 50 152 -38" fill="none" stroke="var(--hi)" stroke-opacity=".5" stroke-width="3"/><circle cx="0" cy="12" r="13" fill="var(--hi)"/>`,
  clutch: () => `<path d="M-180 -70H180Q196 -70 196 -54V90Q196 106 180 106H-180Q-196 106 -196 90V-54Q-196 -70 -180 -70Z" fill="url(#pg)"/><path d="M-194 -60L0 30L194 -60" fill="none" stroke="var(--hi)" stroke-opacity=".55" stroke-width="3"/><circle cx="0" cy="30" r="12" fill="var(--hi)"/>`,
  sneaker: () => `<path d="M-196 86H196Q206 86 206 66V54H-196Z" fill="var(--hi)" fill-opacity=".9"/><path d="M-196 54V-8Q-196 -30 -172 -34L-62 -58Q-22 -92 22 -58L64 -20Q126 0 186 22Q206 32 206 54Z" fill="url(#pg)"/><path d="M-30 -52L10 -20M-8 -62L32 -30M14 -66L54 -34" stroke="var(--hi)" stroke-width="5" stroke-linecap="round"/><path d="M-196 20H206" stroke="var(--hi)" stroke-opacity=".35" stroke-width="3"/>`,
  heel: () => `<path d="M-176 48C-176 -14 -128 -50 -64 -42C-14 -34 22 -96 64 -112C74 -44 122 16 178 58L178 82C100 92 40 84 -176 84Z" fill="url(#pg)"/><path d="M118 82H150L132 196H120Z" fill="var(--hi)"/><path d="M-176 84C-60 92 60 96 178 82" stroke="var(--hi)" stroke-opacity=".5" stroke-width="3" fill="none"/>`,
  flat: () => `<path d="M-184 72C-184 20 -124 -2 -62 8C0 18 44 -22 104 8C164 34 194 50 194 72V94H-184Z" fill="url(#pg)"/><path d="M-60 8C-20 40 40 40 70 0" fill="none" stroke="var(--hi)" stroke-opacity=".6" stroke-width="4"/><path d="M-184 94H194" stroke="var(--hi)" stroke-width="6"/>`,
  boot: () => `<path d="M-84 -170H44L54 16Q154 28 194 82V108H-154V64Q-84 42 -84 -170Z" fill="url(#pg)"/><path d="M-154 108H194" stroke="var(--hi)" stroke-width="8"/><path d="M-84 -120H44" stroke="var(--hi)" stroke-opacity=".5" stroke-width="3"/>`,
  dress: () => `<path d="M-46 -196L-30 -196L-6 -150H6L30 -196L46 -196L58 -96L34 -58L176 196Q0 222 -176 196L-34 -58L-58 -96Z" fill="url(#pg)"/><path d="M-34 -58L34 -58" stroke="var(--hi)" stroke-width="5"/><path d="M-20 -52L-120 190M20 -52L120 190M0 -52V204" stroke="var(--hi)" stroke-opacity=".25" stroke-width="3"/>`,
  top: () => `<path d="M-64 -176L-22 -196H22L64 -176L176 -112L154 44L112 22V196H-112V22L-154 44L-176 -112Z" fill="url(#pg)"/><path d="M-22 -196L0 -150L22 -196" fill="none" stroke="var(--hi)" stroke-width="5"/><path d="M0 -150V196" stroke="var(--hi)" stroke-opacity=".4" stroke-width="3"/><circle cx="0" cy="-60" r="5" fill="var(--hi)"/><circle cx="0" cy="0" r="5" fill="var(--hi)"/><circle cx="0" cy="60" r="5" fill="var(--hi)"/>`,
  trousers: () => `<path d="M-112 -184H112L134 196H24L0 -16L-24 196H-134Z" fill="url(#pg)"/><path d="M-112 -150H112" stroke="var(--hi)" stroke-width="6"/><path d="M0 -184V-16" stroke="var(--hi)" stroke-opacity=".5" stroke-width="3"/>`,
  skirt: () => `<path d="M-92 -184H92L178 196H-178Z" fill="url(#pg)"/><path d="M-92 -150H92" stroke="var(--hi)" stroke-width="6"/><path d="M-30 -150L-92 196M30 -150L92 196" stroke="var(--hi)" stroke-opacity=".3" stroke-width="3"/>`,
  watch: () => `<rect x="-44" y="-200" width="88" height="130" rx="18" fill="url(#pg)"/><rect x="-44" y="70" width="88" height="130" rx="18" fill="url(#pg)"/><rect x="-96" y="-100" width="192" height="200" rx="34" fill="var(--hi)"/><rect x="-80" y="-84" width="160" height="168" rx="24" fill="#0c0c0c"/><path d="M0 0V-52M0 0L34 22" stroke="var(--hi)" stroke-width="6" stroke-linecap="round"/><circle r="7" fill="var(--hi)"/>`,
  glasses: () => `<path d="M-188 -30H-20Q-24 80 -90 86Q-170 90 -188 -30Z" fill="url(#pg)"/><path d="M188 -30H20Q24 80 90 86Q170 90 188 -30Z" fill="url(#pg)"/><path d="M-20 -22Q0 -48 20 -22" fill="none" stroke="var(--hi)" stroke-width="8"/><path d="M-188 -30L-206 -60M188 -30L206 -60" stroke="var(--hi)" stroke-width="8" stroke-linecap="round"/><path d="M-150 -6Q-110 -14 -76 -6" stroke="#fff" stroke-opacity=".35" stroke-width="5" fill="none"/>`,
  necklace: () => {
    let d = '';
    for (let i = 0; i <= 18; i++) { const a = Math.PI * (0.08 + (i / 18) * 0.84); d += `<circle cx="${(-Math.cos(a) * 170).toFixed(1)}" cy="${(Math.sin(a) * 190 - 110).toFixed(1)}" r="${i === 9 ? 0 : 11}" fill="var(--hi)"/>`; }
    return d + '<path d="M0 74L28 110L0 150L-28 110Z" fill="url(#pg)"/>';
  },
  earrings: () => `<g fill="none" stroke="var(--hi)" stroke-width="5"><path d="M-90 -170V-120M90 -170V-120"/></g><path d="M-90 -120L-50 0L-90 120L-130 0Z" fill="url(#pg)"/><path d="M90 -120L130 0L90 120L50 0Z" fill="url(#pg)"/><circle cx="-90" cy="150" r="20" fill="var(--hi)"/><circle cx="90" cy="150" r="20" fill="var(--hi)"/>`,
  brooch: () => { let d = ''; for (let i = 0; i < 8; i++) d += `<ellipse cx="0" cy="-74" rx="38" ry="76" fill="url(#pg)" transform="rotate(${i * 45})"/>`; return d + '<circle r="34" fill="var(--hi)"/>'; },
  belt: () => `<rect x="-210" y="-26" width="420" height="52" rx="10" fill="url(#pg)"/><rect x="-62" y="-72" width="124" height="144" rx="16" fill="none" stroke="var(--hi)" stroke-width="14"/><rect x="-6" y="-72" width="12" height="144" fill="var(--hi)"/><circle cx="-150" cy="0" r="6" fill="var(--hi)"/><circle cx="150" cy="0" r="6" fill="var(--hi)"/>`,
  scarf: () => `<path d="M-210 -90C-140 -170 -80 -10 0 -90C80 -170 140 -10 210 -90V10C140 90 80 -70 0 10C-80 90 -140 -70 -210 10Z" fill="url(#pg)"/><path d="M-210 10C-140 90 -80 -70 0 10" fill="none" stroke="var(--hi)" stroke-opacity=".5" stroke-width="3"/><path d="M-170 10V110M-140 10V120M-110 10V108M170 -10V90M140 -10V100M110 -10V88" stroke="var(--hi)" stroke-width="4" stroke-linecap="round"/>`,
  cap: () => `<path d="M-150 40C-150 -120 -60 -150 0 -150C60 -150 150 -120 150 40Z" fill="url(#pg)"/><path d="M-150 40C-60 20 70 20 210 70C200 100 80 88 -150 70Z" fill="var(--hi)" fill-opacity=".92"/><circle cx="0" cy="-150" r="10" fill="var(--hi)"/><path d="M0 -146V40" stroke="var(--hi)" stroke-opacity=".35" stroke-width="3"/>`,
};

// ---- per-product colourway: 360 hues × saturation/lightness spread, so no two products share a palette ----
const hex = (h, sat, l) => { sat /= 100; l /= 100; const k = (n) => (n + h / 30) % 12; const a = sat * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join(''); };
function paletteFor(seed) {
  const h = seed % 360, h2 = (h + 140 + ((seed >> 9) % 80)) % 360, sat = 42 + ((seed >> 12) % 28), lt = 50 + ((seed >> 16) % 14);
  return { h, bg1: hex((h + 20) % 360, 40, 5), bg2: hex(h, sat - 8, 13 + ((seed >> 20) % 5)), c1: hex(h, sat + 12, lt + 6), c2: hex(h, sat + 16, lt - 22),
    hi: hex(h, 72, 88), acc: hex(h2, sat + 14, 56), acc2: hex(h2, 46, 16), paper: hex(h, 26, 92), ink: hex(h, 30, 10) };
}
function pattern(seed, color, op) {
  const t = (seed >> 8) % 4;
  if (t === 0) return '';
  const body = t === 1 ? `<path d="M0 0V22" stroke="${color}" stroke-opacity="${op}" stroke-width="2"/>`
    : t === 2 ? `<circle cx="11" cy="11" r="2.4" fill="${color}" fill-opacity="${op}"/>` : `<path d="M0 0H22M0 0V22" stroke="${color}" stroke-opacity="${op}" stroke-width="1.5"/>`;
  return `<pattern id="pt" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(${t === 1 ? 35 : 0})">${body}</pattern><rect width="800" height="1000" fill="url(#pt)"/>`;
}
const NAMES = { 1: 'STUDIO', 2: 'DETAIL', 3: 'EDITORIAL', 4: 'ANGLE', 5: 'FLAT-LAY' };
const VARIANTS = 5;

// 5 distinct views per product: 1 Studio, 2 Detail close-up, 3 Editorial (light), 4 Side angle (mirrored, spotlight), 5 Flat-lay (swatches + SKU)
function render(product, variant) {
  const seed = hash(`${product.brand}|${product.name}`);
  const P = paletteFor(seed);
  const g = groupOf(product);
  const brand = esc(product.brand.toUpperCase().slice(0, 28));
  const sx = 0.9 + ((seed >> 5) % 21) / 100; // 0.90–1.10 width tweak so shapes differ per product
  const rot = ((seed >> 4) % 11) - 5;
  const hiLight = P.c2;
  const shapeFor = (hi) => SHAPES[g]().replace(/var\(--hi\)/g, hi);
  const light = variant === 3, v5 = variant === 5;
  const bgFill = light ? P.paper : v5 ? P.bg2 : 'url(#bg)';
  const tx = light ? P.ink : '#f4efe6';
  const T = {
    1: `translate(400 480) scale(${(1.5 * sx).toFixed(3)} 1.5) rotate(${rot})`,
    2: `translate(${300 + (seed % 120)} ${520 + ((seed >> 3) % 80)}) scale(${(3.1 * sx).toFixed(3)} 3.1) rotate(${-8 + (seed % 7)})`,
    3: `translate(${440 - (seed % 60)} 500) scale(${(1.2 * sx).toFixed(3)} 1.2) rotate(${rot + 7})`,
    4: `translate(400 480) scale(${(-1.45 * sx).toFixed(3)} 1.45) rotate(${-14 - (seed % 6)})`,
    5: `translate(400 360) scale(${(0.82 * sx).toFixed(3)} 0.82) rotate(${rot})`,
  }[variant];
  const hi = light ? hiLight : P.hi;
  const sku = 'EH-' + String(1000 + (seed % 9000));
  let extras = '';
  if (variant === 3) extras = `<text x="-20" y="560" font-family="Georgia,serif" font-size="300" fill="${P.ink}" fill-opacity=".055" transform="rotate(-90 400 500)" textLength="1000" lengthAdjust="spacingAndGlyphs">${esc(product.brand.toUpperCase().slice(0, 10))}</text>`;
  if (variant === 4) extras = `<linearGradient id="sp" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${P.acc}" stop-opacity=".42"/><stop offset=".6" stop-color="${P.acc}" stop-opacity="0"/></linearGradient><rect width="800" height="1000" fill="url(#sp)"/><path d="M0 800H800" stroke="${P.acc}" stroke-opacity=".35" stroke-width="2"/>`;
  if (v5) extras = `<g stroke="${P.c1}" stroke-opacity=".12" stroke-width="1">${Array.from({ length: 9 }, (_, i) => `<path d="M${60 + i * 85} 40V960M40 ${60 + i * 100}H760"/>`).join('')}</g>`
    + `<g><circle cx="150" cy="730" r="44" fill="${P.c1}"/><circle cx="260" cy="730" r="44" fill="${P.c2}"/><circle cx="370" cy="730" r="44" fill="${P.hi}"/><circle cx="480" cy="730" r="44" fill="${P.acc}"/></g>`
    + `<text x="60" y="840" font-family="Georgia,serif" font-size="22" letter-spacing="5" fill="#f4efe6" fill-opacity=".75">${sku} · SIZES ${['XS–L', 'S–XL', '36–42', '38–45', 'ONE SIZE'][seed % 5]}</text>`;
  const shadow = variant === 2 || v5 ? '' : `<ellipse cx="400" cy="${variant === 1 ? 800 : 820}" rx="${variant === 1 ? 250 : 200}" ry="26" fill="#000" fill-opacity="${light ? '.14' : '.45'}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" role="img" aria-label="${esc(product.name)} — ${NAMES[variant].toLowerCase()} view">
<defs><linearGradient id="bg" x1="${variant === 4 ? 1 : 0}" y1="0" x2="${variant === 4 ? 0 : 1}" y2="1"><stop offset="0" stop-color="${P.bg2}"/><stop offset="1" stop-color="${P.bg1}"/></linearGradient>
<linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${P.c1}"/><stop offset="1" stop-color="${P.c2}"/></linearGradient>
<radialGradient id="gl" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="${P.c1}" stop-opacity="${light ? '.25' : '.38'}"/><stop offset="1" stop-color="${P.c1}" stop-opacity="0"/></radialGradient>
<clipPath id="cp"><rect width="800" height="1000"/></clipPath></defs>
<rect width="800" height="1000" fill="${bgFill}"/>${variant === 2 || variant === 1 ? pattern(seed, hi, variant === 2 ? 0.1 : 0.05) : ''}<rect width="800" height="1000" fill="url(#gl)"/>${extras}
<g clip-path="url(#cp)">${shadow}<g transform="${T}">${shapeFor(hi)}</g></g>
<rect x="28" y="28" width="744" height="944" fill="none" stroke="${P.c1}" stroke-opacity=".55" stroke-width="1.5"/>
<text x="60" y="930" font-family="Georgia,serif" font-size="26" letter-spacing="8" fill="${tx}" fill-opacity=".92">${brand}</text>
<text x="60" y="76" font-family="Georgia,serif" font-size="15" letter-spacing="6" fill="${tx}" fill-opacity=".6">${NAMES[variant]} · 0${variant}/0${VARIANTS}</text>
</svg>`;
}

function renderLook(look) {
  const seed = hash(look.title);
  const pal = PALETTES[seed % PALETTES.length];
  const words = esc(look.title.split('(')[0].slice(0, 46));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" role="img" aria-label="${words}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pal.bg2}"/><stop offset="1" stop-color="${pal.bg1}"/></linearGradient>
<radialGradient id="gl" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="${pal.c1}" stop-opacity=".4"/><stop offset="1" stop-color="${pal.c1}" stop-opacity="0"/></radialGradient></defs>
<rect width="800" height="1000" fill="url(#bg)"/><rect width="800" height="1000" fill="url(#gl)"/>
<text x="400" y="560" text-anchor="middle" font-family="Georgia,serif" font-size="300" fill="${pal.hi}" fill-opacity=".12">${look.year || ''}</text>
<rect x="28" y="28" width="744" height="944" fill="none" stroke="${pal.c1}" stroke-opacity=".55" stroke-width="1.5"/>
<text x="60" y="880" font-family="Georgia,serif" font-size="34" fill="#f4efe6">${words}</text>
<text x="60" y="930" font-family="Georgia,serif" font-size="20" letter-spacing="6" fill="${pal.c1}">${esc(String(look.designer).toUpperCase().slice(0, 34))}</text></svg>`;
}

module.exports = { render, renderLook, groupOf, VARIANTS };
