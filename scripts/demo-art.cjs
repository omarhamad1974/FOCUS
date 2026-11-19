// Draws the demo pictures (products, article covers, people, tournament photos) as SVG
// and saves them as JPEG files in public/demo/. Run: node scripts/demo-art.cjs
// Needs Playwright with Chromium (pre-installed in the cloud environment).
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, '..', 'public', 'demo');

const bg = (a, b, w, h) => `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
  <radialGradient id="ball" cx=".35" cy=".35" r=".7"><stop offset="0" stop-color="#fff"/><stop offset=".6" stop-color="#ffe0b8"/><stop offset="1" stop-color="#f59f45"/></radialGradient>
  <radialGradient id="ballw" cx=".35" cy=".35" r=".7"><stop offset="0" stop-color="#fff"/><stop offset=".7" stop-color="#eef1f6"/><stop offset="1" stop-color="#c9d1de"/></radialGradient>
  <linearGradient id="wood" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c58b4f"/><stop offset=".5" stop-color="#e2b07a"/><stop offset="1" stop-color="#a86b34"/></linearGradient>
  <linearGradient id="tbl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b6fd6"/><stop offset="1" stop-color="#173f87"/></linearGradient>
  <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="#000" flood-opacity=".28"/></filter>
  <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="2" fill="#fff" opacity=".12"/></pattern>
  </defs><rect width="${w}" height="${h}" fill="url(#bg)"/><rect width="${w}" height="${h}" fill="url(#dots)"/>
  <circle cx="${w * .85}" cy="${h * .15}" r="${h * .35}" fill="#fff" opacity=".08"/><circle cx="${w * .1}" cy="${h * .95}" r="${h * .4}" fill="#fff" opacity=".07"/>`;

