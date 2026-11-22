/**
 * Organizer's tool: only the organizer's own tournaments and the work to run
 * them, apart from the public site. Each tournament has a control room that
 * walks through the whole cycle (registration, payments, groups, knockout,
 * champion), with a built-in simulation: demo players with real accounts join,
 * pay and play until there is a champion.
 */
import { dateFmt, t, type MessageKey } from '../i18n/ar';
import * as remote from '../data/remote';
import * as content from '../data/content';
import { authErr, isAdmin, money, n, render, session, val } from '../app/ctx';
import {
  accountOf, closeRegistration, createTournament, groupStandings, playerName, progress,
  qualifyingRows, registrationOf, reshuffleGroups, startGroups, startKnockout, topTwo,
} from '../domain/tournament';
import { bracketMatches, isBye, placements, roundName } from '../domain/bracket';
import { hasResult, summarize, winnerId } from '../domain/scoring';
import * as sim from '../domain/simulate';
import { feeOf, isPaid, payKey, setFee, setPaid, simulatePayments, totals } from '../domain/payments';
import type { BestOf, Bracket, Match, Tournament } from '../domain/types';
import { championCelebration } from '../ui/champion';
import { cover, empty } from '../ui/art';
import { icon } from '../ui/icons';
import { avatar, confetti, esc, groupColor, toast } from '../ui/util';
import { host } from './host';
import * as api from './api';
import * as invites from '../pages/invites';
import * as pay from '../data/pay';
import * as payUi from '../ui/pay';
import { countChips, ensureSim, payBox, paidTick, personLine, playerGrid, sample, statTile, stepper, tip } from './ui';

/* ------------------------------------------------------------------ state */

const regCache = new Map<string, remote.Registration[]>();
const regLoading = new Set<string>();
let joinCount = 8;
let picking = false;
const picked = new Set<string>();
let busy = false;
let newOpen = false;
const draft = { groups: 4, fee: 200, max: '', auto: true };

export function reset(): void { regCache.clear(); payCache.clear(); picked.clear(); picking = false; }

/* Entry fee payments sent by players (receipts, cash), per tournament; paid ones first. */
const payCache = new Map<string, pay.TournamentPay[]>();
const payLoading = new Set<string>();
payUi.onPayChange(() => payCache.clear());

function loadPays(id: string): void {
  if (payLoading.has(id) || payCache.has(id)) return;
  payLoading.add(id);
  pay.tournamentPayments(id).then((r) => payCache.set(id, r)).catch(() => payCache.set(id, []))
    .finally(() => { payLoading.delete(id); render(); });
}
const payRow = (tm: Tournament, key: string) => payCache.get(tm.id)?.find((r) => r.player_id === key);
/** Paid: ticked in the tournament (by hand) or confirmed on the registration (receipt approved / ticked). */
const paidOf = (tm: Tournament, key: string) => isPaid(tm, key) || !!payRow(tm, key)?.paid;
const proofOf = (tm: Tournament, key: string) => {
  const r = payRow(tm, key);
  return r ? pay.asPayment(r, tm.organizerId ?? '', feeOf(tm)) : null;
};
const feeLinesOf = (tm: Tournament) => payKeys(tm).map((k) => ({ amount: feeOf(tm), paid: paidOf(tm, k) }));
const rank = (tm: Tournament, key: string) => payUi.priority(paidOf(tm, key), proofOf(tm, key));

invites.setRegsChanged((id) => loadRegs(id, true));

function loadRegs(id: string, force = false): void {
  if (regLoading.has(id) || (regCache.has(id) && !force)) return;
  regLoading.add(id);
  remote.tournamentRegistrations(id)
    .then(async (r) => { regCache.set(id, r); await content.people(r.map((x) => x.player_id)).catch(() => undefined); })
    .catch(() => regCache.set(id, []))
    .finally(() => { regLoading.delete(id); render(); });
}

const mine = (): Tournament[] => {
  const me = session.profile?.id;
  return host.tournaments().filter((x) => x.organizerId === me || (isAdmin() && !!x.organizerId) || !x.organizerId);
};
const find = (id: string) => mine().find((x) => x.id === id);

/** Load photos of everyone in a tournament once. */
const photosAsked = new Set<string>();
function loadPhotos(tm: Tournament): void {
  const ids = tm.players.map(accountOf).filter((x): x is string => !!x);
  const key = `${tm.id}:${ids.length}`;
  if (photosAsked.has(key) || !ids.length) return;
  photosAsked.add(key);
  content.people(ids).then(() => render()).catch(() => undefined);
}

const pPhoto = (tm: Tournament, pid: string | null) => {
  const pl = tm.players.find((x) => x.id === pid);
  const acc = pl ? accountOf(pl) : undefined;
  return avatar(playerName(tm, pid), content.photoOf(acc), content.genderOf(acc));
};
const regPhoto = (r: remote.Registration) => avatar(r.full_name ?? '?', content.photoOf(r.player_id), content.genderOf(r.player_id));

