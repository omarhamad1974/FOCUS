/**
 * Role focus mode. Someone the admin gave a special role (organizer, trainer,
 * seller, hall owner, or a score assistant named by an organizer) picks how to
 * use Pingo: as a player (the whole site) or as one of their roles. In a role
 * mode only that role's work shows: its desk and the pages it needs. Everything
 * else is hidden until they switch back. One mode at a time; the choice is kept
 * in this browser per account. Admins and plain players never see the switch.
 */
import { t, type MessageKey } from '../i18n/ar';
import { online } from '../config';
import { assisting, canOrganize, isAdmin, isHall, isSeller, isTrainer, rendering, session } from './ctx';
import { icon } from '../ui/icons';
import { esc } from '../ui/util';

export type Mode = 'player' | 'org' | 'trainer' | 'seller' | 'hall' | 'assist';
export type RoleMode = Exclude<Mode, 'player'>;

const ICONS: Record<Mode, string> = { player: 'user', org: 'trophy', trainer: 'coach', seller: 'shop', hall: 'table', assist: 'edit' };
export const modeIcon = (m: Mode) => ICONS[m];
export const modeName = (m: Mode) => t(`focus.m.${m}` as MessageKey);

/** The role modes this user may switch to (empty for guests, plain players and admins). */
export function roleModes(): RoleMode[] {
  const p = session.profile;
  if (!online() || !p || isAdmin() || rendering.preview !== 'off') return [];
  const out: RoleMode[] = [];
  if (canOrganize()) out.push('org');
  if (isTrainer()) out.push('trainer');
  if (isSeller()) out.push('seller');
  if (isHall()) out.push('hall');
  if (assisting.size) out.push('assist');
  return out;
}

const key = () => `pingo.focus.${session.profile?.id ?? ''}`;

/** The mode in use now; "player" when none was picked or the role was taken away. */
export function current(): Mode {
  const held = roleModes();
  if (!held.length) return 'player';
  let v: string | null = null;
  try { v = localStorage.getItem(key()); } catch { /* ignore */ }
  return held.includes(v as RoleMode) ? (v as RoleMode) : 'player';
}

export function set(m: Mode): void {
  try { if (m === 'player') localStorage.removeItem(key()); else localStorage.setItem(key(), m); } catch { /* ignore */ }
}

/** Where a mode starts: its desk, or the home page for the player. */
export const homeOf = (m: Mode) => (m === 'player' ? '#/' : `#/desk/${m}`);

/** Page links of a role mode: its desk first, then the site pages it uses. */
export function navOf(m: RoleMode): [string, string, string][] {
  const me = session.profile?.id ?? '';
  const desk: [string, string, string] = [homeOf(m), modeIcon(m), t('focus.nav.desk')];
  const items: [string, string, string][] = [desk];
  if (m === 'org') items.push(['#/tournaments/mine', 'trophy', t('focus.nav.mine')], ['#/desk/org/players', 'star', t('pl.title')]);
  if (m === 'trainer') items.push(['#/training/manage', 'calendar', t('focus.nav.sessions')], [`#/training/t/${me}`, 'eye', t('focus.nav.trainerPage')]);
  if (m === 'seller') items.push(['#/shop/manage', 'box', t('focus.nav.products')], [`#/shops/${me}`, 'eye', t('focus.nav.shop')]);
  items.push(['#/me', 'user', t('nav.me')]);
  return items;
}

/** The nav link that best matches the page (longest prefix), for aria-current. */
export function activeHref(links: string[], hash = location.hash || '#/'): string {
  return links.filter((h) => hash === h || hash.startsWith(`${h}/`)).sort((a, b) => b.length - a.length)[0] ?? '';
}

/**
 * May this page open in mode `m`? Account pages always may; the rest only when
 * they belong to the role's work. `ownsT` tells whether a tournament is the
 * organizer's own (or one they assist).
 */
export function allows(m: RoleMode, parts: string[], ownsT: (id: string) => boolean, assists: (id: string) => boolean): boolean {
  const [a, b, c] = parts;
  const me = session.profile?.id;
  if (['me', 'password', 'alerts', 'login', 'faq', 'install', 'u', 'mode', 'desk'].includes(a)) return true;
  if (m === 'org') {
    if (a === 't') return !!b && (ownsT(b) || assists(b));
    if (a === 'tournaments') return b === 'mine';
    return a === 'new' || a === 'players' || a === 'admin' || a === 'org';
  }
  if (m === 'assist') return (a === 't' && !!b && assists(b)) || (a === 'tournaments' && b === 'mine');
  if (m === 'trainer') return a === 'training' && (b === 'manage' || (b === 't' && c === me));
  if (m === 'seller') {
    if (a === 'shop') return b === 'manage' || b === 'new' || b === 'p';
    return a === 'shops' && (b === 'edit' || b === me);
  }
  if (m === 'hall') return a === 'halls' && !!b;
  return false;
}

/** Page last hidden by a role mode, opened after switching to the player mode. */
let hiddenPage = '';
export const takeHidden = () => { const h = hiddenPage; hiddenPage = ''; return h; };

/** Card shown in place of a page that the role mode hides. */
export function hiddenCard(m: RoleMode): string {
  hiddenPage = location.hash;
  const mode = modeName(m);
  return `<section class="card center focus-hidden rise">
    <span class="fh-ic">${icon(modeIcon(m), 40)}</span>
    <h1>${esc(t('focus.hiddenTitle', { mode }))}</h1>
    <p class="muted">${esc(t('focus.hiddenText', { mode }))}</p>
    <div class="row center"><a class="btn gold" href="${homeOf(m)}">${icon(modeIcon(m), 18)} ${t('focus.backDesk')}</a>
      <a class="btn soft" href="#/mode/player">${icon('user', 18)} ${t('focus.toPlayer')}</a></div></section>`;
}

/** The switch: "I use Pingo as: player | organizer | seller…", only the roles the admin gave. */
export function bar(): string {
  const held = roleModes();
  if (!held.length) return '';
  const now = current();
  const all: Mode[] = ['player', ...held];
  return `<nav class="wsbar focusbar ${now === 'player' ? '' : 'on'}" aria-label="${esc(t('focus.barLabel'))}">
    <span class="ws-label">${icon('grid', 16)} <span class="ws-name">${t('focus.label')}</span><span class="ws-short">${t('focus.labelShort')}</span></span>
    ${all.map((m) => `<a class="ws-btn" href="#/mode/${m}" title="${esc(t(`focus.tip.${m}` as MessageKey))}" ${m === now ? 'aria-current="true"' : ''}>${icon(modeIcon(m), 18)}<span>${modeName(m)}</span></a>`).join('')}</nav>`;
}
