/**
 * Default profile pictures for people without a photo: a table tennis player
 * (male or female) drawn in the Pingo colours, or a paddle when we do not know.
 * Returned as data URLs so they work like any uploaded photo.
 */

export type Gender = 'male' | 'female';

const SKIN = '#f2c39b';
const SKIN_SHADE = '#e3a87b';
const HAIR = '#3b2618';

/** Shared parts: green circle, flying ball, face. */
const frame = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
<defs>
<radialGradient id="bg" cx=".3" cy=".25" r=".9"><stop offset="0" stop-color="#eafbe3"/><stop offset=".55" stop-color="#a6e88a"/><stop offset="1" stop-color="#7ed957"/></radialGradient>
<radialGradient id="ball" cx=".35" cy=".35" r=".7"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#dfe6ee"/></radialGradient>
<linearGradient id="pad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5a66"/><stop offset="1" stop-color="#b30c18"/></linearGradient>
<clipPath id="c"><circle cx="60" cy="60" r="60"/></clipPath>
</defs>
<g clip-path="url(#c)">
<rect width="120" height="120" fill="url(#bg)"/>
<path d="M14 40 Q26 18 46 14" fill="none" stroke="#fff" stroke-width="2.5" stroke-dasharray="3 5" stroke-linecap="round" opacity=".9"/>
<circle cx="14" cy="44" r="6" fill="url(#ball)" stroke="#0c1f4a" stroke-opacity=".15"/>
${inner}
</g>
</svg>`;

const face = `<rect x="53" y="66" width="14" height="14" rx="5" fill="${SKIN_SHADE}"/>
<ellipse cx="40.5" cy="52" rx="4" ry="5.5" fill="${SKIN_SHADE}"/><ellipse cx="79.5" cy="52" rx="4" ry="5.5" fill="${SKIN_SHADE}"/>
<ellipse cx="60" cy="50" rx="19" ry="21" fill="${SKIN}"/>
<circle cx="53" cy="51" r="2.3" fill="#0c1f4a"/><circle cx="67" cy="51" r="2.3" fill="#0c1f4a"/>
<circle cx="49" cy="58" r="3" fill="#ff8a8a" opacity=".35"/><circle cx="71" cy="58" r="3" fill="#ff8a8a" opacity=".35"/>
<path d="M53.5 60 Q60 65.5 66.5 60" fill="none" stroke="#8a3b22" stroke-width="2.2" stroke-linecap="round"/>`;

/** Jersey with a light green collar and a red paddle held up at the side. */
const body = (shirt: string, trim: string) => `<path d="M18 120 Q20 84 46 76 L60 86 L74 76 Q100 84 102 120 Z" fill="${shirt}"/>
<path d="M46 76 L60 90 L74 76 L69 74 L60 83 L51 74 Z" fill="${trim}"/>
<path d="M30 94 L36 120 M90 94 L84 120" stroke="${trim}" stroke-width="4" opacity=".9"/>
<g transform="rotate(-24 98 76)"><rect x="94" y="80" width="8" height="20" rx="3.5" fill="#b07a45"/><ellipse cx="98" cy="68" rx="14" ry="16" fill="url(#pad)" stroke="#fff" stroke-width="2"/></g>
<ellipse cx="94" cy="98" rx="7" ry="6" fill="${SKIN}"/>`;

const MALE = frame(`${body('#0c1f4a', '#7ed957')}
${face}
<path d="M41 50 Q39 26 60 27 Q82 26 79 50 Q77 40 70 37 Q62 41 50 37 Q44 40 41 50 Z" fill="${HAIR}"/>
<path d="M50 44 l5 -1 M65 43 l5 1" stroke="${HAIR}" stroke-width="2" stroke-linecap="round"/>`);

const FEMALE = frame(`${body('#0b55a8', '#7ed957')}
<path d="M40 40 Q32 70 38 84 Q46 90 54 82 L66 82 Q74 90 82 84 Q88 70 80 40 Z" fill="${HAIR}"/>
${face}
<path d="M40 54 Q36 26 60 26 Q84 26 80 54 Q78 42 72 36 Q60 44 46 40 Q42 46 40 54 Z" fill="${HAIR}"/>
<path d="M42 38 Q60 26 78 38" fill="none" stroke="#e01b2a" stroke-width="4" stroke-linecap="round"/>
<path d="M50 44 l5 -1 M65 43 l5 1" stroke="${HAIR}" stroke-width="1.6" stroke-linecap="round"/>
<path d="M50.5 49 l-2 -1.6 M69.5 49 l2 -1.6" stroke="#0c1f4a" stroke-width="1.2" stroke-linecap="round"/>`);

const UNKNOWN = frame(`<g transform="rotate(-20 62 64)"><rect x="56" y="80" width="12" height="30" rx="5" fill="#b07a45"/><ellipse cx="62" cy="58" rx="26" ry="29" fill="url(#pad)" stroke="#fff" stroke-width="3"/></g>
<circle cx="84" cy="34" r="9" fill="url(#ball)" stroke="#0c1f4a" stroke-opacity=".15"/>`);

const url = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\n/g, ''))}`;
const URLS: Record<Gender | 'unknown', string> = { male: url(MALE), female: url(FEMALE), unknown: url(UNKNOWN) };

/** The default picture for someone without a photo. */
export function defaultAvatar(gender?: Gender | string | null): string {
  return gender === 'male' || gender === 'female' ? URLS[gender] : URLS.unknown;
}
