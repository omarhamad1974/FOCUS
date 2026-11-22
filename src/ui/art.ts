/** Inline SVG illustrations: no image files, crisp on every screen, animated with CSS. */
import { icon } from './icons';

/** A table tennis table seen in perspective, two paddles and a ball that flies across. */
export function heroArt(): string {
  return `<svg class="hero-art" viewBox="0 0 320 200" aria-hidden="true">
    <defs>
      <linearGradient id="tbl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ddf6a"/><stop offset="1" stop-color="#3c9a2e"/></linearGradient>
      <radialGradient id="ballg" cx=".35" cy=".35" r=".7"><stop offset="0" stop-color="#fff"/><stop offset=".6" stop-color="#ffe0b8"/><stop offset="1" stop-color="#f59f45"/></radialGradient>
      <linearGradient id="padR" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff4d5a"/><stop offset="1" stop-color="#b30c18"/></linearGradient>
      <linearGradient id="padB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#16336f"/><stop offset="1" stop-color="#0c1f4a"/></linearGradient>
    </defs>
    <ellipse cx="160" cy="182" rx="130" ry="10" fill="#0003"/>
    <path d="M40 150 L280 150 L250 92 L70 92 Z" fill="url(#tbl)" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
    <path d="M160 92 L160 150" stroke="#fff" stroke-width="2" opacity=".8"/>
    <path d="M58 150 L58 178 M262 150 L262 178 M84 92 L84 112 M236 92 L236 112" stroke="#23661a" stroke-width="5" stroke-linecap="round"/>
    <rect x="150" y="70" width="20" height="34" rx="2" fill="#ffffffcc" class="net"/>
    <path d="M150 74 h20 M150 80 h20 M150 86 h20 M150 92 h20 M150 98 h20" stroke="#0c1f4a" stroke-width=".8" opacity=".35"/>
    <g class="pad pad-a"><ellipse cx="40" cy="96" rx="22" ry="25" fill="url(#padR)" stroke="#fff" stroke-width="2"/><rect x="34" y="118" width="12" height="28" rx="5" fill="#b07a45"/></g>
    <g class="pad pad-b"><ellipse cx="282" cy="86" rx="22" ry="25" fill="url(#padB)" stroke="#fff" stroke-width="2"/><rect x="276" y="108" width="12" height="28" rx="5" fill="#b07a45"/></g>
    <circle class="hero-ball" r="8" fill="url(#ballg)"/>
  </svg>`;
}

const PALETTES: [string, string][] = [
  ['#0b55a8', '#4d8fe0'], ['#2f8a22', '#a6e88a'], ['#e01b2a', '#ff7a83'], ['#f08c00', '#ffd166'],
  ['#1b8fd6', '#9fd0f5'], ['#0c1f4a', '#0b55a8'], ['#7ed957', '#c8f2b4'], ['#1b8fd6', '#a6e88a'],
];

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h;
}

/** A coloured cover with a big icon and floating balls: used when there is no photo. */
export function placeholder(seed: string, iconName: string, label = ''): string {
  const [a, b] = PALETTES[hash(seed) % PALETTES.length];
  const id = `g${hash(seed + iconName).toString(36)}`;
  return `<div class="ph" style="--a:${a};--b:${b}" aria-hidden="true">
    <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
      <rect width="200" height="120" fill="url(#${id})"/>
      <circle cx="170" cy="20" r="34" fill="#fff" opacity=".12"/><circle cx="20" cy="110" r="44" fill="#fff" opacity=".1"/>
      <circle class="float" cx="150" cy="92" r="6" fill="#fff" opacity=".85"/><circle class="float f2" cx="40" cy="26" r="4" fill="#fff" opacity=".7"/>
    </svg>
    <span class="ph-ic">${icon(iconName, 46)}</span>${label ? `<span class="ph-label">${label}</span>` : ''}
  </div>`;
}

/** Photo when there is one, illustration otherwise. */
export function cover(url: string | null | undefined, seed: string, iconName: string, alt = ''): string {
  if (url) return `<div class="ph photo"><img src="${url}" alt="${alt}" loading="lazy" decoding="async"></div>`;
  return placeholder(seed, iconName);
}

/** Small empty-state drawing with a message. */
export function empty(iconName: string, text: string, action = ''): string {
  return `<div class="empty card">
    <div class="empty-art">${icon(iconName, 40)}<i></i><i></i><i></i></div>
    <p class="muted">${text}</p>${action}
  </div>`;
}

/** Shimmering placeholders while content loads. */
export function skeleton(count = 3): string {
  return `<div class="grid">${Array.from({ length: count }, () => `<div class="card sk"><div class="sk-img"></div><div class="sk-line"></div><div class="sk-line short"></div></div>`).join('')}</div>`;
}

/** Academy lesson covers: one drawing per kind of lesson, coloured per article so cards differ. */
const ACADEMY_LOOK: Record<string, [string, string][]> = {
  rules: [['#0c1f4a', '#0b55a8'], ['#16336f', '#1b8fd6']],
  training: [['#2f8a22', '#7ed957'], ['#1f6e17', '#5cc246']],
  tips: [['#f08c00', '#ffd166'], ['#e06a00', '#f5b301']],
  learn: [['#a8101c', '#ff7a83'], ['#e01b2a', '#f59f45']],
};