/** Which step of the cycle the tournament is in (0 registration … 4 champion). */
export function stepOf(tm: Tournament): number {
  if (tm.stage === 'setup') return registrationOf(tm).open ? 0 : 1;
  if (tm.stage === 'groups') return 2;
  return sim.finished(tm) ? 4 : 3;
}
const STEPS: MessageKey[] = ['desk.org.s.register', 'desk.org.s.groups', 'desk.org.s.play', 'desk.org.s.ko', 'desk.org.s.champion'];

/* ------------------------------------------------------------------ pages */

export function page(parts: string[]): string {
  if (parts[2]) {
    const tm = find(parts[2]);
    return tm ? control(tm) : empty('trophy', t('t.notFound'), `<a class="btn small" href="#/desk/org">${t('desk.back')}</a>`);
  }
  return overview();
}

function overview(): string {
  const list = mine().sort((a, b) => stepOf(a) - stepOf(b) || (b.date || '').localeCompare(a.date || ''));
  list.filter((x) => x.stage === 'setup').forEach((x) => loadRegs(x.id));
  const pending = list.reduce((s, x) => s + (regCache.get(x.id) ?? []).filter((r) => r.status === 'pending').length, 0);
  const left = list.reduce((s, x) => { const p = progress(x); return s + (x.stage === 'setup' ? 0 : Math.max(0, p.total - p.done)); }, 0);
  const money3 = totals(list.flatMap((x) => feeLinesOf(x)));
  return `<section class="banner b-org slim"><div><h1>${icon('trophy', 26)} ${t('desk.org.title')}</h1><p>${t('desk.org.hint')}</p></div>
    <button class="btn gold" data-act="dk-new-open">➕ ${t('desk.org.new')}</button></section>
  <div class="stats dash-stats">
    ${statTile('trophy', n(list.filter((x) => stepOf(x) < 4).length), 'desk.org.statRunning')}
    ${statTile('bell', n(pending), 'desk.org.statPending', pending > 0)}
    ${statTile('ball', n(left), 'desk.org.statLeft')}
    ${statTile('money', money(money3.collected), 'desk.org.statCollected')}
  </div>
  ${newOpen ? newForm() : ''}
  ${list.length ? `<div class="dk-tlist">${list.map(tCard).join('')}</div>`
    : empty('trophy', t('desk.org.none'), `<button class="btn gold small" data-act="dk-new-open">➕ ${t('desk.org.new')}</button>`)}`;
}

function newForm(): string {
  return `<form class="card dk-new rise" data-form="dk-new">
    <div class="row between"><h2>➕ ${t('desk.org.new')}</h2><button type="button" class="btn ghost small" data-act="dk-new-open">✕</button></div>
    ${tip('desk.org.newHint')}
    <div class="dk-form">
      <label class="field"><span>${t('wizard.name')}</span><input class="input" id="dkName" required maxlength="80" placeholder="${esc(t('desk.org.namePh'))}"></label>
      <label class="field"><span>${t('wizard.date')}</span><input class="input" id="dkDate" type="date" value="${new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)}"></label>
      <label class="field"><span>${t('wizard.location')}</span><input class="input" id="dkLoc" maxlength="80" placeholder="${esc(t('desk.org.locPh'))}"></label>
      <label class="field"><span>${t('desk.org.fee')}</span><input class="input" id="dkFee" inputmode="decimal" value="${draft.fee}"></label>
      <label class="field"><span>${t('reg.maxPlayers')}</span><input class="input" id="dkMax" inputmode="numeric" value="${esc(draft.max)}" placeholder="${esc(t('desk.org.maxPh'))}"></label>
    </div>
    <div class="field"><span>${t('wizard.groups')}</span>${countChips('dk-new-groups', [2, 4, 6, 8], draft.groups)}</div>
    <label class="row"><input type="checkbox" id="dkAuto" ${draft.auto ? 'checked' : ''}> ${t('reg.autoAccept')}</label>
    <button class="btn green block" ${busy ? 'disabled' : ''}>🚀 ${t('desk.org.create')}</button>
  </form>`;
}

