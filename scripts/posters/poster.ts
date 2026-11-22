/** Builds one launch poster from the landing page text (src/pages/join.ts), so both always say the same. */
import { FOR_WHO, PAGES, pingoPoint, type JoinRole } from '../../src/pages/join';
import { icon } from '../../src/ui/icons';

const q = new URLSearchParams(location.search);
const role = (q.get('role') ?? 'player') as JoinRole;
const size = q.get('size') === 'story' ? 'story' : 'square';
const p = PAGES[role];
const logo = new URL('../../public/brand/logo.png', import.meta.url).href;

const price = p.prices.map((x) => `<span><b>${x.amount}</b> ${x.unit}${x.note && role === 'seller' ? ` <i>(${x.note})</i>` : ''}</span>`).join('<span class="or">أو</span>');

const el = document.getElementById('poster')!;
el.className = `poster ${size} jr-${role}`;
el.innerHTML = `
  <div class="ring r1"></div><div class="ring r2"></div>
  ${pingoPoint('big-pp')}
  <header>
    <div class="logo"><img src="${logo}" alt="Pingo"></div>
    <span class="soon">${icon('spark', 30)} قريباً</span>
  </header>
  <div class="who"><span class="who-ic">${icon(p.icon, size === 'story' ? 52 : 40)}</span>${FOR_WHO[role]}</div>
  <h1>${p.title}</h1>
  <div class="highs">${p.highlights.map(([ic, h, s]) => `<div class="high"><span class="h-ic">${icon(ic, size === 'story' ? 44 : 34)}</span><div><b>${h}</b><small>${s}</small></div></div>`).join('')}</div>
  <footer>
    <div class="price">${price}</div>
    <div class="qr-card"><div id="qr"></div><div class="qr-text"><b>امسح الكود</b><span>كل المزايا والتفاصيل</span><em dir="ltr">omarhamad1974.github.io/FOCUS</em></div></div>
  </footer>`;

(window as unknown as { setQR: (svg: string) => void }).setQR = (svg) => { document.getElementById('qr')!.innerHTML = svg; };