export function academyArt(kind: string, seed: string): string {
  const looks = ACADEMY_LOOK[kind] ?? ACADEMY_LOOK.learn;
  const [a, b] = looks[hash(seed) % looks.length];
  const id = `ac${hash(seed + kind).toString(36)}`;
  const art: Record<string, string> = {
    // Table seen from above: lines, net and a scoreboard.
    rules: `<g transform="translate(26 26)"><rect width="96" height="58" rx="4" fill="#2f8a22" stroke="#fff" stroke-width="2.5"/>
      <path d="M48 0v58" stroke="#fff" stroke-width="3"/><path d="M0 29h96" stroke="#fff" stroke-width="1.2" opacity=".8"/>
      <circle class="float" cx="72" cy="16" r="4.5" fill="#fff"/></g>
      <g transform="translate(134 30)"><rect width="46" height="50" rx="7" fill="#fff" opacity=".95"/>
      <text x="23" y="22" text-anchor="middle" font-size="15" font-weight="800" fill="${a}" font-family="system-ui">11</text>
      <path d="M10 30h26M10 38h18" stroke="${a}" stroke-width="3" stroke-linecap="round" opacity=".5"/></g>`,
    // Footwork: two footprints, side arrows and a dotted ball path.
    training: `<path d="M30 92 Q100 6 170 70" fill="none" stroke="#fff" stroke-width="2.5" stroke-dasharray="2 7" stroke-linecap="round" opacity=".9"/>
      <circle class="float" cx="170" cy="70" r="7" fill="#fff"/>
      <g fill="#fff" opacity=".95"><ellipse cx="78" cy="84" rx="9" ry="15"/><ellipse cx="112" cy="80" rx="9" ry="15"/>
      <circle cx="72" cy="64" r="3"/><circle cx="80" cy="63" r="3"/><circle cx="106" cy="60" r="3"/><circle cx="114" cy="59" r="3"/></g>
      <path d="M52 104h-18m6-6-6 6 6 6M138 104h18m-6-6 6 6-6 6" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    // Light bulb with a ball inside and sparks.
    tips: `<g transform="translate(100 58)"><path d="M0-40a26 26 0 0 0-15 47c3 2.5 5 5.5 5 9h20c0-3.5 2-6.5 5-9A26 26 0 0 0 0-40Z" fill="#fff" opacity=".95"/>
      <rect x="-10" y="20" width="20" height="6" rx="2" fill="#fff" opacity=".8"/><rect x="-7" y="29" width="14" height="5" rx="2" fill="#fff" opacity=".7"/>
      <circle class="float" cx="0" cy="-14" r="10" fill="${b}"/><path d="M-6-18c4 1 6 4 6 6" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/></g>
      <path d="M52 30l4 8M148 30l-4 8M40 62h10M150 62h10M58 92l6-5M142 92l-6-5" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`,
    // Racket and ball.
    learn: `<g transform="translate(86 56) rotate(-25)"><ellipse rx="30" ry="34" fill="#fff" opacity=".95"/><ellipse rx="24" ry="28" fill="${a}" opacity=".85"/>
      <rect x="-7" y="31" width="14" height="34" rx="6" fill="#b07a45"/></g><circle class="float" cx="140" cy="42" r="10" fill="#fff"/>`,
  };
  return `<div class="ph acad-art" style="--a:${a};--b:${b}" aria-hidden="true">
    <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
      <rect width="200" height="120" fill="url(#${id})"/>
      <circle cx="178" cy="12" r="34" fill="#fff" opacity=".1"/><circle cx="10" cy="118" r="40" fill="#fff" opacity=".08"/>
      ${art[kind] ?? art.learn}</svg></div>`;
}

/** Academy banner drawing: an open book with a paddle and a ball bouncing over it. */
export function academyHero(): string {
  return `<svg class="acad-hero-art" viewBox="0 0 220 150" aria-hidden="true">
    <ellipse cx="110" cy="138" rx="86" ry="8" fill="#0003"/>
    <path d="M110 46c-22-14-52-16-80-10v88c28-6 58-4 80 10Z" fill="#fff"/><path d="M110 46c22-14 52-16 80-10v88c-28-6-58-4-80 10Z" fill="#eafbe3"/>
    <path d="M110 46v88" stroke="#0c1f4a" stroke-width="2" opacity=".25"/>
    <path d="M44 56c18-3 36-2 52 4M44 72c18-3 36-2 52 4M44 88c18-3 36-2 52 4M124 60c16-6 34-7 52-4M124 76c16-6 34-7 52-4" stroke="#0b55a8" stroke-width="3" stroke-linecap="round" opacity=".35"/>
    <g class="acad-pad" transform="translate(160 98) rotate(28)"><ellipse rx="20" ry="23" fill="#e01b2a" stroke="#fff" stroke-width="2"/><rect x="-5" y="21" width="10" height="24" rx="4" fill="#b07a45"/></g>
    <circle class="acad-ball" cx="70" cy="24" r="9" fill="#fff" stroke="#f59f45" stroke-width="2"/>
  </svg>`;
}