function tCard(tm: Tournament): string {
  const step = stepOf(tm);
  const regs = regCache.get(tm.id) ?? [];
  const pend = regs.filter((r) => r.status === 'pending').length;
  const p = progress(tm);
  const pay = totals(feeLinesOf(tm));
  const top = step === 4 ? topTwo(tm) : null;
  const count = tm.stage === 'setup' && registrationOf(tm).open ? regs.filter((r) => r.status === 'approved').length : tm.players.length;
  return `<a class="dk-tcard rise" href="#/desk/org/${tm.id}">
    <span class="dk-tcover">${cover(tm.cover ? esc(tm.cover) : null, tm.id, 'trophy', esc(tm.name))}</span>
    <span class="dk-tbody">
      <span class="row between"><b dir="auto">${esc(tm.name)}</b><span class="badge ${step === 4 ? 'gold' : step === 0 ? 'green' : 'blue'}">${t(STEPS[step])}</span></span>
      <small class="muted">${tm.date ? `${icon('calendar', 13)} ${dateFmt.format(new Date(tm.date))} · ` : ''}${icon('users', 13)} ${n(count)} ${t('t.players')}${pend ? ` · <span class="badge red">${n(pend)} ${t('desk.org.pendingShort')}</span>` : ''}</small>
      <span class="dk-mini-steps">${STEPS.map((_, i) => `<i class="${i < step ? 'done' : i === step ? 'now' : ''}"></i>`).join('')}</span>
      ${p.total && step > 1 && step < 4 ? `<small class="muted">${t('dash.matchesDone', { done: n(p.done), total: n(p.total) })}</small>` : ''}
      ${feeOf(tm) ? `<small>${icon('money', 13)} ${money(pay.collected)} / ${money(pay.total)}</small>` : ''}
      ${top ? `<small>🏆 <b dir="auto">${esc(playerName(tm, top.first))}</b></small>` : ''}
    </span></a>`;
}

/* --------------------------------------------------------- control room */

/** Who owes an entry fee: approved registrants while registration is open, then the tournament's players. */
function payKeys(tm: Tournament): string[] {
  if (tm.stage === 'setup' && registrationOf(tm).open) {
    return (regCache.get(tm.id) ?? []).filter((r) => r.status === 'approved').map((r) => r.player_id);
  }
  return tm.players.map(payKey);
}

function control(tm: Tournament): string {
  const step = stepOf(tm);
  loadPhotos(tm);
  if (tm.stage === 'setup') loadRegs(tm.id);
  if (feeOf(tm)) loadPays(tm.id);
  if (step === 0) ensureSim();
  const panels = [registerPanel, groupsPanel, playPanel, koPanel, championPanel];
  return `<a class="backlink" href="#/desk/org">${icon('back', 18)} ${t('desk.org.all')}</a>
  <section class="card dk-thead">
    <div class="row between">
      <div><h1 class="dk-h1" dir="auto">${icon('trophy', 24)} ${esc(tm.name)}</h1>
        <small class="muted">${tm.date ? `${icon('calendar', 14)} ${dateFmt.format(new Date(tm.date))}` : ''}${tm.location ? ` · ${icon('pin', 14)} <span dir="auto">${esc(tm.location)}</span>` : ''}
        · ${t('wizard.groups')}: ${n(tm.groups.length)}</small></div>
      <div class="row">
        <a class="btn soft small" href="#/t/${tm.id}" title="${esc(t('desk.org.publicTip'))}">${icon('eye', 16)} ${t('desk.org.public')}</a>
        <a class="btn soft small" href="#/t/${tm.id}/settings">${icon('edit', 16)} ${t('dash.settings')}</a>
      </div>
    </div>
    ${stepper(STEPS, step)}
  </section>
  ${panels[step](tm)}
  ${paymentsCard(tm)}`;
}

