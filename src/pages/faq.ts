/** FAQ: short answers about signing up, joining and leaving tournaments, and roles. */
import { t, type MessageKey } from '../i18n/ar';
import { SUPPORT_WHATSAPP } from '../config';
import { session } from '../app/ctx';
import { icon } from '../ui/icons';
import { esc } from '../ui/util';

type Topic = 'signup' | 'join' | 'withdraw' | 'organizer' | 'trainer';

/** In the order players usually need them. Each answer links to where the steps start. */
const TOPICS: { id: Topic; icon: string; go: () => string }[] = [
  { id: 'signup', icon: 'user', go: () => (session.profile ? '#/me' : '#/login') },
  { id: 'join', icon: 'trophy', go: () => '#/tournaments' },
  { id: 'withdraw', icon: 'logout', go: () => (session.profile ? '#/me' : '#/tournaments') },
  { id: 'organizer', icon: 'shield', go: () => (session.profile ? '#/me' : '#/login') },
  { id: 'trainer', icon: 'coach', go: () => (session.profile ? '#/me' : '#/login') },
];

const k = (id: Topic, part: 'q' | 'steps' | 'note') => t(`faq.${id}.${part}` as MessageKey);

/** wa.me link with a ready greeting, or '' when no support number is set. */
export function whatsappLink(): string {
  return SUPPORT_WHATSAPP ? `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(t('support.message'))}` : '';
}

/** The round WhatsApp button that floats over every page. */
export function supportButton(): string {
  const href = whatsappLink();
  if (!href) return '';
  return `<a class="wa-fab" href="${href}" target="_blank" rel="noopener" aria-label="${esc(t('support.label'))}" title="${esc(t('support.label'))}">
    ${icon('whatsapp', 28)}<span class="wa-tip">${t('support.chat')}</span></a>`;
}

export function route(parts: string[]): string | null {
  if (parts[0] !== 'faq') return null;
  const open = (TOPICS.find((x) => x.id === parts[1]) ?? TOPICS[0]).id;
  const item = (x: (typeof TOPICS)[number]) => `<details class="card faq rise" id="faq-${x.id}" ${x.id === open ? 'open' : ''}>
    <summary><span class="faq-ic">${icon(x.icon, 22)}</span><b>${k(x.id, 'q')}</b>${icon('chevron', 18, 'faq-chev')}</summary>
    <ol class="faq-steps">${k(x.id, 'steps').split('|').map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <p class="hint">${esc(k(x.id, 'note'))}</p>
    <a class="btn soft small" href="${x.go()}">${t('faq.go')} ${icon('chevron', 14)}</a>
  </details>`;
  const wa = whatsappLink();
  return `<section class="banner b-faq slim"><div><h1>${icon('help', 26)} ${t('faq.title')}</h1><p>${t('faq.lead')}</p></div></section>
    <nav class="faq-index">${TOPICS.map((x) => `<a class="chip" href="#/faq/${x.id}">${icon(x.icon, 16)} ${k(x.id, 'q')}</a>`).join('')}</nav>
    ${TOPICS.map(item).join('')}
    ${wa ? `<div class="card faq-more"><div><b>${t('faq.more')}</b><p class="muted small">${t('faq.moreText')}</p></div>
      <a class="btn green" href="${wa}" target="_blank" rel="noopener">${icon('whatsapp')} ${t('support.chat')}</a></div>` : ''}`;
}
