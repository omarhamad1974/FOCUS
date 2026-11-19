/** Inline SVG illustrations: no image files, crisp on every screen, animated with CSS. */
import { icon } from './icons';

/** A table tennis table seen in perspective, two paddles and a ball that flies across. */
export function heroArt(): string {
  return `<svg class="hero-art" viewBox="0 0 320 200" aria-hidden="true">
    <defs>
      <linearGradient id="tbl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1fb592"/><stop offset="1" stop-color="#0c6f5a"/></linearGradient>
      <radialGradient id="ballg" cx=".35" cy=".35" r=".7"><stop offset="0" stop-color="#fff"/><stop offset=".6" stop-color="#ffe0b8"/><stop offset="1" stop-color="#f59f45"/></radialGradient>
      <linearGradient id="padR" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6b70"/><stop offset="1" stop-color="#c0262c"/></linearGradient>
      <linearGradient id="padB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3d4a66"/><stop offset="1" stop-color="#121a2c"/></linearGradient>
    </defs>
    <ellipse cx="160" cy="182" rx="130" ry="10" fill="#0003"/>
    <path d="M40 150 L280 150 L250 92 L70 92 Z" fill="url(#tbl)" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
    <path d="M160 92 L160 150" stroke="#fff" stroke-width="2" opacity=".8"/>
    <path d="M58 150 L58 178 M262 150 L262 178 M84 92 L84 112 M236 92 L236 112" stroke="#0b4c3e" stroke-width="5" stroke-linecap="round"/>
    <rect x="150" y="70" width="20" height="34" rx="2" fill="#ffffffcc" class="net"/>
    <path d="M150 74 h20 M150 80 h20 M150 86 h20 M150 92 h20 M150 98 h20" stroke="#0f1b33" stroke-width=".8" opacity=".35"/>
    <g class="pad pad-a"><ellipse cx="40" cy="96" rx="22" ry="25" fill="url(#padR)" stroke="#fff" stroke-width="2"/><rect x="34" y="118" width="12" height="28" rx="5" fill="#b07a45"/></g>
    <g class="pad pad-b"><ellipse cx="282" cy="86" rx="22" ry="25" fill="url(#padB)" stroke="#fff" stroke-width="2"/><rect x="276" y="108" width="12" height="28" rx="5" fill="#b07a45"/></g>
    <circle class="hero-ball" r="8" fill="url(#ballg)"/>
  </svg>`;
}

const PALETTES: [string, string][] = [
  ['#3b5bfd', '#7b8cff'], ['#0e7c66', '#2fd1a6'], ['#e5484d', '#ff9a8b'], ['#f08c00', '#ffd166'],
  ['#8e4ec6', '#d6a4ff'], ['#0f1b33', '#3b5bfd'], ['#d6409f', '#ffa3d7'], ['#0091ff', '#7fd3ff'],
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
