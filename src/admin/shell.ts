/**
 * Frame of the role tools: its own header and role tabs instead of the public
 * site's menus, so each role sees only its own work. "View site" goes back.
 */
import { t, type MessageKey } from '../i18n/ar';
import { assisting, canOrganize, isAdmin, isHall, isSeller, isTrainer, session } from '../app/ctx';
import * as focus from '../app/focus';
import { icon } from '../ui/icons';
import { avatarOf, esc } from '../ui/util';
import { bell } from '../pages/alerts';

export type DeskRole = 'org' | 'trainer' | 'seller' | 'hall' | 'assist' | 'admin';

const TABS: [DeskRole, string, MessageKey][] = [
  ['org', 'trophy', 'desk.tab.org'],
  ['trainer', 'coach', 'desk.tab.trainer'],
  ['seller', 'shop', 'desk.tab.seller'],
  ['hall', 'table', 'desk.tab.hall'],
  ['assist', 'ball', 'desk.tab.assist'],
  ['admin', 'shield', 'desk.tab.admin'],
];

export function rolesHeld(): DeskRole[] {
  const out: DeskRole[] = [];
  if (canOrganize()) out.push('org');
  if (isTrainer()) out.push('trainer');
  if (isSeller()) out.push('seller');
  if (isHall()) out.push('hall');
  if (!isAdmin() && assisting.size) out.push('assist');
  if (isAdmin()) out.push('admin');
  return out;
}

export function deskShell(active: DeskRole, body: string, badges: Partial<Record<DeskRole, number>> = {}, pre = ''): string {
  if (active !== 'admin' && focus.roleModes().length) return focusShell(active, body, badges[active] ?? 0, pre);
  const held = TABS.filter(([k]) => rolesHeld().includes(k));
  const tabs = held.map(([k, ic, label]) => `<a href="#/desk/${k}" ${k === active ? 'aria-current="page"' : ''}>${icon(ic, 20)}<span>${t(label)}</span>${badges[k] ? `<i class="dk-badge">${badges[k]}</i>` : ''}</a>`).join('');
  return `<header class="dk-top">
    <a class="dk-brand" href="#/desk" aria-label="${esc(t('desk.name'))}"><img src="${import.meta.env.BASE_URL}brand/logo.png" alt="" width="54" height="36"><span><b>${t('desk.name')}</b><small>${t(`desk.tab.${active}` as MessageKey)}</small></span></a>
    <nav class="dk-tabs" aria-label="${esc(t('desk.tabsLabel'))}">${tabs}</nav>
    <span class="spacer"></span>
    <a class="btn small soft dk-site" href="#/" title="${esc(t('desk.toSiteTip'))}">${icon('home', 16)} <span class="hide-xs">${t('desk.toSite')}</span></a>
    ${bell()}
    ${session.profile ? `<a class="acct" href="#/me" title="${esc(session.profile.full_name)}">${avatarOf(session.profile)}</a>` : ''}
    <button class="helpbtn" data-act="hints" title="${t('common.help')}" aria-label="${t('common.help')}">؟</button>
  </header>
  <main class="page desk">${body}</main>
  ${held.length > 1 ? `<nav class="bottomnav dk-bottom" aria-label="${esc(t('desk.tabsLabel'))}">${tabs}</nav>` : ''}`;
}

/**
 * Frame of a role mode (see app/focus.ts): the role's own links only, with the
 * mode switch under the header. Site pages the role uses are drawn in it too.
 */
function focusShell(m: focus.RoleMode, body: string, badge: number, pre: string): string {
  const links = focus.navOf(m);
  const on = focus.activeHref(links.map(([h]) => h));
  const nav = links.map(([href, ic, label], i) => `<a href="${href}" ${href === on ? 'aria-current="page"' : ''}>${icon(ic, 20)}<span>${esc(label)}</span>${!i && badge ? `<i class="dk-badge">${badge}</i>` : ''}</a>`).join('');
  return `<header class="dk-top">
    <a class="dk-brand" href="${focus.homeOf(m)}" aria-label="${esc(t('desk.name'))}"><img src="${import.meta.env.BASE_URL}brand/logo.png" alt="" width="54" height="36"><span><b>${t('desk.name')}</b><small>${t(`desk.tab.${m}` as MessageKey)}</small></span></a>
    <nav class="dk-tabs" aria-label="${esc(t('desk.tabsLabel'))}">${nav}</nav>
    <span class="spacer"></span>
    ${bell()}
    ${session.profile ? `<a class="acct" href="#/me" title="${esc(session.profile.full_name)}">${avatarOf(session.profile)}</a>` : ''}
    <button class="helpbtn" data-act="hints" title="${t('common.help')}" aria-label="${t('common.help')}">؟</button>
  </header>
  ${focus.bar()}
  ${pre}
  <main class="page desk">${body}</main>
  <nav class="bottomnav dk-bottom" aria-label="${esc(t('desk.tabsLabel'))}">${nav}</nav>`;
}
