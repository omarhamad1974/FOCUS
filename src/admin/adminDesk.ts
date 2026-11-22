/**
 * Admin's tool: entry to every role's tool, the full admin console, and the
 * 40 demo players used by the simulations.
 */
import { t, type MessageKey } from '../i18n/ar';
import { n } from '../app/ctx';
import { icon } from '../ui/icons';
import { esc } from '../ui/util';
import { simPlayersNow } from './api';
import { ensureSim, simAvatar, tip } from './ui';
import { adminSummary } from './subs';

const TILES: [string, string, MessageKey, MessageKey][] = [
  ['#/desk/admin/subs', 'money', 'desk.admin.subs', 'desk.admin.subsTip'],
  ['#/desk/admin/posters', 'image', 'desk.admin.posters', 'desk.admin.postersTip'],
  ['#/desk/org', 'trophy', 'desk.tab.org', 'desk.admin.orgTip'],
  ['#/desk/trainer', 'coach', 'desk.tab.trainer', 'desk.admin.trainerTip'],
  ['#/desk/seller', 'shop', 'desk.tab.seller', 'desk.admin.sellerTip'],
  ['#/admin', 'shield', 'desk.admin.console', 'desk.admin.consoleTip'],
  ['#/admin/users', 'users', 'desk.admin.accounts', 'desk.admin.accountsTip'],
  ['#/admin/sim', 'eye', 'desk.admin.journeys', 'desk.admin.journeysTip'],
];

export function page(): string {
  ensureSim();
  const players = simPlayersNow();
  const year = new Date().getFullYear();
  return `<section class="banner b-admin slim"><div><h1>${icon('shield', 26)} ${t('desk.admin.title')}</h1><p>${t('desk.admin.hint')}</p></div></section>
  ${adminSummary()}
  <div class="dk-tiles">${TILES.map(([href, ic, label, tipKey]) => `<a class="dk-tile rise" href="${href}">${icon(ic, 30)}<b>${t(label)}</b><small>${t(tipKey)}</small></a>`).join('')}</div>
  <div class="card">
    <div class="row between"><h2>👥 ${t('desk.admin.simPlayers')}</h2>${players ? `<span class="badge blue">${n(players.length)}</span>` : ''}</div>
    ${tip('desk.admin.simPlayersHint')}
    ${players ? `<div class="dk-people">${players.map((p) => `<div class="dk-person">${simAvatar(p)}
      <b dir="auto">${esc(p.full_name)}</b><small class="muted" dir="auto">${esc(p.club ?? '')}${p.birth_year ? ` · ${n(year - p.birth_year)} ${t('desk.admin.years')}` : ''}</small></div>`).join('')}</div>`
      : `<p class="muted"><span class="spin"></span> ${t('reg.loading')}</p>`}
    <p class="small muted">${t('desk.admin.photoCredit')}</p>
  </div>`;
}
