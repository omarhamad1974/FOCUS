/**
 * Admin tab «إزالة الحسابات» (#/admin/people): every account in one searchable list with role
 * filters, a delete button per person, tick-to-select for many, and one strong confirm box.
 * Admin accounts and your own account never appear. #/admin/people/del/<id> opens the confirm
 * for one person (used by the admin's delete button on a profile page).
 */
import { t, type MessageKey } from '../i18n/ar';
import * as content from '../data/content';
import * as remote from '../data/remote';
import { authErr, hint, n, render, session } from '../app/ctx';
import { CONFIRM_WORD, confirmed, isTempAccount } from '../domain/bulk';
import { fallout, filterPeople, PEOPLE_FILTERS, rolesOf, type PeopleFilter, type Person } from '../domain/people';
import { simPlayersNow, forgetSim } from '../admin/api';
import { ensureSim } from '../admin/ui';
import { icon } from '../ui/icons';
import { avatarOf, esc, toast } from '../ui/util';

export interface PeopleData {
  profiles: remote.Profile[];
  tournaments: { organizer_id: string }[];
  products: { seller_id: string }[];
}

const FILTER_ICON: Record<PeopleFilter, string> = {
  all: 'users', player: 'racket', organizer: 'trophy', seller: 'shop', trainer: 'coach', hall: 'table', temp: 'clock', sim: 'eye',
};
const ROLE_ICON = { organizer: 'trophy', seller: 'shop', trainer: 'coach', hall: 'table' } as const;

const st = {
  filter: 'all' as PeopleFilter,
  q: '',
  selected: new Set<string>(),
  confirm: null as string[] | null,
  running: false,
  /** The profile page a single delete came from, to leave it after the account is gone. */
  fromProfile: null as string | null,
};

let data: PeopleData | null = null;
let after: () => Promise<void> = async () => undefined;

const simIds = () => new Set((simPlayersNow() ?? []).map((p) => p.id));
const me = () => session.profile?.id;
const everyone = () => filterPeople(data?.profiles ?? [], me(), 'all', '', simIds());
const shown = () => filterPeople(data?.profiles ?? [], me(), st.filter, st.q, simIds());

export function view(d: PeopleData, parts: string[], onDone: () => Promise<void>): string {
  data = d; after = onDone;
  ensureSim();
  // #/admin/people/del/<id>: open the confirm for that one account (from its profile page).
  if (parts[2] === 'del' && parts[3] && st.fromProfile !== parts[3]) {
    const ok = everyone().some((p) => p.id === parts[3]);
    st.fromProfile = parts[3];
    if (ok) { st.confirm = [parts[3]]; setTimeout(() => document.getElementById('pplWord')?.focus(), 0); }
    else toast(t('ppl.cannot'));
  }
  const sim = simIds();
  const all = everyone();
  const chips = PEOPLE_FILTERS.map((f) => {
    const count = filterPeople(d.profiles, me(), f, '', sim).length;
    return `<button class="ppl-chip ${st.filter === f ? 'on' : ''}" data-act="adm-ppl-f" data-v="${f}" aria-pressed="${st.filter === f}">
      ${icon(FILTER_ICON[f], 16)} ${t(`ppl.f.${f}` as MessageKey)} <b>${n(count)}</b></button>`;
  }).join('');
  return `<div class="card bulk-warn ppl-head"><h2>${icon('trash', 22)} ${t('ppl.title')}</h2>${hint('ppl.hint')}
      <div class="ppl-search">${icon('search', 18)}<input class="input" id="pplQ" type="search" dir="auto" autocomplete="off" data-act="adm-ppl-q"
        placeholder="${esc(t('ppl.search'))}" value="${esc(st.q)}"></div>
      <div class="ppl-chips" role="group" aria-label="${esc(t('ppl.filters'))}">${chips}</div>
      <p class="small muted">${t('ppl.total', { n: all.length })}</p></div>
    <div class="card" id="pplBody">${body()}</div>`;
}

