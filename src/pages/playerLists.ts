/**
 * Player lists: an organizer's favourite players and blacklist, and the admin's
 * site-wide blacklist (migration 0016).
 * - Favourites: picked in one tap in the invitation card of a new tournament.
 * - Organizer's blacklist: the player cannot join, be invited to or be added to
 *   that organizer's tournaments (enforced by the database); other organizers are not affected.
 * - Admin's blacklist: the player cannot join any tournament.
 * Pages: #/desk/org/players (organizer) and #/desk/admin/blacklist (admin).
 */
import { dateFmt, t } from '../i18n/ar';
import { db } from '../data/remote';
import * as content from '../data/content';
import { authErr, isAdmin, n, render, session } from '../app/ctx';
import { host } from '../admin/host';
import { accountOf } from '../domain/tournament';
import type { Tournament } from '../domain/types';
import { icon } from '../ui/icons';
import { avatarOf, esc, toast } from '../ui/util';

interface BlockRow {
  id: string;
  owner_id: string | null;
  player_id: string;
  reason: string | null;
  created_at: string;
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/* ------------------------------------------------------------------ data */

let favs: Set<string> | null = null;
/** Every blacklist row the signed-in organizer may read: their own and the site-wide one (admin: all). */
let blocks: BlockRow[] | null = null;
let loading = false;
let missing = false;
/** Player side: organizers whose tournaments the signed-in player cannot join (null = all). */
let myBlocks: (string | null)[] | null = null;
let myLoading = false;
/** Accounts seen in the organizer's tournaments (suggestions). */
let mineSeen: string[] | null = null;

let tab: 'fav' | 'block' | 'site' = 'fav';
let query = '';
let hits: content.PublicProfile[] = [];
let timer = 0;
let confirming: string | null = null;
let busy = false;
/** The confirm box is drawn once per page, under the first line of that player. */
let confirmDrawn = false;

export function reset(): void {
  favs = null; blocks = null; myBlocks = null; mineSeen = null;
  hits = []; query = ''; confirming = null;
}

const me = () => session.profile?.id ?? '';
const isMissing = (e: unknown) => /blacklist|favourite_players|my_blocks|org_add_players|schema cache|does not exist/i.test(e instanceof Error ? e.message : String(e));

/** Load the organizer's favourites and the blacklists they may see (once). */
export function ensure(): void {
  if (loading || (favs && blocks) || !session.profile) return;
  loading = true;
  Promise.all([
    db().from('favourite_players').select('player_id').eq('owner_id', me()),
    db().from('blacklist').select('*').order('created_at', { ascending: false }),
  ]).then(async ([f, b]) => {
    if (f.error || b.error) {
      missing = isMissing(f.error?.message ?? b.error?.message);
      favs = new Set(); blocks = [];
      return;
    }
    favs = new Set((f.data as { player_id: string }[]).map((r) => r.player_id));
    blocks = b.data as BlockRow[];
    await content.people([...favs, ...blocks.map((r) => r.player_id)]).catch(() => undefined);
  }).catch(() => { favs = new Set(); blocks = []; })
    .finally(() => { loading = false; render(); });
}

export const isFav = (id: string) => !!favs?.has(id);
export const favourites = (): string[] => [...(favs ?? [])];
const ownList = () => (blocks ?? []).filter((r) => r.owner_id === me());
const siteList = () => (blocks ?? []).filter((r) => r.owner_id === null);
const ownBlock = (id: string) => ownList().find((r) => r.player_id === id);
const siteBlock = (id: string) => siteList().find((r) => r.player_id === id);

/** Organizer side: is this account blocked from the tournament (by its organizer or the admin)? */
export function blockedFor(tm: Tournament | null, id: string): 'site' | 'own' | null {
  if (siteBlock(id)) return 'site';
  const owner = tm?.organizerId ?? me();
  return (blocks ?? []).some((r) => r.owner_id === owner && r.player_id === id) ? 'own' : null;
}

/** Player side: can the signed-in player join this tournament? null = yes; otherwise why not. */
export function playerBlocked(tm: Tournament): 'site' | 'own' | null {
  if (!session.profile) return null;
  if (!myBlocks && !myLoading) {
    myLoading = true;
    db().rpc('my_blocks').then((res) => {
      myBlocks = res.error ? [] : (res.data as { owner_id: string | null }[]).map((r) => r.owner_id);
      myLoading = false;
      if (myBlocks.length) render();
    }, () => { myBlocks = []; myLoading = false; });
  }
  if (!myBlocks?.length) return null;
  if (myBlocks.includes(null)) return 'site';
  return tm.organizerId && myBlocks.includes(tm.organizerId) ? 'own' : null;
}

/** The notice shown instead of the join button. */
export function blockedNotice(why: 'site' | 'own', small = false): string {
  if (small) return `<span class="badge red" title="${esc(t(why === 'site' ? 'pl.youBlockedSite' : 'pl.youBlocked'))}">🚫 ${t('pl.cantJoin')}</span>`;
  return `<div class="err">🚫 ${t(why === 'site' ? 'pl.youBlockedSite' : 'pl.youBlocked')}</div>`;
}

function loadSeen(): void {
  if (mineSeen) return;
  mineSeen = [];
  const mine = host.tournaments().filter((x) => x.organizerId === me());
  const fromState = mine.flatMap((x) => x.players.map(accountOf)).filter((x): x is string => !!x);
  const ids = mine.map((x) => x.id);
  (ids.length ? db().from('registrations').select('player_id, created_at').in('tournament_id', ids).order('created_at', { ascending: false }).limit(300)
    : Promise.resolve({ data: [], error: null }))
    .then(async (res) => {
      const fromRegs = res.error ? [] : (res.data as { player_id: string }[]).map((r) => r.player_id);
      mineSeen = [...new Set([...fromRegs, ...fromState])].filter((x) => x !== me()).slice(0, 60);
      await content.people(mineSeen).catch(() => undefined);
      render();
    }, () => undefined);
}

/* ---------------------------------------------------------------- pieces */

const nameOf = (id: string) => content.person(id)?.full_name ?? '…';

function favBtn(id: string): string {
  const on = isFav(id);
  return `<button class="btn small ${on ? 'gold' : 'soft'} pl-star" data-act="pl-fav" data-id="${id}" aria-pressed="${on}" title="${esc(t(on ? 'pl.favRemove' : 'pl.favAdd'))}" aria-label="${esc(t(on ? 'pl.favRemove' : 'pl.favAdd'))}">${on ? '⭐' : '☆'}</button>`;
}

function blockBtn(id: string, site: boolean): string {
  const on = site ? !!siteBlock(id) : !!ownBlock(id);
  return on
    ? `<button class="btn small ghost" data-act="pl-unblock" data-id="${id}" data-site="${site ? 1 : ''}">${icon('check', 14)} ${t('pl.unblock')}</button>`
    : `<button class="btn small soft pl-ban" data-act="pl-block" data-id="${id}" data-site="${site ? 1 : ''}" title="${esc(t('pl.blockTip'))}">🚫 ${t('pl.block')}</button>`;
}

function row(id: string, site: boolean, extra = ''): string {
  const p = content.person(id);
  const sb = siteBlock(id);
  const ob = ownBlock(id);
  const tags = [
    !site && isFav(id) ? `<span class="badge gold">⭐ ${t('pl.fav')}</span>` : '',
    !site && ob ? `<span class="badge red">🚫 ${t('pl.blocked')}</span>` : '',
    sb && !site ? `<span class="badge red">🛡️ ${t('pl.blockedSite')}</span>` : '',
  ].join('');
  const actions = site ? blockBtn(id, true) : sb ? '' : `${ob ? '' : favBtn(id)}${blockBtn(id, false)}`;
  return `<div class="dk-line pl-row ${ob || (site && sb) ? 'off' : ''}">${avatarOf(p, nameOf(id))}
    <span class="dk-who"><a href="#/u/${esc(id)}"><b dir="auto">${esc(nameOf(id))}</b></a>
      <small class="muted" dir="auto">${p?.club ? esc(p.club) : ''}${extra}</small>${tags ? `<span class="pl-tags">${tags}</span>` : ''}</span>
    <span class="dk-end">${actions}</span></div>
    ${confirming === id && !confirmDrawn ? ((confirmDrawn = true), confirmBox(id, site)) : ''}`;
}

function confirmBox(id: string, site: boolean): string {
  return `<div class="pl-confirm rise">
    <b>🚫 ${esc(t('pl.confirmTitle', { name: nameOf(id) }))}</b>
    <p class="small">${t(site ? 'pl.confirmSite' : 'pl.confirmOrg')}</p>
    <input class="input" id="plReason" maxlength="200" dir="auto" placeholder="${esc(t(site ? 'pl.reasonPhSite' : 'pl.reasonPh'))}">
    <div class="row"><button class="btn red small" data-act="pl-block-yes" data-id="${id}" data-site="${site ? 1 : ''}" ${busy ? 'disabled' : ''}>🚫 ${t('pl.doBlock')}</button>
      <button class="btn ghost small" data-act="pl-block-no">${t('pl.cancel')}</button></div>
  </div>`;
}

const since = (r: BlockRow) => ` · ${t('pl.since', { date: dateFmt.format(new Date(r.created_at)) })}${r.reason ? ` · ${t('pl.reason')}: <span dir="auto">${esc(r.reason)}</span>` : ''}`;

function searchBox(site: boolean): string {
  const shown = hits.filter((p) => p.id !== me());
  return `<div class="card pl-search">
    <label class="pl-q">${icon('search', 18)}<input class="input" id="plQ" data-act="pl-q" value="${esc(query)}" placeholder="${esc(t('pl.searchPh'))}" dir="auto" autocomplete="off"></label>
    ${query.length >= 2 ? (shown.length ? `<div class="pl-list">${shown.map((p) => row(p.id, site)).join('')}</div>` : `<p class="small muted">${t('pl.noHits')}</p>`) : ''}
  </div>`;
}

/* ------------------------------------------------------------------ pages */

/** Organizer: #/desk/org/players. */
export function orgPage(): string {
  confirmDrawn = false;
  ensure();
  loadSeen();
  const head = `<a class="backlink" href="#/desk/org">${icon('back', 18)} ${t('desk.org.all')}</a>
  <section class="banner b-org slim"><div><h1>⭐ ${t('pl.title')}</h1><p>${t('pl.hint')}</p></div></section>`;
  if (missing) return `${head}<div class="card"><p class="err">${t('pl.needSql')}</p></div>`;
  if (!favs || !blocks) return `${head}<div class="card center muted"><span class="spin"></span> ${t('reg.loading')}</div>`;
  const own = ownList();
  const site = siteList();
  const tabs: [typeof tab, string, number][] = [['fav', `⭐ ${t('pl.tab.fav')}`, favs.size], ['block', `🚫 ${t('pl.tab.block')}`, own.length]];
  if (site.length) tabs.push(['site', `🛡️ ${t('pl.tab.site')}`, site.length]);
  if (tab === 'site' && !site.length) tab = 'fav';
  let list = '';
  if (tab === 'fav') {
    list = favs.size ? [...favs].map((id) => row(id, false)).join('') : `<p class="muted">${t('pl.favEmpty')}</p>`;
  } else if (tab === 'block') {
    list = own.length ? own.map((r) => row(r.player_id, false, since(r))).join('') : `<p class="muted">${t('pl.blockEmpty')}</p>`;
  } else {
    list = `<p class="hint">${t('pl.siteHintOrg')}</p>${site.map((r) => row(r.player_id, false)).join('')}`;
  }
  const seen = (mineSeen ?? []).filter((id) => !favs!.has(id) && !ownBlock(id) && !siteBlock(id));
  return `${head}
  <div class="choice pl-tabs" role="tablist">${tabs.map(([k, label, c]) => `<button data-act="pl-tab" data-v="${k}" aria-pressed="${tab === k}">${label} <b>${n(c)}</b></button>`).join('')}</div>
  ${searchBox(false)}
  <div class="card"><div class="pl-list">${list}</div></div>
  ${tab === 'fav' && seen.length ? `<div class="card"><h2>👥 ${t('pl.fromMine')}</h2><p class="hint">${t('pl.fromMineHint')}</p>
    <div class="pl-list">${seen.map((id) => row(id, false)).join('')}</div></div>` : ''}`;
}

/** Admin: #/desk/admin/blacklist (site-wide). */
export function adminPage(): string {
  confirmDrawn = false;
  ensure();
  const head = `<a class="backlink" href="#/desk/admin">${icon('back', 18)} ${t('desk.back')}</a>
  <section class="banner b-admin slim"><div><h1>🛡️ ${t('pl.siteTitle')}</h1><p>${t('pl.siteHint')}</p></div></section>`;
  if (!isAdmin()) return head;
  if (missing) return `${head}<div class="card"><p class="err">${t('pl.needSql')}</p></div>`;
  if (!blocks) return `${head}<div class="card center muted"><span class="spin"></span> ${t('reg.loading')}</div>`;
  const site = siteList();
  return `${head}
  ${searchBox(true)}
  <div class="card"><div class="row between"><h2>🚫 ${t('pl.siteTitle')}</h2><span class="badge red">${n(site.length)}</span></div>
    <div class="pl-list">${site.length ? site.map((r) => row(r.player_id, true, since(r))).join('') : `<p class="muted">${t('pl.siteEmpty')}</p>`}</div></div>`;
}

/* ---------------------------------------------------------------- events */

export function onInput(el: HTMLElement): boolean {
  if (el.dataset.act !== 'pl-q') return false;
  query = (el as HTMLInputElement).value.trim();
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    (query.length < 2 ? Promise.resolve([]) : content.searchPeople(query, 12))
      .then((r) => {
        hits = r;
        const at = (document.getElementById('plQ') as HTMLInputElement | null)?.selectionStart ?? null;
        render();
        const box = document.getElementById('plQ') as HTMLInputElement | null;
        if (box) { box.focus(); if (at !== null) box.setSelectionRange(at, at); }
      })
      .catch(() => undefined);
  }, 250);
  return true;
}

