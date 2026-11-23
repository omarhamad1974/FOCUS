/**
 * Score assistant's desk: the tournaments an organizer named this user to score,
 * with how many matches are left and one button to the matches.
 */
import { dateFmt, t } from '../i18n/ar';
import * as content from '../data/content';
import { assisting, n } from '../app/ctx';
import { progress } from '../domain/tournament';
import type { Tournament } from '../domain/types';
import { cover, empty } from '../ui/art';
import { icon } from '../ui/icons';
import { esc } from '../ui/util';
import { host } from './host';

function card(tm: Tournament): string {
  const p = progress(tm);
  const left = Math.max(0, p.total - p.done);
  const org = tm.organizerId ? content.person(tm.organizerId)?.full_name : '';
  const state = tm.stage === 'setup' ? `<span class="badge">${t('asd.notStarted')}</span>`
    : left ? `<span class="badge gold">${icon('ball', 13)} ${t('asd.left', { n: n(left) })}</span>`
      : `<span class="badge green">${icon('check', 13)} ${t('asd.allDone')}</span>`;
  return `<a class="dk-tcard rise" href="#/t/${tm.id}/${tm.stage === 'knockout' ? 'knockout' : 'matches'}">
    <span class="dk-tcover">${cover(tm.cover ? esc(tm.cover) : null, tm.id, 'trophy', esc(tm.name))}</span>
    <span class="dk-tbody">
      <span class="row between"><b dir="auto">${esc(tm.name)}</b>${state}</span>
      <small class="muted">${tm.date ? `${icon('calendar', 13)} ${dateFmt.format(new Date(tm.date))}` : ''}${org ? ` · ${esc(t('asd.by', { name: org }))}` : ''}</small>
      ${p.total ? `<small class="muted">${t('dash.matchesDone', { done: n(p.done), total: n(p.total) })}</small>` : ''}
      <span class="btn small green" style="align-self:flex-start">${icon('edit', 15)} ${t('asd.open')}</span>
    </span></a>`;
}

export function page(): string {
  const list = host.tournaments().filter((x) => assisting.has(x.id));
  return `<section class="banner b-org slim"><div><h1>${icon('ball', 26)} ${t('asd.title')}</h1><p>${t('asd.hint')}</p></div></section>
  ${list.length ? `<div class="dk-tlist">${list.map(card).join('')}</div>` : empty('ball', t('asd.none'))}`;
}