const paddle = (x, y, s, rot, rubber, edge = '#222') => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" filter="url(#sh)">
  <rect x="-22" y="80" width="44" height="120" rx="14" fill="url(#wood)"/><path d="M-22 110h44M-22 140h44M-22 170h44" stroke="#8a5428" stroke-width="3" opacity=".5"/>
  <ellipse cx="0" cy="0" rx="92" ry="100" fill="${edge}"/><ellipse cx="0" cy="0" rx="86" ry="94" fill="${rubber}"/>
  <ellipse cx="-26" cy="-34" rx="36" ry="22" fill="#fff" opacity=".18" transform="rotate(-30)"/>
  <rect x="-14" y="62" width="28" height="30" rx="6" fill="#c58b4f"/></g>`;

const ball = (x, y, r, fill = 'url(#ball)') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" filter="url(#sh)"/>`;

const tableScene = (w, h, top = '#2b6fd6') => `<g filter="url(#sh)">
  <path d="M${w * .12} ${h * .72} L${w * .88} ${h * .72} L${w * .76} ${h * .46} L${w * .24} ${h * .46} Z" fill="${top}" stroke="#fff" stroke-width="5" stroke-linejoin="round"/>
  <path d="M${w * .5} ${h * .46} L${w * .5} ${h * .72}" stroke="#fff" stroke-width="3"/>
  <rect x="${w * .12}" y="${h * .72}" width="${w * .76}" height="${h * .03}" fill="#0b2453"/>
  <path d="M${w * .17} ${h * .75} v${h * .16} M${w * .83} ${h * .75} v${h * .16} M${w * .28} ${h * .5} v${h * .1} M${w * .72} ${h * .5} v${h * .1}" stroke="#0b2453" stroke-width="10" stroke-linecap="round"/>
  <rect x="${w * .27}" y="${h * .4}" width="${w * .46}" height="${h * .07}" fill="#ffffffcc" rx="2"/>
  <path d="M${w * .27} ${h * .43} h${w * .46}" stroke="#13213a" stroke-width="1.5" opacity=".3"/></g>`;

const player = (x, y, s, shirt, flip = 1, skin = '#e0ac69') => `<g transform="translate(${x} ${y}) scale(${s * flip} ${s})" filter="url(#sh)">
  <circle cx="0" cy="-150" r="30" fill="${skin}"/><path d="M-30 -158 q30 -40 60 0 q-10 -22 -30 -22 q-20 0 -30 22z" fill="#2b1d12"/>
  <path d="M-38 -110 q38 -20 76 0 l10 90 h-96z" fill="${shirt}"/>
  <path d="M38 -100 l60 -40" stroke="${skin}" stroke-width="18" stroke-linecap="round"/><path d="M-38 -100 l-40 50" stroke="${skin}" stroke-width="18" stroke-linecap="round"/>
  <ellipse cx="112" cy="-152" rx="22" ry="24" fill="#d62d2d" stroke="#222" stroke-width="3"/>
  <path d="M-28 -20 l-14 110 M28 -20 l18 108" stroke="#13213a" stroke-width="24" stroke-linecap="round"/>
  <path d="M-52 92 h24 M36 90 h26" stroke="#fff" stroke-width="12" stroke-linecap="round"/></g>`;

const W = 1200, H = 675;
const scenes = {
  // Article covers and tournament photos (1200×675)
  'news-medals': () => `${bg('#0f1b33', '#3b5bfd', W, H)}
    ${[['#f5b301', 430, 300, 110], ['#a9b4c6', 640, 330, 95], ['#d27d3f', 820, 350, 85]].map(([c, x, y, r]) => `<path d="M${x - 30} ${y - 260} L${x} ${y - r} L${x + 30} ${y - 260}" stroke="${c === '#f5b301' ? '#e5484d' : '#3b5bfd'}" stroke-width="34" fill="none"/>
      <circle cx="${x}" cy="${y}" r="${r}" fill="${c}" stroke="#fff" stroke-width="8" filter="url(#sh)"/><circle cx="${x}" cy="${y}" r="${r * .62}" fill="none" stroke="#fff" stroke-width="4" opacity=".6"/>
      <text x="${x}" y="${y + r * .25}" font-size="${r * .7}" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="900">★</text>`).join('')}
    ${Array.from({ length: 40 }, (_, i) => `<rect x="${(i * 97) % W}" y="${(i * 53) % (H * .6)}" width="10" height="18" fill="${['#f5b301', '#e5484d', '#12a37f', '#fff'][i % 4]}" transform="rotate(${i * 37} ${(i * 97) % W} ${(i * 53) % (H * .6)})" opacity=".8"/>`).join('')}`,
  'news-forehand': () => `${bg('#0e7c66', '#2fd1a6', W, H)}${tableScene(W, H, '#1f8a5a')}${player(260, 470, 1.25, '#e5484d', 1)}${ball(760, 200, 16)}
    <path d="M400 330 q180 -160 340 -120" stroke="#fff" stroke-width="5" stroke-dasharray="4 14" fill="none" opacity=".8"/>`,
  'news-rubber': () => `${bg('#13213a', '#e5484d', W, H)}${paddle(430, 320, 1.6, -22, '#d62d2d')}${paddle(780, 330, 1.6, 18, '#1d1d1d', '#d62d2d')}${ball(610, 560, 26)}`,
  'news-events': () => `${bg('#3b5bfd', '#8e4ec6', W, H)}
    <g filter="url(#sh)"><rect x="380" y="130" width="440" height="420" rx="34" fill="#fff"/><rect x="380" y="130" width="440" height="110" rx="34" fill="#e5484d"/><rect x="380" y="200" width="440" height="40" fill="#e5484d"/>
    <circle cx="470" cy="130" r="16" fill="#13213a"/><circle cx="730" cy="130" r="16" fill="#13213a"/>
    ${Array.from({ length: 12 }, (_, i) => `<rect x="${415 + (i % 4) * 100}" y="${270 + Math.floor(i / 4) * 90}" width="70" height="60" rx="12" fill="${i === 6 ? '#f5b301' : '#eef2fb'}"/>`).join('')}</g>
    ${ball(870, 520, 34)}${ball(320, 220, 22, 'url(#ballw)')}`,
  'news-tips': () => `${bg('#f08c00', '#ffd166', W, H)}
    <g filter="url(#sh)"><circle cx="600" cy="290" r="150" fill="#fff8d6"/><circle cx="600" cy="290" r="110" fill="#ffe27a"/>
    <rect x="545" y="430" width="110" height="70" rx="14" fill="#a9b4c6"/><path d="M545 455h110M545 478h110" stroke="#7d889b" stroke-width="6"/>
    <path d="M600 210 v90 l-40 40 M600 300 l40 40" stroke="#f08c00" stroke-width="12" stroke-linecap="round" fill="none"/></g>
    ${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M${600 + Math.cos(a * Math.PI / 180) * 185} ${290 + Math.sin(a * Math.PI / 180) * 185} L${600 + Math.cos(a * Math.PI / 180) * 235} ${290 + Math.sin(a * Math.PI / 180) * 235}" stroke="#fff" stroke-width="12" stroke-linecap="round"/>`).join('')}
    ${paddle(930, 380, 1.1, 24, '#d62d2d')}`,
  'news-kids': () => `${bg('#0091ff', '#7fd3ff', W, H)}${tableScene(W, H)}${player(240, 520, 0.95, '#f5b301', 1, '#c68642')}${player(960, 500, 0.95, '#12a37f', -1, '#f1c27d')}${ball(600, 240, 14)}`,
  'tour-hall': () => `${bg('#22386b', '#0f1b33', W, H)}
    ${[[260, 300, .55], [900, 300, .55], [580, 470, .9]].map(([x, y, s]) => `<g transform="translate(${x - 600 * s} ${y - 400 * s}) scale(${s})">${tableScene(1200, 675)}</g>`).join('')}
    ${Array.from({ length: 7 }, (_, i) => `<rect x="${60 + i * 170}" y="20" width="100" height="16" rx="8" fill="#fff" opacity=".7"/>`).join('')}`,
  'tour-podium': () => `${bg('#f5b301', '#f08c00', W, H)}
    <g filter="url(#sh)"><rect x="470" y="300" width="260" height="300" rx="10" fill="#fff"/><rect x="220" y="380" width="250" height="220" rx="10" fill="#eef2fb"/><rect x="730" y="430" width="250" height="170" rx="10" fill="#e6ebf5"/>
    <text x="600" y="470" font-size="120" text-anchor="middle" font-family="sans-serif" font-weight="900" fill="#f5b301">1</text>
    <text x="345" y="520" font-size="100" text-anchor="middle" font-family="sans-serif" font-weight="900" fill="#a9b4c6">2</text>
    <text x="855" y="550" font-size="90" text-anchor="middle" font-family="sans-serif" font-weight="900" fill="#d27d3f">3</text></g>
    <g filter="url(#sh)" transform="translate(600 170)"><path d="M-70 -90 h140 v60 a70 70 0 0 1 -140 0z" fill="#ffe27a" stroke="#fff" stroke-width="6"/><rect x="-14" y="38" width="28" height="40" fill="#ffe27a"/><rect x="-50" y="78" width="100" height="22" rx="6" fill="#13213a"/></g>`,
  'tour-final': () => `${bg('#e5484d', '#8e4ec6', W, H)}${tableScene(W, H, '#1d4fb5')}${player(220, 500, 1.1, '#13213a', 1, '#f1c27d')}${player(980, 490, 1.1, '#f5b301', -1, '#8d5524')}${ball(640, 180, 16)}`,
};

// Products (800×800)
const PW = 800;
const products = {
  'p-racket-pro': () => `${bg('#13213a', '#3b5bfd', PW, PW)}${paddle(400, 340, 2.1, -18, '#d62d2d')}${ball(640, 640, 30)}`,
  'p-racket-starter': () => `${bg('#12a37f', '#2fd1a6', PW, PW)}${paddle(330, 330, 1.7, -24, '#d62d2d')}${paddle(500, 400, 1.7, 20, '#1d1d1d', '#d62d2d')}`,
  'p-balls': () => `${bg('#f08c00', '#ffd166', PW, PW)}<g filter="url(#sh)"><rect x="200" y="220" width="400" height="200" rx="24" fill="#fff"/><rect x="200" y="220" width="400" height="56" rx="24" fill="#e5484d"/>
    <text x="400" y="262" font-size="34" text-anchor="middle" font-family="sans-serif" font-weight="900" fill="#fff">★★★</text></g>
    ${[[280, 360], [400, 360], [520, 360]].map(([x, y]) => ball(x, y, 46, 'url(#ballw)')).join('')}${[[300, 560], [420, 600], [540, 560]].map(([x, y]) => ball(x, y, 60, 'url(#ball)')).join('')}`,
  'p-tshirt': () => `${bg('#8e4ec6', '#d6a4ff', PW, PW)}<g filter="url(#sh)"><path d="M250 190 l90 -40 q60 40 120 0 l90 40 l90 110 l-80 60 l-40 -40 v330 h-240 v-330 l-40 40 l-80 -60z" fill="#0f1b33"/>
    <path d="M250 190 l90 -40 q60 40 120 0 l90 40" stroke="#f5b301" stroke-width="10" fill="none"/>
    <circle cx="400" cy="360" r="54" fill="url(#ball)"/><text x="400" y="480" font-size="44" text-anchor="middle" font-family="sans-serif" font-weight="900" fill="#fff">PINGO</text></g>`,
  'p-rubber': () => `${bg('#0f1b33', '#e5484d', PW, PW)}<g filter="url(#sh)" transform="rotate(-10 400 400)"><ellipse cx="360" cy="400" rx="190" ry="210" fill="#d62d2d"/><ellipse cx="360" cy="400" rx="190" ry="210" fill="url(#dots)"/>
    <rect x="470" y="200" width="200" height="400" rx="20" fill="#fff"/><rect x="470" y="200" width="200" height="90" rx="20" fill="#13213a"/>
    <text x="570" y="258" font-size="36" text-anchor="middle" font-family="sans-serif" font-weight="900" fill="#f5b301">05</text></g>`,
  'p-shoes': () => `${bg('#0091ff', '#7fd3ff', PW, PW)}<g filter="url(#sh)"><path d="M150 480 q10 -150 120 -170 l120 -20 q40 60 120 70 l150 40 q60 20 60 80 v40 h-570z" fill="#fff"/>
    <path d="M150 520 h570 v30 q0 20 -20 20 h-530 q-20 0 -20 -20z" fill="#13213a"/><path d="M290 330 l60 90 M340 320 l60 90 M390 316 l60 90" stroke="#e5484d" stroke-width="10" stroke-linecap="round"/>
    <path d="M520 400 q120 20 190 70" stroke="#3b5bfd" stroke-width="22" fill="none" stroke-linecap="round"/></g>`,
  'p-bag': () => `${bg('#12a37f', '#0e7c66', PW, PW)}<g filter="url(#sh)"><ellipse cx="400" cy="380" rx="220" ry="240" fill="#13213a"/><ellipse cx="400" cy="380" rx="190" ry="210" fill="none" stroke="#f5b301" stroke-width="8" stroke-dasharray="14 10"/>
    <rect x="345" y="600" width="110" height="80" rx="20" fill="#13213a"/><circle cx="400" cy="380" r="60" fill="url(#ball)"/></g>`,
  'p-table': () => `${bg('#3b5bfd', '#13213a', PW, PW)}<g transform="translate(-200 60)">${tableScene(1200, 675)}</g>`,
  'p-net': () => `${bg('#f5b301', '#f08c00', PW, PW)}<g filter="url(#sh)"><rect x="120" y="330" width="560" height="140" fill="#fff"/>
    ${Array.from({ length: 27 }, (_, i) => `<path d="M${140 + i * 20} 330 v140" stroke="#13213a" stroke-width="2" opacity=".35"/>`).join('')}${Array.from({ length: 6 }, (_, i) => `<path d="M120 ${350 + i * 20} h560" stroke="#13213a" stroke-width="2" opacity=".35"/>`).join('')}
    <rect x="110" y="320" width="560" height="14" fill="#13213a"/><rect x="90" y="310" width="34" height="200" rx="8" fill="#13213a"/><rect x="676" y="310" width="34" height="200" rx="8" fill="#13213a"/></g>`,
  'p-towel': () => `${bg('#d6409f', '#ffa3d7', PW, PW)}<g filter="url(#sh)"><rect x="200" y="200" width="300" height="380" rx="26" fill="#fff"/><path d="M200 520 h300" stroke="#3b5bfd" stroke-width="22"/>
    <circle cx="590" cy="420" r="90" fill="none" stroke="#13213a" stroke-width="44"/><circle cx="590" cy="420" r="90" fill="none" stroke="#f5b301" stroke-width="8"/></g>`,
};

// People (400×400): flat portrait with skin, hair and shirt variations
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
const SHIRT = ['#3b5bfd', '#e5484d', '#12a37f', '#f08c00', '#8e4ec6', '#0091ff', '#13213a', '#d6409f'];
const BACK = [['#e8eeff', '#c9d6ff'], ['#e2f7ef', '#b3ead6'], ['#fff3cc', '#ffe08a'], ['#fde7e8', '#f8c0c3'], ['#efe5fb', '#d9c3f3']];
function person(i, style) {
  const skin = SKIN[i % SKIN.length], shirt = SHIRT[(i * 3) % SHIRT.length], [b1, b2] = BACK[i % BACK.length];
  const hair = ['#2b1d12', '#3d2614', '#121212', '#6b4423', '#a0522d'][(i * 7) % 5];
  const hairShape = {
    short: `<path d="M140 150 q60 -80 120 0 q-5 -40 -60 -44 q-55 4 -60 44z" fill="${hair}"/>`,
    curly: `${Array.from({ length: 9 }, (_, k) => `<circle cx="${140 + k * 15}" cy="${118 + (k % 2) * 8}" r="18" fill="${hair}"/>`).join('')}`,
    long: `<path d="M132 160 q8 -100 68 -100 q60 0 68 100 v90 h-30 v-80 q-38 -30 -76 0 v80 h-30z" fill="${hair}"/>`,
    hijab: `<path d="M118 330 q-10 -140 30 -200 q52 -60 104 0 q40 60 30 200z" fill="${shirt}" opacity=".95"/><path d="M146 170 q54 -60 108 0 v20 q-54 -40 -108 0z" fill="#ffffff" opacity=".25"/>`,
    bald: `<path d="M148 130 q52 -30 104 0" stroke="${hair}" stroke-width="6" fill="none" opacity=".5"/>`,
    cap: `<path d="M138 140 q62 -70 124 0z" fill="${shirt}"/><path d="M200 140 h90 q8 0 4 8 l-10 6 h-84z" fill="${shirt}"/><circle cx="200" cy="96" r="6" fill="#fff"/>`,
  }[style];
  return `<defs><linearGradient id="pb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${b1}"/><stop offset="1" stop-color="${b2}"/></linearGradient></defs>
    <rect width="400" height="400" fill="url(#pb)"/><circle cx="320" cy="80" r="40" fill="#fff" opacity=".35"/>
    ${style === 'hijab' ? hairShape : ''}
    <path d="M80 400 q0 -110 120 -120 q120 10 120 120z" fill="${shirt}"/><path d="M170 282 l30 40 l30 -40" fill="#fff" opacity=".3"/>
    <rect x="178" y="232" width="44" height="50" rx="16" fill="${skin}"/>
    <ellipse cx="200" cy="180" rx="62" ry="72" fill="${skin}"/>
    ${style === 'hijab' ? '' : hairShape}
    <ellipse cx="177" cy="185" rx="7" ry="9" fill="#13213a"/><ellipse cx="223" cy="185" rx="7" ry="9" fill="#13213a"/>
    <path d="M180 220 q20 16 40 0" stroke="#7a3b2e" stroke-width="5" fill="none" stroke-linecap="round"/>
    <circle cx="160" cy="210" r="10" fill="#f08c8c" opacity=".35"/><circle cx="240" cy="210" r="10" fill="#f08c8c" opacity=".35"/>`;
}
const STYLES = ['short', 'hijab', 'curly', 'long', 'bald', 'cap', 'short', 'hijab', 'short', 'long', 'curly', 'cap'];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const save = async (name, w, h, svg) => {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<html><body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${svg}</svg></body></html>`);
    await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82 });
  };
  for (const [k, f] of Object.entries(scenes)) await save(k, W, H, f());
  for (const [k, f] of Object.entries(products)) await save(k, PW, PW, f());
  for (let i = 0; i < 24; i++) await save(`person-${String(i + 1).padStart(2, '0')}`, 400, 400, person(i, STYLES[i % STYLES.length]));
  await browser.close();
  console.log('done');
})();