/* Step 1: registration and the join simulation */
function registerPanel(tm: Tournament): string {
  const regs = regCache.get(tm.id);
  if (!regs) return `<div class="card center muted"><span class="spin"></span> ${t('reg.loading')}</div>`;
  const reg = registrationOf(tm);
  const pending = regs.filter((r) => r.status === 'pending');
  const approved = regs.filter((r) => r.status === 'approved');
  const joined = new Set(regs.filter((r) => r.status === 'pending' || r.status === 'approved').map((r) => r.player_id));
  const free = (api.simPlayersNow() ?? []).filter((p) => !joined.has(p.id)).length;
  const need = tm.groups.length * 2;
  return `<div class="card sim-card dk-sim">
    <div class="row between"><h2>🎮 ${t('desk.org.simTitle')}</h2><span class="badge gold">${t('desk.sim.badge')}</span></div>
    ${tip('desk.org.simHint')}
    <div class="row" style="gap:8px">
      ${countChips('dk-join-count', [1, 4, 8, 16, 24, 32], joinCount)}
      <button class="btn green small" data-act="dk-join-random" ${busy || !free ? 'disabled' : ''}>🎲 ${t('desk.org.joinRandom', { n: Math.min(joinCount, free) })}</button>
      <button class="btn soft small" data-act="dk-pick-toggle" aria-pressed="${picking}">🖼️ ${t('desk.sim.pickByPhoto')}</button>
    </div>
    ${picking ? `<div class="dk-picker">${playerGrid(picked, joined)}
      <div class="row"><button class="btn green small" data-act="dk-join-picked" ${busy || !picked.size ? 'disabled' : ''}>✅ ${t('desk.org.joinPicked', { n: picked.size })}</button>
      <button class="btn ghost small" data-act="dk-pick-clear">${t('desk.sim.clearPick')}</button></div></div>` : ''}
  </div>
  ${invites.orgCard(tm, joined)}
  <div class="card">
    <div class="row between"><h2>📝 ${t('reg.title')}</h2><span class="badge ${reg.open ? 'green' : ''}">${reg.open ? t('reg.open') : t('reg.closed')}</span></div>
    <div class="row dk-settings">
      <label class="row"><input type="checkbox" data-act="dk-reg-auto" ${reg.autoAccept ? 'checked' : ''}> ${t('reg.autoAccept')}</label>
      <label class="row">${t('reg.maxPlayers')} <input class="input" id="dkRegMax" data-act="dk-reg-max" inputmode="numeric" value="${reg.maxPlayers ?? ''}" style="width:90px"></label>
    </div>
    ${reg.maxPlayers ? `<div class="xp"><span style="width:${Math.min(100, Math.round((approved.length / reg.maxPlayers) * 100))}%"></span></div>` : ''}
    <h3 class="dk-sub">⏳ ${t('reg.pending')} (${n(pending.length)})
      ${pending.length > 1 ? `<button class="btn green small" data-act="dk-approve-all">${icon('check', 14)} ${t('desk.org.approveAll')}</button>` : ''}</h3>
    ${feeOf(tm) && pending.length ? tip('desk.pay.priorityHint') : ''}
    ${pending.length ? [...pending].sort((a, b) => rank(tm, a.player_id) - rank(tm, b.player_id)).map((r) => personLine(regPhoto(r), r.full_name ?? '',
      `${esc(r.club ?? '')} ${feeOf(tm) ? (paidOf(tm, r.player_id) ? `<span class="badge green">${icon('check', 12)} ${t('desk.pay.paid')}</span>` : payUi.proof(proofOf(tm, r.player_id))) : ''}`, `
      <button class="btn small green" data-act="dk-decide" data-id="${r.id}" data-s="approved">${icon('check', 14)} ${t('dash.accept')}</button>
      <button class="btn small ghost" data-act="dk-decide" data-id="${r.id}" data-s="rejected" title="${esc(t('reg.reject'))}">${icon('x', 14)}</button>`, 'pend')).join('')
      : `<p class="muted small">${t('dash.noWaiting')}</p>`}
    <h3 class="dk-sub">✅ ${t('reg.approved')} (${n(approved.length)}${reg.maxPlayers ? ` / ${n(reg.maxPlayers)}` : ''})</h3>
    ${approved.length ? `<div class="dk-faces">${approved.map((r) => `<span class="dk-face" title="${esc(r.full_name ?? '')}">${regPhoto(r)}<small dir="auto">${esc((r.full_name ?? '').split(' ')[0])}</small></span>`).join('')}</div>`
      : `<p class="muted small">${t('reg.empty')}</p>`}
    <div class="dk-next">
      ${tip('desk.org.closeHint')}
      <button class="btn gold block" data-act="dk-close" ${busy || approved.length < need ? 'disabled' : ''}>🔒 ${t('desk.org.close', { n: approved.length })}</button>
      ${approved.length < need ? `<p class="small muted center">${t('desk.org.needMore', { n: need - approved.length })}</p>` : ''}
    </div>
  </div>`;
}

/* Step 2: groups are drawn; start them */
function groupsPanel(tm: Tournament): string {
  return `<div class="card">
    <h2>🧩 ${t('desk.org.groupsTitle')}</h2>
    ${tip('desk.org.groupsHint')}
    <div class="dk-groups">${tm.groups.map((g, gi) => `<div class="dk-group">
      <h3><span class="gletter" style="background:${groupColor(gi)}">${esc(g.name)}</span> ${t('setup.group')} ${esc(g.name)} <small class="muted">${n(g.playerIds.length)}</small></h3>
      ${g.playerIds.map((pid) => `<div class="dk-gp">${pPhoto(tm, pid)}<span dir="auto">${esc(playerName(tm, pid))}</span></div>`).join('')}</div>`).join('')}</div>
    <div class="row" style="margin-block-start:12px">
      <button class="btn soft small" data-act="dk-reshuffle">🎲 ${t('desk.org.reshuffle')}</button>
      <a class="btn soft small" href="#/t/${tm.id}/groups">✋ ${t('desk.org.byHand')}</a>
      ${tm.registration ? `<button class="btn ghost small" data-act="dk-reopen">🔓 ${t('desk.org.reopen')}</button>` : ''}
    </div>
    <button class="btn green block" style="margin-block-start:12px" data-act="dk-start-groups">▶️ ${t('setup.start')}</button>
  </div>`;
}

