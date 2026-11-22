/**
 * Shareable result cards: branded Pingo images (champion, final podium, group
 * table, match result) drawn on a canvas in the browser, then shared with the
 * phone's share sheet (WhatsApp, Facebook…) or downloaded. No server, no paid
 * service: everything happens on the device.
 */
import { championSvg } from './champion';
import { defaultAvatar } from './avatars';

export const CARD_W = 1080;
export const CARD_H = 1350;

const NAVY = '#0c1f4a';
const RED = '#e01b2a';
const BLUE = '#0b55a8';
const GREEN = '#7ed957';
const GREEN_INK = '#2a7f20';
const GREEN_SOFT = '#eafbe3';
const GOLD = '#f5b301';
const SILVER = '#aab4c3';
const BRONZE = '#cd7f45';
const MUTED = '#66758c';
const FONT = "'Cairo', system-ui, sans-serif";

export interface CardPerson {
  name: string;
  photo?: string | null;
  gender?: string | null;
}

/** Shared top lines of every card. */
interface CardBase {
  tournament: string;
  /** Date, time and place, already formatted. */
  when: string;
  /** Labels in Arabic, passed in so the text stays in the dictionary. */
  labels: { footer: string; site: string };
}

export interface ChampionCard extends CardBase {
  kind: 'champion';
  title: string;
  champion: CardPerson;
  /** Second, third (and fourth) places, already labelled. */
  others: { label: string; person: CardPerson; color: string }[];
}

export interface PodiumCard extends CardBase {
  kind: 'podium';
  title: string;
  places: { place: 1 | 2 | 3; person: CardPerson | null }[];
  /** Extra lines under the podium: fourth place, consolation winner… */
  lines: { label: string; name: string }[];
}

export interface TableCard extends CardBase {
  kind: 'table';
  title: string;
  /** Column titles: played, won, lost, points. */
  heads: string[];
  rows: { rank: string; person: CardPerson; cells: string[]; tone: 'q' | 'c' | '' }[];
  legend: { color: string; label: string }[];
}

export interface MatchCard extends CardBase {
  kind: 'match';
  title: string;
  where: string;
  a: CardPerson;
  b: CardPerson;
  gamesA: string;
  gamesB: string;
  winner: 'a' | 'b' | null;
  /** Points of every game ("11-7"), first player's number first. */
  games: [string, string][];
  note: string;
  winnerLabel: string;
}

export type CardData = ChampionCard | PodiumCard | TableCard | MatchCard;

export const MEDAL_COLORS = { 1: GOLD, 2: SILVER, 3: BRONZE } as const;

/* ------------------------------------------------------------ image loading */

const base = () => import.meta.env.BASE_URL ?? './';

function loadImg(src: string, cors = true): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (cors && !src.startsWith('data:')) img.crossOrigin = 'anonymous';
    const done = (ok: boolean) => { clearTimeout(timer); resolve(ok ? img : null); };
    const timer = setTimeout(() => done(false), 8000);
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = src;
  });
}

/**
 * A photo the canvas may read back: a cross-origin photo without CORS would
 * "taint" the canvas and block the export, so it is copied to a data URL first.
 * Falls back to the drawn avatar for the player's gender.
 */
async function photoUrl(p: CardPerson | null | undefined, size = 256): Promise<string> {
  const fallback = defaultAvatar(p?.gender);
  if (!p?.photo) return fallback;
  if (p.photo.startsWith('data:')) return p.photo;
  const img = await loadImg(p.photo);
  if (!img) return fallback;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d')!;
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    x.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
    return c.toDataURL('image/jpeg', 0.9);
  } catch {
    return fallback;
  }
}

async function photoImg(p: CardPerson | null | undefined): Promise<HTMLImageElement | null> {
  return loadImg(await photoUrl(p), false);
}

