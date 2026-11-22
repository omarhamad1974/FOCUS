/**
 * Tournament invitations. The organizer of a tournament (or an admin, for any
 * tournament) searches registered users and invites them; the invited player
 * sees the invitation on the home page, their page and the tournament page,
 * and accepts (enters the tournament, already approved) or declines.
 * The organizer's tool also simulates it with the 40 demo players.
 */
import { dateFmt, t, type MessageKey } from '../i18n/ar';
import { db } from '../data/remote';
import * as content from '../data/content';
import { authErr, n, render, session } from '../app/ctx';
import { host } from '../admin/host';
import { simPlayers, simPlayersNow } from '../admin/api';
import { icon } from '../ui/icons';
import { avatar, avatarOf, confetti, esc, toast } from '../ui/util';
import type { Tournament } from '../domain/types';
import * as lists from './playerLists';

export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface Invitation {
  id: string;
  tournament_id: string;
  player_id: string;
  invited_by: string | null;
  status: InviteStatus;
  created_at: string;
  answered_at: string | null;
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/* ------------------------------------------------------------------ data */

let mine: Invitation[] | null = null;
let mineLoading = false;
const byT = new Map<string, Invitation[]>();
const tLoading = new Set<string>();
/** Set when the database has no invitations yet (migration 0013 not run). */
let missing = false;
let busy = false;

export function reset(): void { mine = null; byT.clear(); hits = []; picked.clear(); }

function isMissing(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /invitations|invite_players|answer_invitation|schema cache|does not exist/i.test(m);
}

function loadMine(): void {
  if (mineLoading || mine || !session.profile) return;
  mineLoading = true;
  db().from('invitations').select('*').eq('player_id', session.profile.id).eq('status', 'pending').order('created_at', { ascending: false })
    .then(async (res) => {
      if (res.error) { missing = isMissing(res.error); mine = []; return; }
      mine = res.data as Invitation[];
      const orgs = mine.map((i) => host.tournaments().find((x) => x.id === i.tournament_id)?.organizerId ?? i.invited_by ?? '');
      await content.people(orgs.filter(Boolean)).catch(() => undefined);
    })
    .then(() => { mineLoading = false; render(); }, () => { mineLoading = false; mine = []; });
}

function loadFor(tid: string, force = false): void {
  if (tLoading.has(tid) || (byT.has(tid) && !force)) return;
  tLoading.add(tid);
  db().from('invitations').select('*').eq('tournament_id', tid).order('created_at', { ascending: false })
    .then(async (res) => {
      if (res.error) { missing = isMissing(res.error); byT.set(tid, []); return; }
      const rows = res.data as Invitation[];
      byT.set(tid, rows);
      await content.people(rows.map((r) => r.player_id)).catch(() => undefined);
    })
    .then(() => { tLoading.delete(tid); render(); }, () => { tLoading.delete(tid); byT.set(tid, []); render(); });
}

/** Pending invitations of the signed-in player (loads them on first use). */
export function myPending(): Invitation[] {
  if (!session.profile) return [];
  loadMine();
  return (mine ?? []).filter((i) => i.status === 'pending' && tourOf(i)?.stage === 'setup');
}

export const pendingFor = (tid: string) => myPending().find((i) => i.tournament_id === tid);

const tourOf = (i: Invitation): Tournament | undefined => host.tournaments().find((x) => x.id === i.tournament_id);

/* --------------------------------------------------------- player's side */

function inviteRow(i: Invitation, showName: boolean): string {
  const tm = tourOf(i);
  const orgId = tm?.organizerId ?? i.invited_by ?? '';
  const org = content.person(orgId);
  return `<div class="inv-row rise">
    <span class="inv-art">${tm?.cover ? `<img src="${esc(tm.cover)}" alt="">` : '🏓'}</span>
    <span class="inv-text">
      ${showName ? `<a href="#/t/${esc(i.tournament_id)}"><b dir="auto">${esc(tm?.name ?? '…')}</b></a>` : `<b>${t('inv.youAreInvited')}</b>`}
      <small>${org ? `${avatarOf(org)} ${t('inv.from')} <a href="#/u/${esc(org.id)}" dir="auto">${esc(org.full_name)}</a>` : ''}
        ${tm?.date ? ` · ${icon('calendar', 13)} ${dateFmt.format(new Date(tm.date))}` : ''}${tm?.location ? ` · ${icon('pin', 13)} <span dir="auto">${esc(tm.location)}</span>` : ''}</small>
    </span>
    <span class="inv-acts">
      <button class="btn green small" data-act="inv-yes" data-id="${i.id}" ${busy ? 'disabled' : ''}>${icon('check', 14)} ${t('inv.accept')}</button>
      <button class="btn ghost small" data-act="inv-no" data-id="${i.id}" ${busy ? 'disabled' : ''}>${t('inv.decline')}</button>
    </span>
  </div>`;
}

/** Banner with the player's open invitations (home page and the player's page). Empty when none. */
export function banner(): string {
  const list = myPending();
  if (!list.length) return '';
  return `<section class="card inv-banner">
    <h2>📨 ${t(list.length === 1 ? 'inv.titleOne' : 'inv.titleMany', { n: n(list.length) })}</h2>
    <p class="small muted">${t('inv.playerHint')}</p>
    ${list.map((i) => inviteRow(i, true)).join('')}
  </section>`;
}

/** On a tournament's page: the invitation to this tournament, if the player has one. */
export function forTournament(tid: string): string {
  const i = pendingFor(tid);
  return i ? `<div class="inv-banner inv-one">${inviteRow(i, false)}<p class="small muted">${t('inv.playerHint')}</p></div>` : '';
}

/* ------------------------------------------------------ organizer's side */

let hits: content.PublicProfile[] = [];
let query = '';
const picked = new Map<string, content.PublicProfile>();
let timer = 0;
let simCount = 8;
/** Accounts already registered in the tournament shown in the card (not offered again). */
let insideNow = new Set<string>();
/** Called after demo players accepted, so the organizer's registration list reloads. */
let regsChanged: (tid: string) => void = () => undefined;
export function setRegsChanged(fn: (tid: string) => void): void { regsChanged = fn; }

const STATUS_BADGE: Record<InviteStatus, string> = { pending: 'gold', accepted: 'green', declined: 'red', cancelled: '' };

/**
 * Invitation card for the organizer (desk control room, step 1). `inside` are the
 * accounts already registered (pending or approved), so they are not offered again.
 */
export function orgCard(tm: Tournament, inside: Set<string>): string {
  loadFor(tm.id);
  lists.ensure();
  insideNow = inside;
  if (missing) return `<div class="card"><h2>📨 ${t('inv.orgTitle')}</h2><p class="err">${t('inv.needSql')}</p></div>`;
  const rows = byT.get(tm.id);
  const live = (rows ?? []).filter((r) => r.status !== 'cancelled');
  const invited = new Set(live.filter((r) => r.status === 'pending' || r.status === 'accepted').map((r) => r.player_id));
  const skip = (id: string) => inside.has(id) || invited.has(id);
  const shown = hits.filter((p) => !skip(p.id));
  const sims = simPlayersNow() ?? [];
  const freeSims = sims.filter((p) => !skip(p.id)).length;
  const pendingSims = live.filter((r) => r.status === 'pending' && sims.some((s) => s.id === r.player_id)).length;
  const counts = (s: InviteStatus) => live.filter((r) => r.status === s).length;
  const result = (p: content.PublicProfile) => {
    const on = picked.has(p.id);
    const banned = lists.blockedFor(tm, p.id);
    if (banned) {
      return `<span class="inv-hit off" title="${esc(t(banned === 'site' ? 'pl.blockedSite' : 'pl.blocked'))}">
      ${avatarOf(p)}<span class="inv-who"><b dir="auto">${esc(p.full_name)}</b>${p.club ? `<small class="muted" dir="auto">${esc(p.club)}</small>` : ''}</span>
      <span class="badge red">🚫 ${t(banned === 'site' ? 'pl.blockedSite' : 'inv.blockedBadge')}</span></span>`;
    }
    return `<button class="inv-hit ${on ? 'on' : ''}" data-act="inv-pick" data-id="${p.id}" aria-pressed="${on}">
      ${avatarOf(p)}<span class="inv-who"><b dir="auto">${esc(p.full_name)}</b>${p.club ? `<small class="muted" dir="auto">${esc(p.club)}</small>` : ''}</span>
      <span class="badge ${on ? 'green' : 'blue'}">${on ? `${icon('check', 12)} ${t('inv.picked')}` : `${icon('plus', 12)} ${t('inv.pick')}`}</span></button>`;
  };
  return `<div class="card inv-card" data-tid="${esc(tm.id)}">
    <div class="row between"><h2>📨 ${t('inv.orgTitle')}</h2>
      ${live.length ? `<span class="row" style="gap:4px">${(['pending', 'accepted', 'declined'] as InviteStatus[]).map((s) => counts(s) ? `<span class="badge ${STATUS_BADGE[s]}">${n(counts(s))} ${t(`inv.st.${s}` as MessageKey)}</span>` : '').join('')}</span>` : ''}</div>
    <p class="hint">${esc(t('inv.orgHint'))}</p>
    ${favStrip(tm, skip)}
    <input class="input" id="invQ" data-act="inv-q" data-tid="${esc(tm.id)}" value="${esc(query)}" placeholder="${esc(t('inv.searchPh'))}" dir="auto" autocomplete="off">
    <div id="invRes" class="inv-hits">${query.length >= 2 && !shown.length ? `<p class="small muted">${t('inv.noHits')}</p>` : shown.map(result).join('')}</div>
    ${picked.size ? `<div class="inv-picked">${[...picked.values()].map((p) => `<span class="chip ro">${avatarOf(p)}<span dir="auto">${esc(p.full_name.split(' ')[0])}</span>
        <button class="btn ghost small" data-act="inv-pick" data-id="${p.id}" aria-label="${esc(t('inv.unpick'))}">${icon('x', 12)}</button></span>`).join('')}</div>
      <div class="inv-go"><button class="btn green" data-act="inv-send" data-tid="${esc(tm.id)}" ${busy ? 'disabled' : ''}>📨 ${t('inv.send', { n: n(picked.size) })}</button>
      <button class="btn gold" data-act="inv-add" data-tid="${esc(tm.id)}" title="${esc(t('inv.addNowTip'))}" ${busy || tm.registration?.open === false ? 'disabled' : ''}>➕ ${t('inv.addNow', { n: n(picked.size) })}</button></div>
      <p class="small muted">${t('inv.addNowTip')}</p>` : ''}
    <div class="inv-sim">
      <span class="badge gold">${t('desk.sim.badge')}</span>
      <div class="choice sim-counts">${[4, 8, 16].map((c) => `<button data-act="inv-sim-count" data-v="${c}" aria-pressed="${simCount === c}">${n(c)}</button>`).join('')}</div>
      <button class="btn soft small" data-act="inv-sim-send" data-tid="${esc(tm.id)}" ${busy || !freeSims ? 'disabled' : ''}>🎲 ${t('inv.simSend', { n: n(Math.min(simCount, freeSims)) })}</button>
      <button class="btn soft small" data-act="inv-sim-answer" data-tid="${esc(tm.id)}" ${busy || !pendingSims ? 'disabled' : ''}>📬 ${t('inv.simAnswer', { n: n(pendingSims) })}</button>
    </div>
    ${rows === undefined ? `<p class="muted small"><span class="spin"></span> ${t('reg.loading')}</p>` : live.length ? `<h3 class="dk-sub">${t('inv.sent')}</h3><div class="inv-sent">${live.map((r) => {
      const p = content.person(r.player_id);
      return `<span class="inv-face ${r.status}" title="${esc(p?.full_name ?? '')}">${avatar(p?.full_name ?? '?', p?.avatar_url, p?.gender)}
        <small dir="auto">${esc((p?.full_name ?? '…').split(' ')[0])}</small><i class="badge ${STATUS_BADGE[r.status]}">${t(`inv.st.${r.status}` as MessageKey)}</i>
        ${r.status === 'pending' ? `<button class="inv-x" data-act="inv-cancel" data-id="${r.id}" data-tid="${esc(tm.id)}" title="${esc(t('inv.cancel'))}" aria-label="${esc(t('inv.cancel'))}">${icon('x', 12)}</button>` : ''}</span>`;
    }).join('')}</div>` : ''}
  </div>`;
}

/** Favourite players as photos to pick in one tap (those already in, invited or blocked are left out). */
function favStrip(tm: Tournament, skip: (id: string) => boolean): string {
  const all = lists.favourites();
  const free = all.filter((id) => !skip(id) && !lists.blockedFor(tm, id));
  const allOn = free.length > 0 && free.every((id) => picked.has(id));
  return `<div class="inv-favs">
    <div class="row between"><h3 class="dk-sub">⭐ ${t('inv.favTitle')} <small class="muted">${n(free.length)}</small></h3>
      <span class="row" style="gap:6px">${free.length > 1 ? `<button class="btn soft small" data-act="inv-pick-favs" aria-pressed="${allOn}">${allOn ? t('desk.sim.clearPick') : t('inv.favAll', { n: n(free.length) })}</button>` : ''}
      <a class="btn ghost small" href="#/desk/org/players">${t('inv.favManage')}</a></span></div>
    ${free.length ? `<p class="small muted">${t('inv.favHint')}</p><div class="pick-grid inv-fav-grid">${free.map((id) => {
      const p = content.person(id);
      const on = picked.has(id);
      return `<button class="pick ${on ? 'on' : ''}" data-act="inv-pick" data-id="${id}" aria-pressed="${on}" title="${esc(p?.full_name ?? '')}">
        ${avatarOf(p)}<span dir="auto">${esc((p?.full_name ?? '…').split(' ')[0])}</span>${on ? `<i class="pick-ok">${icon('check', 14)}</i>` : ''}<i class="fav-star">⭐</i></button>`;
    }).join('')}</div>` : `<p class="small muted">${all.length ? t('inv.favNone') : t('pl.favEmpty')}</p>`}
  </div>`;
}

function redrawHits(tid: string): void {
  // Redraw the whole page so picked chips and the send button update too, then keep typing.
  const at = (document.getElementById('invQ') as HTMLInputElement | null)?.selectionStart ?? null;
  render();
  const box = document.getElementById('invQ') as HTMLInputElement | null;
  if (box && document.querySelector(`.inv-card[data-tid="${CSS.escape(tid)}"]`)) {
    box.focus();
    if (at !== null) box.setSelectionRange(at, at);
  }
}

export function onInput(el: HTMLElement): boolean {
  if (el.dataset.act !== 'inv-q') return false;
  query = (el as HTMLInputElement).value.trim();
  const tid = el.dataset.tid ?? '';
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    (query.length < 2 ? Promise.resolve([]) : content.searchPeople(query, 12))
      .then((r) => { hits = r; redrawHits(tid); })
      .catch(() => undefined);
  }, 250);
  return true;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  return check(await db().rpc(fn, args)) as T;
}