function body(): string {
  const list = shown();
  const sel = [...st.selected].filter((id) => everyone().some((p) => p.id === id));
  const allOn = list.length > 0 && list.every((p) => st.selected.has(p.id));
  const bar = !st.confirm ? `<div class="ppl-bar ${sel.length ? 'on' : ''}">
      <label class="bulk-all"><input type="checkbox" data-act="adm-ppl-all" ${allOn ? 'checked' : ''} ${list.length ? '' : 'disabled'}> ${t('ppl.selectShown', { n: list.length })}</label>
      <button class="btn red" data-act="adm-ppl-ask" data-v="sel" ${sel.length ? '' : 'disabled'}>${icon('trash', 16)} ${t('bulk.deleteSelected', { n: sel.length })}</button>
      ${sel.length ? `<button class="btn ghost small" data-act="adm-ppl-clear">${t('ppl.clear')}</button>` : ''}</div>` : '';
  return `${st.confirm ? confirmBox() : ''}${bar}
    ${list.length ? `<div class="ppl-list">${list.map(row).join('')}</div>` : `<p class="muted center">${t(st.q ? 'ppl.noMatch' : 'bulk.empty')}</p>`}`;
}

function row(p: Person): string {
  const on = st.selected.has(p.id);
  const sim = simIds().has(p.id);
  const tours = data!.tournaments.filter((x) => x.organizer_id === p.id).length;
  const prods = data!.products.filter((x) => x.seller_id === p.id).length;
  const badges = [
    ...rolesOf(p).map((r) => `<span class="badge blue">${icon(ROLE_ICON[r], 12)} ${t(`roles.${r}` as MessageKey)}</span>`),
    rolesOf(p).length ? '' : `<span class="badge">${t('role.player')}</span>`,
    isTempAccount(p) ? `<span class="badge gold">${t('batch.temp')}</span>` : '',
    sim ? `<span class="badge">${icon('eye', 12)} ${t('ppl.simBadge')}</span>` : '',
    tours ? `<span class="badge green">${icon('trophy', 12)} ${n(tours)}</span>` : '',
    prods ? `<span class="badge green">${icon('box', 12)} ${n(prods)}</span>` : '',
  ].filter(Boolean).join(' ');
  return `<div class="ppl-row ${on ? 'on' : ''}">
    <input type="checkbox" data-act="adm-ppl-sel" data-id="${p.id}" ${on ? 'checked' : ''} aria-label="${esc(t('ppl.pick', { name: p.full_name || '—' }))}">
    <a class="ppl-av" href="#/u/${p.id}">${avatarOf(p as remote.Profile)}</a>
    <span class="adm-row-main"><a href="#/u/${p.id}"><b dir="auto">${esc(p.full_name || '—')}</b></a>
      <span class="muted small">${p.phone ? `<span dir="ltr">${esc(p.phone)}</span>` : ''}${p.club ? ` · <span dir="auto">${esc(p.club)}</span>` : ''}</span>
      <span class="ppl-badges">${badges}</span></span>
    <button class="btn red small ppl-del" data-act="adm-ppl-ask" data-v="one" data-id="${p.id}" ${st.confirm ? 'disabled' : ''}>${icon('trash', 14)} <span>${t('ppl.delete')}</span></button>
  </div>`;
}

function confirmBox(): string {
  const ids = st.confirm!;
  const people = everyone().filter((p) => ids.includes(p.id));
  const f = fallout(people, ids, data!);
  const faces = people.slice(0, 8).map((p) => `<span class="ppl-face">${avatarOf(p as remote.Profile)}<small dir="auto">${esc(p.full_name || '—')}</small></span>`).join('');
  const more = people.length > 8 ? `<span class="badge">+${n(people.length - 8)}</span>` : '';
  const li = (ic: string, text: string) => `<li>${icon(ic, 14)} ${text}</li>`;
  return `<div class="bulk-confirm" role="alertdialog" aria-labelledby="pplQ2">
    <h3 id="pplQ2">${icon('bell', 20)} ${t(people.length === 1 ? 'ppl.sureOne' : 'ppl.sureMany', { n: people.length, name: people[0]?.full_name ?? '' })}</h3>
    <div class="ppl-faces">${faces}${more}</div>
    <ul class="bulk-plan">
      ${li('trash', t('ppl.planAccount'))}
      ${li('trophy', t('ppl.planResults'))}
      ${f.tournaments ? li('trophy', t('ppl.planTournaments', { n: f.tournaments })) : ''}
      ${f.products || f.sellers ? li('shop', t('ppl.planProducts', { n: f.products })) : ''}
      ${f.trainers ? li('coach', t('ppl.planTrainers')) : ''}
      ${f.halls ? li('table', t('ppl.planHalls')) : ''}
    </ul>
    <p class="small">${t('bulk.noUndo')}</p>
    <label class="field"><span>${t('bulk.typeWord', { word: CONFIRM_WORD })}</span><input class="input" id="pplWord" dir="auto" autocomplete="off" data-act="adm-ppl-type" placeholder="${CONFIRM_WORD}"></label>
    <div class="row"><button class="btn red" id="pplGo" data-act="adm-ppl-go" disabled>${st.running ? '<span class="spin"></span>' : icon('trash', 16)} ${t('bulk.confirmBtn', { n: people.length })}</button>
    <button class="btn ghost" data-act="adm-ppl-cancel">${t('bulk.cancel')}</button></div></div>`;
}

