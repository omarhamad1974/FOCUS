/**
 * Winner celebration for a finished tournament's card: an original cartoon
 * table tennis player jumping on the podium with a trophy and a paddle, with
 * the champion's photo as the face. Without a photo we draw a happy face
 * (hair by gender). Confetti falls around the scene.
 */
import { esc } from './util';

const SKIN = '#f2c39b';
const SKIN_SHADE = '#e3a87b';
const HAIR = '#3b2618';
const NAVY = '#0c1f4a';
const GREEN = '#7ed957';
const RED = '#e01b2a';
const BLUE = '#0b55a8';
const GOLD = '#f5b301';

const CONFETTI = [GREEN, RED, GOLD, '#fff', BLUE, GREEN, GOLD, RED, '#fff', BLUE, GOLD, GREEN];

/** A face drawn inside the head circle when the winner has no photo. */
function drawnFace(gender: string | null | undefined): string {
  const face = `<circle cx="80" cy="62" r="25" fill="${SKIN}"/>
    <path d="M67 60 q4 -5 8 0 M85 60 q4 -5 8 0" fill="none" stroke="${NAVY}" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="66" cy="69" r="3.6" fill="#ff8a8a" opacity=".45"/><circle cx="94" cy="69" r="3.6" fill="#ff8a8a" opacity=".45"/>
    <path d="M70 68 Q80 82 90 68 Z" fill="#8a2a1a"/><path d="M73 74 Q80 79 87 74 Q80 77 73 74 Z" fill="#ff7b7b"/>`;
  if (gender === 'female') {
    return `<path d="M56 56 Q50 86 60 92 Q66 80 64 66 M104 56 Q110 86 100 92 Q94 80 96 66" fill="${HAIR}"/>${face}
      <path d="M55 62 Q52 36 80 36 Q108 36 105 62 Q102 50 94 45 Q80 54 64 47 Q58 53 55 62 Z" fill="${HAIR}"/>
      <path d="M57 48 Q80 32 103 48" fill="none" stroke="${RED}" stroke-width="4.5" stroke-linecap="round"/>`;
  }
  if (gender === 'male') {
    return `${face}<path d="M55 60 Q52 35 80 36 Q108 35 105 60 Q102 48 94 45 Q84 51 66 45 Q58 50 55 60 Z" fill="${HAIR}"/>`;
  }
  return `${face}<path d="M56 54 Q60 38 80 37 Q100 38 104 54 Q92 44 80 46 Q68 44 56 54 Z" fill="${NAVY}"/>
    <path d="M58 52 L102 52" stroke="${GREEN}" stroke-width="4" stroke-linecap="round"/>`;
}

/**
 * The celebration scene, decorative only (the winner's name is shown as text
 * beside it). `key` keeps the SVG ids unique when several cards are on screen.
 */