function svgImg(svg: string, w: number, h: number): Promise<HTMLImageElement | null> {
  const sized = svg.replace('<svg ', `<svg width="${w}" height="${h}" `);
  return loadImg(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`, false);
}

async function fontsReady(): Promise<void> {
  try {
    await Promise.all(['900 60px', '800 60px', '700 40px'].map((f) => document.fonts.load(`${f} Cairo`, 'بينجو 123')));
  } catch { /* system font is fine */ }
}

/* ------------------------------------------------------------ drawing helpers */

type Ctx = CanvasRenderingContext2D;

function font(x: Ctx, size: number, weight = 800): void {
  x.font = `${weight} ${size}px ${FONT}`;
}

/** Draw text shrunk (then cut with "…") to fit `max` pixels. */
function fitText(x: Ctx, text: string, cx: number, y: number, max: number, size: number, weight = 800, min = 26): void {
  let s = size;
  font(x, s, weight);
  while (x.measureText(text).width > max && s > min) { s -= 2; font(x, s, weight); }
  let tx = text;
  while (x.measureText(tx).width > max && tx.length > 2) tx = tx.slice(0, -2) + '…';
  x.fillText(tx, cx, y);
}

function roundRect(x: Ctx, l: number, t: number, w: number, h: number, r: number): void {
  x.beginPath();
  x.moveTo(l + r, t);
  x.arcTo(l + w, t, l + w, t + h, r);
  x.arcTo(l + w, t + h, l, t + h, r);
  x.arcTo(l, t + h, l, t, r);
  x.arcTo(l, t, l + w, t, r);
  x.closePath();
}

function circlePhoto(x: Ctx, img: HTMLImageElement | null, cx: number, cy: number, r: number, ring: string, ringW = 8): void {
  x.save();
  x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.closePath();
  x.fillStyle = GREEN_SOFT; x.fill();
  if (img) { x.clip(); x.drawImage(img, cx - r, cy - r, r * 2, r * 2); }
  x.restore();
  x.beginPath(); x.arc(cx, cy, r + ringW / 2, 0, Math.PI * 2);
  x.lineWidth = ringW; x.strokeStyle = ring; x.stroke();
}

function ball(x: Ctx, cx: number, cy: number, r: number, alpha = 1): void {
  x.save(); x.globalAlpha = alpha;
  const g = x.createRadialGradient(cx - r / 3, cy - r / 3, r / 6, cx, cy, r);
  g.addColorStop(0, '#fff'); g.addColorStop(1, '#dfe6ee');
  x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fillStyle = g; x.fill();
  x.restore();
}

/** White background with soft brand shapes, header with the logo, green footer. */
async function frame(x: Ctx, d: CardBase): Promise<void> {
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, CARD_W, CARD_H);
  // Soft swooshes in the logo colours.
  const sky = x.createLinearGradient(0, 150, 0, CARD_H);
  sky.addColorStop(0, '#f3f9ff'); sky.addColorStop(1, GREEN_SOFT);
  x.fillStyle = sky; x.fillRect(0, 150, CARD_W, CARD_H - 150);
  x.save();
  x.globalAlpha = 0.1;
  x.fillStyle = BLUE;
  x.beginPath(); x.moveTo(0, 260); x.quadraticCurveTo(540, 140, CARD_W, 300); x.lineTo(CARD_W, 150); x.lineTo(0, 150); x.fill();
  x.globalAlpha = 0.22;
  x.fillStyle = GREEN;
  x.beginPath(); x.moveTo(0, CARD_H - 230); x.quadraticCurveTo(600, CARD_H - 330, CARD_W, CARD_H - 190); x.lineTo(CARD_W, CARD_H - 96); x.lineTo(0, CARD_H - 96); x.fill();
  x.restore();
  // Header.
  x.fillStyle = '#fff'; x.fillRect(0, 0, CARD_W, 150);
  x.fillStyle = GREEN; x.fillRect(0, 146, CARD_W, 8);
  const logo = await loadImg(`${base()}brand/logo.png`, false);
  if (logo) {
    const h = 104, w = (logo.naturalWidth / logo.naturalHeight) * h;
    x.drawImage(logo, (CARD_W - w) / 2, 22, w, h);
  } else {
    x.fillStyle = NAVY; font(x, 80, 900); x.textAlign = 'center'; x.fillText('Pingo', CARD_W / 2, 110);
  }
  ball(x, 90, 76, 22, 0.9); ball(x, CARD_W - 90, 76, 16, 0.7);
  // Tournament name + when.
  x.textAlign = 'center'; x.direction = 'rtl';
  x.fillStyle = NAVY; fitText(x, d.tournament, CARD_W / 2, 230, CARD_W - 140, 52, 900);
  if (d.when) { x.fillStyle = MUTED; fitText(x, d.when, CARD_W / 2, 282, CARD_W - 160, 32, 700); }
  // Footer.
  x.fillStyle = GREEN; x.fillRect(0, CARD_H - 96, CARD_W, 96);
  x.fillStyle = NAVY; font(x, 34, 800); x.textAlign = 'right';
  x.fillText(d.labels.footer, CARD_W - 48, CARD_H - 36);
  x.textAlign = 'left'; x.direction = 'ltr'; font(x, 28, 700);
  x.fillText(d.labels.site, 48, CARD_H - 38);
  x.direction = 'rtl';
}

function pill(x: Ctx, text: string, cx: number, cy: number, bg: string, fg: string, size = 40): void {
  font(x, size, 900);
  const w = x.measureText(text).width + size * 1.6, h = size * 1.7;
  roundRect(x, cx - w / 2, cy - h / 2, w, h, h / 2);
  x.fillStyle = bg; x.fill();
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, cx, cy + 2);
  x.textBaseline = 'alphabetic';
}

function confettiDots(x: Ctx, top: number, bottom: number, seed = 7): void {
  const colors = [GREEN, RED, GOLD, BLUE, GREEN, GOLD];
  for (let i = 0; i < 34; i++) {
    const px = ((i * 137 + seed * 31) % 1000) / 1000 * CARD_W;
    const py = top + ((i * 89 + seed * 17) % 1000) / 1000 * (bottom - top);
    x.save(); x.translate(px, py); x.rotate(i);
    x.fillStyle = colors[i % colors.length]; x.globalAlpha = 0.75;
    x.fillRect(-9, -4, 18, 8);
    x.restore();
  }
}

/* ------------------------------------------------------------ the four cards */

async function drawChampion(x: Ctx, d: ChampionCard): Promise<void> {
  pill(x, d.title, CARD_W / 2, 350, GOLD, NAVY, 38);
  // Sunburst behind the scene.
  const cx = CARD_W / 2, cy = 640;
  x.save();
  x.beginPath(); x.rect(0, 390, CARD_W, 760); x.clip();
  x.translate(cx, cy);
  for (let i = 0; i < 18; i++) {
    x.rotate(Math.PI / 9);
    x.beginPath(); x.moveTo(0, 0); x.lineTo(-60, -520); x.lineTo(60, -520); x.closePath();
    x.fillStyle = i % 2 ? 'rgba(126,217,87,.16)' : 'rgba(245,179,1,.14)'; x.fill();
  }
  x.restore();
  confettiDots(x, 380, 860);
  const face = d.champion.photo ? await photoUrl(d.champion) : null;
  const scene = await svgImg(championSvg('share', face, d.champion.gender), 160, 226);
  if (scene) x.drawImage(scene, cx - 222, 396, 444, 626);
  // Champion name.
  x.textAlign = 'center';
  x.fillStyle = NAVY; fitText(x, d.champion.name, cx, 1112, CARD_W - 120, 72, 900, 40);
  // Runners-up.
  const others = d.others.slice(0, 3);
  if (others.length) {
    const imgs = await Promise.all(others.map((o) => photoImg(o.person)));
    const w = (CARD_W - 96 - (others.length - 1) * 20) / others.length;
    others.forEach((o, i) => {
      const right = CARD_W - 48 - i * (w + 20);
      roundRect(x, right - w, 1180, w, 66, 33); x.fillStyle = '#fff'; x.fill();
      x.lineWidth = 3; x.strokeStyle = o.color; x.stroke();
      circlePhoto(x, imgs[i], right - 34, 1213, 24, o.color, 4);
      x.textAlign = 'right'; x.fillStyle = NAVY;
      fitText(x, `${o.label}: ${o.person.name}`, right - 68, 1225, w - 86, 28, 800, 20);
    });
  }
}

async function drawPodium(x: Ctx, d: PodiumCard): Promise<void> {
  pill(x, d.title, CARD_W / 2, 350, NAVY, '#fff', 36);
  confettiDots(x, 380, 640, 3);
  const steps: Record<number, { cx: number; top: number }> = {
    1: { cx: CARD_W / 2, top: 730 }, 2: { cx: CARD_W / 2 + 300, top: 820 }, 3: { cx: CARD_W / 2 - 300, top: 890 },
  };
  const floor = 1080;
  for (const p of [2, 1, 3] as const) {
    const s = steps[p];
    const who = d.places.find((q) => q.place === p)?.person ?? null;
    const color = MEDAL_COLORS[p];
    const g = x.createLinearGradient(0, s.top, 0, floor);
    g.addColorStop(0, p === 1 ? '#a6e88a' : '#dbe7f5'); g.addColorStop(1, p === 1 ? '#4fae3a' : '#b9cbe2');
    roundRect(x, s.cx - 140, s.top, 280, floor - s.top + 30, 18); x.fillStyle = g; x.fill();
    x.fillStyle = NAVY; font(x, 96, 900); x.textAlign = 'center';
    x.fillText(String(p), s.cx, s.top + 120);
    const r = p === 1 ? 110 : 84;
    const cy = s.top - r - 70;
    circlePhoto(x, await photoImg(who), s.cx, cy, r, color, 12);
    // Medal.
    x.beginPath(); x.arc(s.cx + r * 0.72, cy + r * 0.72, 30, 0, Math.PI * 2); x.fillStyle = color; x.fill();
    x.lineWidth = 5; x.strokeStyle = '#fff'; x.stroke();
    x.fillStyle = NAVY; font(x, 34, 900); x.fillText(String(p), s.cx + r * 0.72, cy + r * 0.72 + 12);
    x.fillStyle = NAVY;
    fitText(x, who?.name ?? '…', s.cx, s.top - 22, 290, p === 1 ? 42 : 34, 900, 22);
  }
  x.textAlign = 'center';
  d.lines.slice(0, 2).forEach((l, i) => {
    x.fillStyle = MUTED; fitText(x, `${l.label}: ${l.name}`, CARD_W / 2, 1168 + i * 46, CARD_W - 140, 32, 800, 22);
  });
}

async function drawTable(x: Ctx, d: TableCard): Promise<void> {
  pill(x, d.title, CARD_W / 2, 350, NAVY, '#fff', 36);
  const rows = d.rows.slice(0, 8);
  const rowH = Math.min(118, Math.floor(700 / Math.max(rows.length, 1)));
  const top = 420 + Math.max(0, Math.floor((700 - rows.length * rowH) / 3));
  const L = 60, R = CARD_W - 60;
  // Column positions from the left edge (numbers), names from the right.
  const cols = [L + 70, L + 170, L + 270, L + 380];
  x.fillStyle = MUTED; font(x, 26, 800); x.textAlign = 'center';
  d.heads.forEach((h, i) => x.fillText(h, cols[i], top));
  const imgs = await Promise.all(rows.map((r) => photoImg(r.person)));
  rows.forEach((r, i) => {
    const y = top + 24 + i * rowH;
    roundRect(x, L, y, R - L, rowH - 14, 22);
    x.fillStyle = r.tone === 'q' ? '#dff6d3' : r.tone === 'c' ? '#fff1cf' : '#ffffff'; x.fill();
    x.lineWidth = 2; x.strokeStyle = r.tone === 'q' ? GREEN : r.tone === 'c' ? GOLD : '#e2e9ee'; x.stroke();
    const mid = y + (rowH - 14) / 2;
    // Rank badge.
    x.beginPath(); x.arc(R - 44, mid, 26, 0, Math.PI * 2);
    x.fillStyle = r.tone === 'q' ? GREEN_INK : r.tone === 'c' ? GOLD : '#c9d3df'; x.fill();
    x.fillStyle = '#fff'; font(x, 30, 900); x.textAlign = 'center'; x.fillText(r.rank, R - 44, mid + 11);
    const pr = Math.min(38, (rowH - 30) / 2);
    circlePhoto(x, imgs[i], R - 84 - pr, mid, pr, '#fff', 4);
    x.textAlign = 'right'; x.fillStyle = NAVY;
    fitText(x, r.person.name, R - 92 - pr * 2, mid + 12, R - 92 - pr * 2 - (cols[3] + 60), rowH > 100 ? 38 : 34, 800, 22);
    x.textAlign = 'center';
    r.cells.forEach((c, j) => {
      x.fillStyle = j === 3 ? NAVY : MUTED; font(x, j === 3 ? 38 : 32, j === 3 ? 900 : 800);
      x.fillText(c, cols[j], mid + 12);
    });
  });
  // Legend.
  let lx = CARD_W - 70;
  const ly = Math.min(top + 24 + rows.length * rowH + 30, CARD_H - 140);
  x.textAlign = 'right'; font(x, 26, 700);
  for (const l of d.legend) {
    x.fillStyle = l.color; x.beginPath(); x.arc(lx - 10, ly - 9, 10, 0, Math.PI * 2); x.fill();
    x.fillStyle = MUTED; x.fillText(l.label, lx - 30, ly);
    lx -= x.measureText(l.label).width + 80;
  }
}

async function drawMatch(x: Ctx, d: MatchCard): Promise<void> {
  pill(x, d.title, CARD_W / 2, 350, NAVY, '#fff', 36);
  x.fillStyle = MUTED; x.textAlign = 'center';
  fitText(x, d.where, CARD_W / 2, 440, CARD_W - 160, 32, 700);
  const [ia, ib] = await Promise.all([photoImg(d.a), photoImg(d.b)]);
  // First player on the right (Arabic reading order), in red; second on the left in blue.
  const side = (p: CardPerson, img: HTMLImageElement | null, cx: number, color: string, won: boolean) => {
    if (won) {
      x.save(); x.globalAlpha = 0.25;
      x.beginPath(); x.arc(cx, 620, 160, 0, Math.PI * 2); x.fillStyle = GREEN; x.fill(); x.restore();
    }
    circlePhoto(x, img, cx, 620, 125, color, 14);
    if (won) pill(x, d.winnerLabel, cx, 762, GREEN, NAVY, 30);
    x.fillStyle = NAVY; x.textAlign = 'center';
    fitText(x, p.name, cx, 850, 400, 46, 900, 24);
  };
  side(d.a, ia, CARD_W - 225, RED, d.winner === 'a');
  side(d.b, ib, 225, BLUE, d.winner === 'b');
  // Score: the first player's number on their side.
  font(x, 150, 900); x.textAlign = 'center';
  x.fillStyle = d.winner === 'a' ? GREEN_INK : NAVY; x.fillText(d.gamesA, CARD_W / 2 + 80, 675);
  x.fillStyle = MUTED; font(x, 100, 900); x.fillText('-', CARD_W / 2, 665);
  font(x, 150, 900); x.fillStyle = d.winner === 'b' ? GREEN_INK : NAVY; x.fillText(d.gamesB, CARD_W / 2 - 80, 675);
  pingTable(x, 1010, 1210);
  // Games.
  const games = d.games.slice(0, 7);
  if (games.length) {
    const w = 150, gap = 18, total = games.length * w + (games.length - 1) * gap;
    games.forEach(([ga, gb], i) => {
      const right = CARD_W / 2 + total / 2 - i * (w + gap);
      roundRect(x, right - w, 900, w, 84, 20); x.fillStyle = '#fff'; x.fill();
      x.lineWidth = 3; x.strokeStyle = Number(ga) > Number(gb) ? RED : BLUE; x.stroke();
      font(x, 36, 900); x.textAlign = 'center';
      x.fillStyle = Number(ga) > Number(gb) ? RED : MUTED; x.fillText(ga, right - w / 2 + 34, 956);
      x.fillStyle = MUTED; x.fillText('-', right - w / 2, 954);
      x.fillStyle = Number(gb) > Number(ga) ? BLUE : MUTED; x.fillText(gb, right - w / 2 - 34, 956);
    });
  }
  if (d.note) pill(x, d.note, CARD_W / 2, 942, RED, '#fff', 30);
}

/** A table tennis table in perspective, with net and a ball, between `top` and `bottom`. */
function pingTable(x: Ctx, top: number, bottom: number): void {
  const cx = CARD_W / 2, topW = 520, botW = 860;
  const shape = (inset: number) => {
    x.beginPath();
    x.moveTo(cx - topW / 2 + inset, top + inset); x.lineTo(cx + topW / 2 - inset, top + inset);
    x.lineTo(cx + botW / 2 - inset, bottom - inset); x.lineTo(cx - botW / 2 + inset, bottom - inset); x.closePath();
  };
  x.save();
  x.fillStyle = 'rgba(12,31,74,.12)'; x.fillRect(cx - botW / 2 + 20, bottom, botW - 40, 18);
  shape(0); x.fillStyle = BLUE; x.fill();
  shape(10); x.lineWidth = 6; x.strokeStyle = '#fff'; x.stroke();
  x.beginPath(); x.moveTo(cx, top + 10); x.lineTo(cx, bottom - 10); x.lineWidth = 4; x.stroke();
  // Net across the middle.
  const ny = (top + bottom) / 2, nw = (topW + botW) / 2 + 30;
  x.fillStyle = NAVY; x.fillRect(cx - nw / 2, ny - 26, nw, 26);
  x.strokeStyle = 'rgba(255,255,255,.35)'; x.lineWidth = 2;
  for (let i = cx - nw / 2 + 12; i < cx + nw / 2; i += 14) { x.beginPath(); x.moveTo(i, ny - 26); x.lineTo(i, ny); x.stroke(); }
  x.fillStyle = '#fff'; x.fillRect(cx - nw / 2, ny - 30, nw, 6);
  x.restore();
  ball(x, cx + 170, top - 30, 18);
  x.save(); x.setLineDash([6, 10]); x.lineWidth = 4; x.strokeStyle = 'rgba(12,31,74,.25)';
  x.beginPath(); x.moveTo(cx - 200, top + 40); x.quadraticCurveTo(cx, top - 110, cx + 150, top - 36); x.stroke(); x.restore();
}

/** Draw a card and return it as a PNG. */
export async function renderCard(d: CardData): Promise<Blob> {
  await fontsReady();
  const c = document.createElement('canvas');
  c.width = CARD_W; c.height = CARD_H;
  const x = c.getContext('2d')!;
  x.direction = 'rtl';
  await frame(x, d);
  if (d.kind === 'champion') await drawChampion(x, d);
  else if (d.kind === 'podium') await drawPodium(x, d);
  else if (d.kind === 'table') await drawTable(x, d);
  else await drawMatch(x, d);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('export'))), 'image/png'));
}

/* ------------------------------------------------------------ share sheet */

export interface ShareTexts {
  title: string;
  hint: string;
  share: string;
  download: string;
  whatsapp: string;
  facebook: string;
  copy: string;
  copied: string;
  close: string;
  making: string;
  failed: string;
}

let openSheet: HTMLElement | null = null;

export function closeShare(): void {
  if (!openSheet) return;
  const img = openSheet.querySelector('img');
  if (img?.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  openSheet.remove();
  openSheet = null;
}

/**
 * Open the share sheet: preview of the card, then share (phone share sheet
 * with the image itself), download, WhatsApp / Facebook (with a link to the
 * page) and copy link.
 */
export async function openShare(d: CardData, fileName: string, message: string, link: string, tx: ShareTexts): Promise<void> {
  closeShare();
  const el = document.createElement('div');
  el.className = 'share-sheet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', tx.title);
  el.innerHTML = `<div class="share-box">
    <div class="row between"><h3>${tx.title}</h3><button class="icon-btn" data-share="close" aria-label="${tx.close}">✕</button></div>
    <div class="share-preview"><div class="share-wait"><span class="spin"></span>${tx.making}</div></div>
    <p class="hint">${tx.hint}</p>
    <div class="share-btns">
      <button class="btn" data-share="native" hidden>📤 ${tx.share}</button>
      <button class="btn blue" data-share="download">⬇️ ${tx.download}</button>
      <a class="btn wa" data-share="wa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`${message}\n${link}`)}">💬 ${tx.whatsapp}</a>
      <a class="btn fb" data-share="fb" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}">📘 ${tx.facebook}</a>
      <button class="btn soft" data-share="copy">🔗 ${tx.copy}</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  openSheet = el;

  let blob: Blob | null = null;
  const file = () => new File([blob!], fileName, { type: 'image/png' });
  const download = () => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  el.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-share]');
    if (e.target === el) { closeShare(); return; }
    if (!b) return;
    const what = b.dataset.share;
    if (what === 'close') closeShare();
    else if (what === 'download') download();
    else if (what === 'copy') {
      try { await navigator.clipboard.writeText(link); b.textContent = `✅ ${tx.copied}`; } catch { prompt('', link); }
    } else if (what === 'native' && blob) {
      try { await navigator.share({ files: [file()], title: message, text: `${message}\n${link}` }); } catch { /* cancelled */ }
    }
  });
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { closeShare(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);

  try {
    blob = await renderCard(d);
  } catch {
    if (openSheet === el) el.querySelector('.share-preview')!.innerHTML = `<p class="err">${tx.failed}</p>`;
    return;
  }
  if (openSheet !== el) return;
  const img = document.createElement('img');
  img.src = URL.createObjectURL(blob);
  img.alt = message;
  el.querySelector('.share-preview')!.replaceChildren(img);
  const native = el.querySelector<HTMLButtonElement>('[data-share="native"]')!;
  try { native.hidden = !(navigator.canShare && navigator.canShare({ files: [file()] })); } catch { native.hidden = true; }
}