function miniStandings(tm: Tournament): string {
  return `<div class="dk-groups">${tm.groups.map((g, gi) => {
    const q = new Map(qualifyingRows(tm, g).map((r) => [r.playerId, r.rank]));
    const s = groupStandings(tm, g);
    return `<div class="dk-group">
      <h3><span class="gletter" style="background:${groupColor(gi)}">${esc(g.name)}</span> ${t('setup.group')} ${esc(g.name)}</h3>
      <table class="dk-table"><thead><tr><th>#</th><th class="name">${t('standings.player')}</th><th>${t('standings.played')}</th><th>${t('standings.won')}</th><th>${t('standings.pts')}</th></tr></thead><tbody>
      ${s.rows.map((r) => {
        const rank = q.get(r.playerId);
        const cls = rank === undefined ? '' : rank <= 2 ? 'q' : rank <= 4 && tm.consolation.enabled ? 'c' : '';
        return `<tr class="${cls}"><td>${n(r.rank)}</td><td class="name"><span class="row" style="gap:6px;flex-wrap:nowrap">${pPhoto(tm, r.playerId)}<span dir="auto">${esc(playerName(tm, r.playerId))}</span></span></td>
          <td>${n(r.played)}</td><td>${n(r.wins)}</td><td><b>${n(r.points)}</b></td></tr>`;
      }).join('')}</tbody></table></div>`;
  }).join('')}</div>
  <p class="small muted">🟩 ${t('desk.org.legendQ')}${tm.consolation.enabled ? ` · 🟨 ${t('desk.org.legendC', { name: tm.consolation.name })}` : ''}</p>`;
}

/* Step 3: group matches */
function playPanel(tm: Tournament): string {
  const gi = sim.groupRoundInfo(tm);
  const ready = sim.groupsReady(tm);
  const p = progress(tm);
  return `<div class="card sim-card dk-sim">
    <div class="row between"><h2>🏓 ${t('desk.org.playTitle')}</h2><span class="badge gold">${t('desk.sim.badge')}</span></div>
    ${tip('desk.org.playHint')}
    <div class="xp"><span style="width:${p.total ? Math.round((p.done / p.total) * 100) : 0}%"></span></div>
    <small class="muted">${t('dash.matchesDone', { done: n(p.done), total: n(p.total) })}</small>
    <div class="row" style="margin-block-start:8px">
      ${gi.next !== null ? `<button class="btn green small" data-act="dk-round">🏓 ${t('tsim.playRound', { r: gi.next + 1, of: gi.total })}</button>
        <button class="btn soft small" data-act="dk-round-all">⏩ ${t('tsim.playAllGroups')}</button>` : ''}
      <a class="btn soft small" href="#/t/${tm.id}/matches">✍️ ${t('desk.org.enterByHand')}</a>
    </div>
    ${ready ? `<button class="btn gold block" style="margin-block-start:12px" data-act="dk-start-ko">⚔️ ${t('ko.start')}</button>` : ''}
  </div>
  <div class="card"><h2>📊 ${t('desk.org.tables')}</h2>${miniStandings(tm)}</div>`;
}

function koMatch(tm: Tournament, m: Match, b: Bracket): string {
  if (isBye(m, b)) return '';
  const done = hasResult(m);
  const w = done ? winnerId(m) : null;
  const s = done ? summarize(m) : null;
  const side = (pid: string | null, g: number | undefined) => `<span class="dk-ko-p ${w && w === pid ? 'win' : ''}">${pid ? pPhoto(tm, pid) : '<span class="avatar"></span>'}<span dir="auto">${pid ? esc(playerName(tm, pid)) : '…'}</span>${s ? `<b>${n(g ?? 0)}</b>` : ''}</span>`;
  return `<div class="dk-ko-m ${done ? 'done' : ''}">${side(m.aId, s?.gamesA)}${side(m.bId, s?.gamesB)}</div>`;
}

function bracketView(tm: Tournament, b: Bracket): string {
  const total = b.rounds.length;
  return `<div class="dk-bracket"><h3>${b.kind === 'main' ? `🏆 ${t('desk.org.mainDraw')}` : `🥈 <span dir="auto">${esc(b.name)}</span>`}</h3>
    <div class="dk-rounds">${b.rounds.map((ids, r) => `<div class="dk-round"><h4>${t(`ko.round.${roundName(r, total)}` as MessageKey)}</h4>
      ${ids.map((id) => koMatch(tm, tm.matches[id], b)).join('')}
      ${r === total - 1 && b.thirdPlaceId ? `<h4>${t('desk.org.third')}</h4>${koMatch(tm, tm.matches[b.thirdPlaceId], b)}` : ''}</div>`).join('')}</div></div>`;
}