export function championCelebration(key: string, photo: string | null | undefined, gender: string | null | undefined): string {
  const id = `cel-${key.replace(/[^\w-]/g, '')}`;
  const head = photo
    ? `<circle cx="80" cy="62" r="25" fill="${SKIN}"/>
       <image href="${esc(photo)}" x="55" y="37" width="50" height="50" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id}-h)"/>`
    : drawnFace(gender);
  const confetti = CONFETTI.map((c, i) =>
    `<i style="--x:${(i * 37 + 7) % 100}%;--d:${((i * 0.29) % 2.4).toFixed(2)}s;--t:${(2.2 + (i % 4) * 0.35).toFixed(2)}s;--r:${(i % 2 ? 1 : -1) * (180 + i * 25)}deg;background:${c}"></i>`).join('');
  return `<div class="champ-cel" aria-hidden="true">
    <span class="cel-confetti">${confetti}</span>
    <svg class="cel-svg" viewBox="0 -14 160 226" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="${id}-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff3b0" stop-opacity=".95"/><stop offset=".6" stop-color="${GOLD}" stop-opacity=".35"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0"/></radialGradient>
        <linearGradient id="${id}-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe680"/><stop offset=".5" stop-color="${GOLD}"/><stop offset="1" stop-color="#c88a00"/></linearGradient>
        <linearGradient id="${id}-pad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5a66"/><stop offset="1" stop-color="#b30c18"/></linearGradient>
        <linearGradient id="${id}-pod" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a6e88a"/><stop offset="1" stop-color="#4fae3a"/></linearGradient>
        <clipPath id="${id}-h"><circle cx="80" cy="62" r="25"/></clipPath>
      </defs>
      <circle class="cel-glow" cx="80" cy="78" r="78" fill="url(#${id}-glow)"/>
      <g class="cel-spark" fill="#fff"><path d="M16 92 l3 -8 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 Z"/><path d="M140 100 l2 -6 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 Z"/><path d="M148 18 l2 -5 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 Z"/></g>
      <rect x="38" y="180" width="84" height="32" rx="7" fill="url(#${id}-pod)"/>
      <rect x="38" y="180" width="84" height="6" rx="3" fill="#fff" opacity=".35"/>
      <text x="80" y="206" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="900" font-size="20" fill="${NAVY}">1</text>
      <g class="cel-jump">
        <rect x="62" y="140" width="10" height="36" rx="4" fill="${SKIN}"/><rect x="88" y="140" width="10" height="36" rx="4" fill="${SKIN}"/>
        <rect x="61" y="164" width="12" height="7" fill="#fff"/><rect x="87" y="164" width="12" height="7" fill="#fff"/>
        <ellipse cx="65" cy="177" rx="10" ry="5.5" fill="${RED}"/><ellipse cx="95" cy="177" rx="10" ry="5.5" fill="${RED}"/>
        <path d="M56 120 L104 120 L107 148 L84 148 L80 136 L76 148 L53 148 Z" fill="#081636"/>
        <path d="M57 92 Q80 85 103 92 L106 126 Q80 132 54 126 Z" fill="${NAVY}"/>
        <path d="M57 98 L55 126 M103 98 L105 126" stroke="${GREEN}" stroke-width="3.5" stroke-linecap="round"/>
        <rect x="74" y="80" width="12" height="13" rx="4" fill="${SKIN_SHADE}"/>
        <path d="M70 90 L80 101 L90 90" fill="none" stroke="${GREEN}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="92" cy="110" r="5" fill="#fff"/><path d="M89 108 q3 3 6 0" fill="none" stroke="${GREEN}" stroke-width="1.4"/>
        <g class="cel-arm-l">
          <path d="M62 98 Q46 80 41 50" fill="none" stroke="${SKIN}" stroke-width="11" stroke-linecap="round"/>
          <path d="M63 99 Q57 92 53 86" fill="none" stroke="${NAVY}" stroke-width="15" stroke-linecap="round"/>
          <path d="M29 40 L51 40 L49 45 L31 45 Z" fill="#8a5a00"/>
          <rect x="37" y="31" width="6" height="10" fill="url(#${id}-gold)"/>
          <path d="M27 4 Q20 4 20 12 Q20 21 31 23 M53 4 Q60 4 60 12 Q60 21 49 23" fill="none" stroke="url(#${id}-gold)" stroke-width="3.5"/>
          <path d="M26 2 L54 2 Q54 28 40 32 Q26 28 26 2 Z" fill="url(#${id}-gold)" stroke="#c88a00" stroke-width="1"/>
          <path d="M32 7 Q32 20 38 25" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".7"/>
          <text x="40" y="20" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="900" font-size="11" fill="#8a5a00">1</text>
          <circle cx="41" cy="48" r="7" fill="${SKIN}"/>
        </g>
        <g class="cel-arm-r">
          <path d="M98 98 Q115 82 121 56" fill="none" stroke="${SKIN}" stroke-width="11" stroke-linecap="round"/>
          <path d="M97 99 Q103 92 107 86" fill="none" stroke="${NAVY}" stroke-width="15" stroke-linecap="round"/>
          <g transform="rotate(18 122 50)"><rect x="118" y="34" width="8" height="20" rx="3.5" fill="#b07a45"/>
            <ellipse cx="122" cy="20" rx="15" ry="17" fill="url(#${id}-pad)" stroke="#fff" stroke-width="2.2"/></g>
          <circle cx="121" cy="54" r="7" fill="${SKIN}"/>
        </g>
        <g class="cel-head">${head}<circle cx="80" cy="62" r="25" fill="none" stroke="${GOLD}" stroke-width="3.5"/></g>
      </g>
      <circle class="cel-ball" cx="142" cy="60" r="5.5" fill="#fff" stroke="${NAVY}" stroke-opacity=".2"/>
    </svg>
  </div>`;
}