/** Redraw only the list, so the search box keeps focus while typing. */
function redrawBody(): void {
  const el = document.getElementById('pplBody');
  if (el) el.innerHTML = body(); else render();
}

export function onInput(el: HTMLInputElement): boolean {
  if (el.dataset.act === 'adm-ppl-q') { st.q = el.value; redrawBody(); return true; }
  if (el.dataset.act === 'adm-ppl-type') {
    const go = document.getElementById('pplGo') as HTMLButtonElement | null;
    if (go) go.disabled = st.running || !confirmed(el.value);
    return true;
  }
  return false;
}

export function onChange(el: HTMLInputElement): boolean {
  if (el.dataset.act === 'adm-ppl-sel') {
    if (el.checked) st.selected.add(el.dataset.id!); else st.selected.delete(el.dataset.id!);
  } else if (el.dataset.act === 'adm-ppl-all') {
    for (const p of shown()) { if (el.checked) st.selected.add(p.id); else st.selected.delete(p.id); }
  } else return false;
  redrawBody();
  return true;
}

export async function onClick(act: string, el: HTMLElement): Promise<boolean> {
  switch (act) {
    case 'adm-ppl-f':
      st.filter = (PEOPLE_FILTERS as string[]).includes(el.dataset.v ?? '') ? el.dataset.v as PeopleFilter : 'all';
      render(); return true;
    case 'adm-ppl-clear':
      st.selected.clear(); redrawBody(); return true;
    case 'adm-ppl-ask': {
      const ids = el.dataset.v === 'one' ? [el.dataset.id!] : [...st.selected].filter((id) => everyone().some((p) => p.id === id));
      if (!ids.length) return true;
      st.confirm = ids;
      redrawBody();
      document.getElementById('pplBody')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.getElementById('pplWord')?.focus({ preventScroll: true });
      return true;
    }
    case 'adm-ppl-cancel':
      st.confirm = null;
      if (location.hash.includes('/del/')) { st.fromProfile = null; location.hash = '#/admin/people'; } else redrawBody();
      return true;
    case 'adm-ppl-go': {
      const word = (document.getElementById('pplWord') as HTMLInputElement | null)?.value ?? '';
      const ids = st.confirm;
      if (!ids?.length || st.running || !confirmed(word)) return true;
      st.running = true;
      (el as HTMLButtonElement).disabled = true;
      try { toast(await deleteAccounts(ids)); } catch (e) { toast(errorText(e)); }
      st.running = false; st.confirm = null;
      for (const id of ids) st.selected.delete(id);
      forgetSim();
      await after().catch(() => undefined);
      if (st.fromProfile && location.hash.includes('/del/')) location.hash = '#/admin/people';
      st.fromProfile = null;
      render();
      return true;
    }
  }
  return false;
}

async function deleteAccounts(ids: string[]): Promise<string> {
  let deleted = 0;
  const failed: { id: string; error: string }[] = [];
  // Small calls: each finishes quickly, and a problem stops after what was already done.
  for (const part of content.chunks(ids, 10)) {
    const r = await remote.deleteAccounts(part);
    deleted += r.deleted;
    failed.push(...(r.failed ?? []));
  }
  if (failed.length) {
    console.warn('Pingo: accounts not deleted', failed);
    toast(t('bulk.someFailed', { n: failed.length, why: failed[0].error }));
  }
  return t('ppl.done', { n: deleted });
}

function errorText(e: unknown): string {
  const code = remote.errorCode(e);
  if (code === 'noFunction') return t('users.functionMissing');
  if (code !== 'unknown') return authErr(e);
  const why = e instanceof Error ? e.message : String(e);
  return /non-2xx|unknown action/i.test(why) ? t('bulk.oldFunction') : t('bulk.failedWhy', { why });
}