/** Start blocking from elsewhere (registration list): open the players page with the confirm box. */
export function askBlock(id: string): void {
  confirming = id;
  tab = 'block';
  if (!location.hash.startsWith('#/desk/org/players')) location.hash = '#/desk/org/players';
  else render();
}

export async function toggleFav(id: string): Promise<void> {
  if (!favs) return;
  const name = nameOf(id);
  if (favs.has(id)) {
    check(await db().from('favourite_players').delete().eq('owner_id', me()).eq('player_id', id));
    favs.delete(id);
    toast(t('pl.favRemoved', { name }));
  } else {
    check(await db().from('favourite_players').insert({ owner_id: me(), player_id: id }));
    favs.add(id);
    toast(t('pl.favAdded', { name }));
  }
}

export async function onClick(act: string, el: HTMLElement): Promise<boolean> {
  if (!act.startsWith('pl-')) return false;
  const id = el.dataset.id ?? '';
  const site = !!el.dataset.site;
  try {
    switch (act) {
      case 'pl-tab':
        tab = (el.dataset.v as typeof tab) ?? 'fav';
        break;
      case 'pl-fav':
        busy = true; render();
        await toggleFav(id);
        break;
      case 'pl-block':
        confirming = id;
        break;
      case 'pl-block-no':
        confirming = null;
        break;
      case 'pl-block-yes': {
        busy = true; render();
        const reason = (document.getElementById('plReason') as HTMLInputElement | null)?.value.trim() || null;
        const out = check(await db().rpc('blacklist_add', { p: id, reason, site })) as number;
        confirming = null;
        blocks = null; favs = null;
        toast(out ? t('pl.blockedOut', { name: nameOf(id), n: n(out) }) : t('pl.blockedToast', { name: nameOf(id) }));
        await host.refresh().catch(() => undefined);
        break;
      }
      case 'pl-unblock':
        busy = true; render();
        check(await db().rpc('blacklist_remove', { p: id, site }));
        blocks = (blocks ?? []).filter((r) => !(r.player_id === id && (site ? r.owner_id === null : r.owner_id === me())));
        toast(t('pl.unblockedToast', { name: nameOf(id) }));
        break;
      default:
        return false;
    }
  } catch (e) {
    if (isMissing(e)) missing = true;
    toast(authErr(e));
  }
  busy = false;
  render();
  return true;
}
