/**
 * Public page of a person (#/u/<id>): photo, name, club, roles and the optional
 * biography that organizers, trainers and sellers write in their tools.
 * Organizers' tournaments are listed; trainers link to their booking page.
 */
import { dateFmt, t } from '../i18n/ar';
import * as content from '../data/content';
import { n, render, session } from '../app/ctx';
import { host } from '../admin/host';
import { empty } from '../ui/art';
import { icon } from '../ui/icons';
import { avatarOf, esc } from '../ui/util';

const asked = new Set<string>();

export function page(id: string): string {
  const p = content.person(id);
  if (!p) {
    if (!asked.has(id)) {
      asked.add(id);
      content.people([id]).catch(() => undefined).finally(render);
      return `<div class="card center muted"><span class="spin"></span> ${t('reg.loading')}</div>`;
    }
    return empty('user', t('prof.notFound'), `<a class="btn small" href="#/">${t('t.backHome')}</a>`);
  }
  const tours = host.tournaments().filter((x) => x.organizerId === id)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const isOrg = !!p.is_organizer || tours.length > 0;
  const roles = [
    isOrg ? `<span class="badge blue">${icon('trophy', 14)} ${t('roles.organizer')}</span>` : '',
    p.is_trainer ? `<span class="badge blue">${icon('coach', 14)} ${t('roles.trainer')}</span>` : '',
    p.is_seller ? `<span class="badge blue">${icon('shop', 14)} ${t('roles.seller')}</span>` : '',
  ].join('');
  const own = session.profile?.id === id;
  return `<section class="banner b-me slim rise prof-head"><div class="row">${avatarOf(p)}<div><h1 dir="auto">${esc(p.full_name)}</h1>
    ${p.club ? `<p dir="auto">${icon('pin', 14)} ${esc(p.club)}</p>` : ''}
    <div class="row" style="gap:6px;margin-block-start:6px">${roles || `<span class="badge">${t('role.player')}</span>`}</div></div></div></section>
  <div class="card prof-bio"><h3>✍️ ${t('bio.title')}</h3>
    ${p.bio ? `<p dir="auto">${esc(p.bio).replace(/\n/g, '<br>')}</p>` : `<p class="muted">${t(own ? 'bio.emptyOwn' : 'bio.emptyOther')}</p>`}
    ${own && (isOrg || p.is_trainer || p.is_seller) ? `<a class="btn soft small" href="#/desk">${icon('edit', 14)} ${t('bio.editInDesk')}</a>` : ''}
  </div>
  ${p.is_trainer ? `<a class="card faq-cta rise" href="#/training/t/${esc(id)}"><span class="faq-ic">${icon('coach', 26)}</span>
    <span><b>${t('prof.bookTrainer')}</b><br><small class="muted">${t('prof.bookTrainerText')}</small></span>${icon('chevron', 18)}</a>` : ''}
  ${tours.length ? `<div class="card"><h3>${icon('trophy', 20)} ${t('prof.tournaments')} <span class="badge">${n(tours.length)}</span></h3>
    ${tours.map((x) => `<a class="match" href="#/t/${esc(x.id)}" style="grid-template-columns:1fr auto">
      <span class="p" dir="auto">${esc(x.name)}</span><small class="muted">${x.date ? dateFmt.format(new Date(x.date)) : ''}</small></a>`).join('')}</div>` : ''}`;
}