export async function onClick(act: string, el: HTMLElement): Promise<boolean> {
  if (!act.startsWith('inv-')) return false;
  const id = el.dataset.id ?? '';
  const tid = el.dataset.tid ?? '';
  try {
    switch (act) {
      case 'inv-yes': case 'inv-no': {
        busy = true; render();
        const inv = (mine ?? []).find((x) => x.id === id);
        await rpc('answer_invitation', { i: id, accept: act === 'inv-yes' });
        mine = null;
        if (act === 'inv-yes') {
          confetti();
          toast(`✅ ${t('reg.joinedApproved')}`);
          await host.refresh();
          if (inv) location.hash = `#/t/${inv.tournament_id}`;
        } else toast(t('inv.declined'));
        break;
      }
      case 'inv-pick': {
        const p = hits.find((x) => x.id === id) ?? picked.get(id) ?? content.person(id);
        if (picked.has(id)) picked.delete(id); else if (p) picked.set(id, p);
        render();
        return true;
      }
      case 'inv-send': {
        if (!picked.size) return true;
        busy = true; render();
        const sent = await rpc<number>('invite_players', { t: tid, accounts: [...picked.keys()] });
        toast(`📨 ${t('inv.sentToast', { n: n(sent) })}`);
        picked.clear(); hits = []; query = '';
        loadFor(tid, true);
        break;
      }
      case 'inv-pick-favs': {
        const tm = host.tournaments().find((x) => x.id === (el.closest<HTMLElement>('.inv-card')?.dataset.tid ?? ''));
        const rows = byT.get(tm?.id ?? '') ?? [];
        const invited = new Set(rows.filter((r) => r.status === 'pending' || r.status === 'accepted').map((r) => r.player_id));
        const free = lists.favourites().filter((x) => !insideNow.has(x) && !invited.has(x) && !lists.blockedFor(tm ?? null, x));
        const allOn = free.every((x) => picked.has(x));
        for (const x of free) {
          const p = content.person(x);
          if (allOn) picked.delete(x); else if (p) picked.set(x, p);
        }
        render();
        return true;
      }
      case 'inv-add': {
        if (!picked.size) return true;
        busy = true; render();
        const added = await rpc<number>('org_add_players', { t: tid, accounts: [...picked.keys()] });
        toast(t('inv.addedToast', { n: n(added) }));
        if (added) confetti();
        picked.clear(); hits = []; query = '';
        loadFor(tid, true);
        regsChanged(tid);
        break;
      }
      case 'inv-cancel':
        busy = true; render();
        await rpc('cancel_invitation', { i: id });
        loadFor(tid, true);
        break;
      case 'inv-sim-count':
        simCount = Number(el.dataset.v) || 8;
        render();
        return true;
      case 'inv-sim-send': {
        busy = true; render();
        const all = await simPlayers();
        const rows = byT.get(tid) ?? [];
        const taken = new Set(rows.filter((r) => r.status === 'pending' || r.status === 'accepted').map((r) => r.player_id));
        const pool = all.filter((p) => !taken.has(p.id) && !insideNow.has(p.id)).sort(() => Math.random() - 0.5).slice(0, simCount);
        const sent = await rpc<number>('invite_players', { t: tid, accounts: pool.map((p) => p.id) });
        toast(`📨 ${t('inv.sentToast', { n: n(sent) })}`);
        loadFor(tid, true);
        break;
      }
      case 'inv-sim-answer': {
        busy = true; render();
        const yes = await rpc<number>('sim_answer_invitations', { t: tid });
        toast(`📬 ${t('inv.simAnswered', { n: n(yes) })}`);
        loadFor(tid, true);
        if (yes) regsChanged(tid);
        break;
      }
      default:
        return false;
    }
  } catch (e) {
    if (isMissing(e)) { missing = true; toast(t('inv.needSql')); } else toast(authErr(e));
  }
  busy = false;
  render();
  return true;
}