/* Step 4: knockout */
function koPanel(tm: Tournament): string {
  const next = sim.nextKoRound(tm);
  const left = tm.brackets.flatMap((b) => bracketMatches(b, tm.matches)).filter((m) => m.aId && m.bId && !hasResult(m)).length;
  return `<div class="card sim-card dk-sim">
    <div class="row between"><h2>⚔️ ${t('desk.org.koTitle')}</h2><span class="badge gold">${t('desk.sim.badge')}</span></div>
    ${tip('desk.org.koHint')}
    <small class="muted">${t('desk.org.koLeft', { n: left })}</small>
    <div class="row" style="margin-block-start:8px">
      ${next ? `<button class="btn green small" data-act="dk-ko">🏓 ${t('tsim.playKo', { r: t(`ko.round.${next}` as MessageKey) })}</button>
      <button class="btn soft small" data-act="dk-ko-all">⏩ ${t('tsim.playAllKo')}</button>` : ''}
      <a class="btn soft small" href="#/t/${tm.id}/knockout">✍️ ${t('desk.org.enterByHand')}</a>
    </div>
  </div>
  <div class="card">${tm.brackets.map((b) => bracketView(tm, b)).join('')}</div>`;
}

/* Step 5: champion */
function championPanel(tm: Tournament): string {
  const main = tm.brackets.find((b) => b.kind === 'main')!;
  const places = placements(main, tm.matches);
  const at = (k: number) => places.find((x) => x.place === k)?.playerId ?? null;
  const champ = at(1);
  const pl = tm.players.find((x) => x.id === champ);
  const acc = pl ? accountOf(pl) : undefined;
  const cons = tm.brackets.find((b) => b.kind === 'consolation');
  const consWin = cons ? placements(cons, tm.matches).find((x) => x.place === 1)?.playerId ?? null : null;
  const podium = (k: number, medal: string) => at(k) ? `<div class="dk-pod p${k}">${pPhoto(tm, at(k))}<b dir="auto">${esc(playerName(tm, at(k)))}</b><span>${medal}</span></div>` : '';
  return `<div class="card dk-champ">
    <div class="dk-champ-art">${championCelebration(tm.id, content.photoOf(acc), content.genderOf(acc))}</div>
    <div class="dk-champ-text"><span class="kicker">🏆 ${t('desk.org.s.champion')}</span>
      <h2 dir="auto">${esc(playerName(tm, champ))}</h2>
      <div class="dk-podium">${podium(2, '🥈')}${podium(1, '🥇')}${podium(3, '🥉')}</div>
      ${consWin ? `<p>🥈 <span dir="auto">${esc(cons!.name)}</span>: <b dir="auto">${esc(playerName(tm, consWin))}</b></p>` : ''}
      <div class="row"><a class="btn soft small" href="#/t/${tm.id}/knockout">${t('tsim.seeBracket')}</a>
        <button class="btn gold small" data-act="dk-new-open">➕ ${t('desk.org.new')}</button></div>
    </div>
  </div>
  <div class="card">${tm.brackets.map((b) => bracketView(tm, b)).join('')}</div>`;
}

/* Payments: entry fee per player, paid ticks, totals */
function paymentsCard(tm: Tournament): string {
  const keys = payKeys(tm);
  const fee = feeOf(tm);
  const tt = totals(keys.map((k) => ({ amount: fee, paid: paidOf(tm, k) })));
  const preReg = tm.stage === 'setup' && registrationOf(tm).open;
  const regs = regCache.get(tm.id) ?? [];
  const nameOf = (k: string) => {
    const pl = tm.players.find((p) => payKey(p) === k);
    if (pl) return { name: pl.name, photo: pPhoto(tm, pl.id) };
    const r = regs.find((x) => x.player_id === k);
    return { name: r?.full_name ?? '?', photo: r ? regPhoto(r) : avatar('?') };
  };
  // Waiting receipts first (to review), then cash promises, then nothing yet, then paid.
  const order = (k: string) => { const r = rank(tm, k); return r === 0 ? 9 : r; };
  const unpaidFirst = [...keys].sort((a, b) => order(a) - order(b));
  return `<div class="card dk-pay" id="payments">
    <div class="row between"><h2>💰 ${t('desk.pay.feesTitle')}</h2>
      <label class="row dk-fee">${t('desk.org.fee')} <input class="input" id="dkFeeEdit" inputmode="decimal" value="${fee || ''}" placeholder="0" style="width:90px">
      <button class="btn soft small" data-act="dk-fee-save">${t('desk.save')}</button></label></div>
    ${tip(preReg ? 'desk.pay.feesHintReg' : 'desk.pay.feesHint')}
    ${fee ? payBox(tt) : `<p class="muted">${t('desk.pay.noFee')}</p>`}
    ${fee && keys.length ? `<div class="row" style="margin-block:8px">
        <button class="btn soft small" data-act="dk-pay-sim">🎲 ${t('desk.pay.simulate')}</button>
        <button class="btn ghost small" data-act="dk-pay-all">${icon('check', 14)} ${t('desk.pay.markAll')}</button></div>
      <div class="dk-lines">${unpaidFirst.map((k) => { const p = nameOf(k); return personLine(p.photo, p.name, `${money(fee)} ${paidOf(tm, k) ? '' : payUi.proof(proofOf(tm, k))}`, paidTick('fee', k, paidOf(tm, k)), paidOf(tm, k) ? 'paid' : ''); }).join('')}</div>` : ''}
    ${fee && !keys.length ? `<p class="muted small">${t('desk.pay.nobody')}</p>` : ''}
  </div>`;
}

/* ------------------------------------------------------------------ events */

function current(): Tournament | undefined {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  return parts[1] === 'org' && parts[2] ? find(parts[2]) : undefined;
}

const save = () => host.persist();

export async function onClick(act: string, el: HTMLElement): Promise<boolean> {
  const tm = current();
  switch (act) {
    case 'dk-new-open':
      newOpen = !newOpen;
      if (newOpen && location.hash !== '#/desk/org') { location.hash = '#/desk/org'; return true; }
      render();
      if (newOpen) document.getElementById('dkName')?.focus();
      return true;
    case 'dk-new-groups':
      draft.groups = Number(el.dataset.v) || 4;
      keepDraft(); render(); return true;
    case 'dk-join-count':
      joinCount = Number(el.dataset.v) || 8; render(); return true;
    case 'dk-pick-toggle':
      picking = !picking; render(); return true;
    case 'dk-pick':
      if (picked.has(el.dataset.id!)) picked.delete(el.dataset.id!); else picked.add(el.dataset.id!);
      render(); return true;
    case 'dk-pick-clear':
      picked.clear(); render(); return true;
  }
  if (!tm) return false;
  switch (act) {
    case 'dk-join-random': case 'dk-join-picked': {
      let ids: string[];
      if (act === 'dk-join-picked') ids = [...picked];
      else {
        const all = await api.simPlayers().catch(() => [] as api.SimPlayer[]);
        const joined = new Set((regCache.get(tm.id) ?? []).filter((r) => r.status !== 'withdrawn' && r.status !== 'rejected').map((r) => r.player_id));
        ids = sample(all.filter((p) => !joined.has(p.id)).map((p) => p.id), joinCount);
      }
      if (!ids.length) return true;
      busy = true; render();
      try {
        const k = await api.simJoin(tm.id, ids);
        toast(`🎮 ${t('desk.org.joined', { n: k })}`);
        picked.clear();
        if (k < ids.length) toast(t('desk.org.joinedSome', { n: k, of: ids.length }));
      } catch (e) { toast(authErr(e)); }
      busy = false;
      loadRegs(tm.id, true);
      return true;
    }
    case 'dk-decide':
      try { await remote.decide(el.dataset.id!, el.dataset.s as 'approved'); } catch (e) { toast(authErr(e)); }
      loadRegs(tm.id, true); return true;
    case 'dk-approve-all': {
      const pend = (regCache.get(tm.id) ?? []).filter((r) => r.status === 'pending');
      busy = true; render();
      try { await Promise.all(pend.map((r) => remote.decide(r.id, 'approved'))); toast(`✅ ${t('desk.org.approvedN', { n: pend.length })}`); } catch (e) { toast(authErr(e)); }
      busy = false; loadRegs(tm.id, true); return true;
    }
    case 'dk-close': {
      busy = true; render();
      try {
        const regs = (await remote.tournamentRegistrations(tm.id)).filter((r) => r.status === 'approved');
        const approved = await Promise.all(regs.map(async (r) => {
          let directoryId: string | undefined;
          try { directoryId = await remote.playerForProfile(r.player_id); } catch { /* keep without directory link */ }
          return { profileId: r.player_id, name: r.full_name || '?', directoryId };
        }));
        closeRegistration(tm, approved);
        save();
        toast(`🧩 ${t('desk.org.drawn')}`);
      } catch (e) { toast(authErr(e)); }
      busy = false; render(); return true;
    }
    case 'dk-reopen':
      if (tm.stage !== 'setup') return true;
      tm.registration = { ...registrationOf(tm), open: true };
      save(); loadRegs(tm.id, true); return true;
    case 'dk-reshuffle':
      try { reshuffleGroups(tm); save(); toast(`🎲 ${t('desk.org.reshuffled')}`); } catch { /* locked */ }
      render(); return true;
    case 'dk-start-groups':
      try { startGroups(tm); } catch (e) {
        toast(t((e as Error).message === 'waiting' ? 'tsim.errWaiting' : 'setup.errSmall')); return true;
      }
      save(); toast(`▶️ ${t('desk.org.started')}`); render(); return true;
    case 'dk-round': case 'dk-round-all': {
      let r = sim.simGroupRound(tm);
      if (act === 'dk-round-all') while (r !== null) r = sim.simGroupRound(tm);
      save();
      if (sim.groupsReady(tm)) toast(`✅ ${t('tsim.groupsDone')}`);
      render(); return true;
    }
    case 'dk-start-ko':
      sim.settleTies(tm);
      try { startKnockout(tm); } catch { toast(t('ko.notReady')); return true; }
      save(); render(); return true;
    case 'dk-ko': case 'dk-ko-all': {
      let r = sim.simKoRound(tm);
      if (act === 'dk-ko-all') while (r) r = sim.simKoRound(tm);
      save();
      if (sim.finished(tm)) { confetti(); toast(`🏆 ${t('tsim.finished')}`); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      render(); return true;
    }
    case 'dk-fee-save':
      setFee(tm, Number(val('dkFeeEdit').replace(/[^\d.]/g, '')));
      save(); toast(t('settings.saved')); render(); return true;
    case 'dk-pay-sim': {
      // Demo players with a registration send receipts or promise cash (to review); others are ticked at random.
      let k = 0;
      try { if (payCache.get(tm.id)?.length) k = await pay.simPay('tournament', tm.id); } catch (e) { toast(authErr(e)); }
      if (!k) { k = simulatePayments(tm, payKeys(tm).filter((x) => !payRow(tm, x))); save(); }
      payCache.delete(tm.id);
      toast(`💰 ${t('desk.pay.simulated', { n: k })}`); render(); return true;
    }
    case 'dk-pay-all':
      payKeys(tm).forEach((k) => setPaid(tm, k, true));
      await Promise.all(payKeys(tm).map((k) => payRow(tm, k)).filter((r) => r && !r.paid)
        .map((r) => pay.setPaid('tournament', r!.registration_id, true).catch(() => undefined)));
      payCache.delete(tm.id);
      save(); render(); return true;
  }
  return false;
}

function keepDraft(): void {
  if (!document.getElementById('dkFee')) return;
  draft.fee = Number(val('dkFee').replace(/[^\d.]/g, '')) || 0;
  draft.max = val('dkMax').replace(/[^\d]/g, '');
  draft.auto = (document.getElementById('dkAuto') as HTMLInputElement | null)?.checked ?? true;
}

export async function onSubmit(kind: string): Promise<boolean> {
  if (kind !== 'dk-new') return false;
  keepDraft();
  const name = val('dkName');
  if (!name) return true;
  const formats: Record<'group' | 'early' | 'semi' | 'final', BestOf> = { group: 3, early: 3, semi: 5, final: 5 };
  const tm = createTournament({
    name, date: val('dkDate'), playerNames: [], groupCount: draft.groups, formats,
    consolation: { enabled: true, name: 'بطولة الترضية' },
  });
  if (val('dkLoc')) tm.location = val('dkLoc');
  const max = Number(draft.max);
  tm.registration = { open: true, autoAccept: draft.auto, maxPlayers: max >= 2 ? max : null };
  setFee(tm, draft.fee);
  if (session.profile) tm.organizerId = session.profile.id;
  host.add(tm);
  newOpen = false;
  toast(`🚀 ${t('desk.org.created')}`);
  location.hash = `#/desk/org/${tm.id}`;
  return true;
}

export function onChange(el: HTMLInputElement): boolean {
  const tm = current();
  if (el.dataset.act === 'dk-paid' && el.dataset.kind === 'fee' && tm) {
    setPaid(tm, el.dataset.id!, el.checked);
    const r = payRow(tm, el.dataset.id!);
    if (r) {
      r.paid = el.checked;
      pay.setPaid('tournament', r.registration_id, el.checked).then(() => { payCache.delete(tm.id); render(); }, (e) => toast(authErr(e)));
    }
    save(); render(); return true;
  }
  if ((el.dataset.act === 'dk-reg-auto' || el.dataset.act === 'dk-reg-max') && tm) {
    const max = Number(val('dkRegMax').replace(/[^\d]/g, ''));
    tm.registration = { ...registrationOf(tm), autoAccept: (document.querySelector('[data-act="dk-reg-auto"]') as HTMLInputElement).checked, maxPlayers: max >= 2 ? max : null };
    save(); toast(t('settings.saved')); return true;
  }
  return false;
}

/** Count of join requests waiting in all the organizer's tournaments (for the tab badge). */
export function pendingCount(): number {
  return mine().reduce((s, x) => s + (regCache.get(x.id) ?? []).filter((r) => r.status === 'pending').length, 0);
}

