/**
 * Halls for players: #/halls lists the table tennis halls, #/halls/<id> shows a day of tables ×
 * hours. Players tap as many free hours as they like and ask for them; the owner confirms.
 * After asking, the player pays (wallet + receipt, or cash on the spot) and can cancel until
 * the owner's deadline.
 */
import { t } from '../i18n/ar';
import * as content from '../data/content';
import * as halls from '../data/halls';
import type { Hall, HallBooking, HallSlot } from '../data/halls';
import * as pay from '../data/pay';
import { authErr, isHall, loading, money, n, needLogin, render, session } from '../app/ctx';
import { dayKey } from '../domain/training';
import { empty } from '../ui/art';
import { icon } from '../ui/icons';
import { avatarOf, esc, toast } from '../ui/util';
import * as payUi from '../ui/pay';

const timeFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: 'numeric' });
const dayFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
const dayShort = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'short' });
const dayNum = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' });

let list: Hall[] | null = null;
let loadingList = false;
let current: { hall: Hall | null; slots: HallSlot[]; asks: Map<string, number> } | null = null;
let currentId = '';
let loadingHall = false;
let mine: HallBooking[] | null = null;
let mineSlots = new Map<string, HallSlot>();
let mineHalls = new Map<string, Hall>();
let loadingMine = false;
let day = '';
const picked = new Set<string>();
let busy = false;

export function reset(): void { list = null; current = null; mine = null; }
payUi.onPayChange(() => { mine = null; });

const at = (s: HallSlot) => new Date(s.starts_at);

function loadList(): void {
  if (loadingList) return;
  loadingList = true;
  halls.listHalls()
    .then(async (h) => { list = h; await Promise.all([content.people(h.map((x) => x.owner_id)), pay.settingsOf(h.map((x) => x.owner_id))]).catch(() => undefined); })
    .catch((e) => { list = []; toast(authErr(e)); })
    .finally(() => { loadingList = false; render(); });
}

function loadHall(id: string): void {
  if (loadingHall) return;
  loadingHall = true;
  currentId = id;
  Promise.all([halls.getHall(id), halls.listSlots(id, 14), halls.slotRequests(id).catch(() => new Map<string, number>())])
    .then(async ([h, s, a]) => {
      current = { hall: h, slots: s, asks: a };
      if (h) await Promise.all([content.people([h.owner_id]), pay.settingsOf([h.owner_id])]).catch(() => undefined);
    })
    .catch((e) => { current = { hall: null, slots: [], asks: new Map() }; toast(authErr(e)); })
    .finally(() => { loadingHall = false; render(); });
}

function loadMine(): void {
  if (loadingMine || !session.profile) return;
  loadingMine = true;
  halls.myBookings()
    .then(async (b) => {
      mine = b;
      mineSlots = new Map((await halls.slotsById(b.map((x) => x.slot_id))).map((s) => [s.id, s]));
      const ids = [...new Set(b.map((x) => x.hall_id))];
      const hs = await Promise.all(ids.map((id) => halls.getHall(id)));
      mineHalls = new Map(hs.filter((h): h is Hall => !!h).map((h) => [h.id, h]));
      payUi.forget('hall');
      await Promise.all([pay.settingsOf(b.map((x) => x.owner_id)), payUi.load('hall', b.map((x) => x.id))]).catch(() => undefined);
    })
    .catch(() => { mine = []; })
    .finally(() => { loadingMine = false; render(); });
}

/* -------------------------------------------------------------- list */

function banner(): string {
  return `<section class="banner b-hall">
    <div><h1>${icon('table', 28)} ${t('halls.title')}</h1><p>${t('halls.tagline')}</p></div>
    ${isHall() ? `<a class="btn gold" href="#/desk/hall">${icon('calendar')} ${t('halls.manage')}</a>` : ''}
  </section>`;
}

function hallCard(h: Hall): string {
  const owner = content.person(h.owner_id);
  return `<a class="card hall-card rise" href="#/halls/${h.id}">
    <div class="hall-pic">${h.photo_url ? `<img src="${esc(h.photo_url)}" alt="" loading="lazy">` : `<span class="hall-art">${icon('table', 56)}</span>`}</div>
    <div class="hall-body"><h3 dir="auto">${esc(h.name)}</h3>
      ${h.address ? `<p class="small muted" dir="auto">${icon('pin', 14)} ${esc(h.address)}</p>` : ''}
      <div class="row small"><span class="badge blue">${icon('table', 14)} ${t('hall.tablesN', { n: n(h.tables) })}</span>
        <span class="badge green">${icon('money', 14)} ${t('hall.perHour', { p: money(h.price_hour) })}</span></div>
      <p class="small muted">${icon('wallet', 14)} ${esc(payUi.methodsLine(pay.settingsNow(h.owner_id)))}${owner ? ` · ${esc(owner.full_name)}` : ''}</p>
      <span class="btn green small">${icon('calendar', 14)} ${t('halls.book')}</span></div>
  </a>`;
}

function listPage(): string {
  if (!list) { loadList(); return banner() + loading(); }
  return `${banner()}${myCard()}
    ${list.length ? `<div class="hall-list">${list.map(hallCard).join('')}</div>` : empty('table', t('halls.none'))}`;
}

/* -------------------------------------------------------------- hall */

function hallPage(id: string): string {
  if (!current || currentId !== id) { if (currentId !== id) current = null; loadHall(id); return banner() + loading(); }
  const h = current.hall;
  if (!h) return empty('table', t('halls.notFound'), `<a class="btn" href="#/halls">${t('halls.all')}</a>`);
  const s = pay.settingsNow(h.owner_id);
  const owner = content.person(h.owner_id);
  const now = new Date();
  const upcoming = current.slots.filter((x) => at(x) > now);
  const days = [...new Set(upcoming.map((x) => dayKey(at(x))))].sort();
  if (!days.includes(day)) day = days[0] ?? '';
  const dSlots = upcoming.filter((x) => dayKey(at(x)) === day);
  const hours = [...new Set(dSlots.map((x) => at(x).getHours()))].sort((a, b) => a - b);
  const myOn = new Map((mine ?? []).filter((b) => b.hall_id === h.id && (b.status === 'requested' || b.status === 'confirmed')).map((b) => [b.slot_id, b]));
  if (session.profile && mine === null) loadMine();
  const total = [...picked].filter((pid) => dSlots.some((x) => x.id === pid) || upcoming.some((x) => x.id === pid)).length;
  const deadline = s?.cancel_hours;
  const grid = hours.length ? `<div class="hall-grid public" style="--cols:${hours.length}">
    <span class="hg-corner">${icon('table', 16)}</span>${hours.map((hr) => `<span class="hg-hour">${hourFmt.format(new Date(2026, 0, 1, hr))}</span>`).join('')}
    ${Array.from({ length: h.tables }, (_, i) => i + 1).map((tn) => `<span class="hg-table">${t('hall.tableN', { n: n(tn) })}</span>${hours.map((hr) => {
      const sl = dSlots.find((x) => x.table_no === tn && at(x).getHours() === hr);
      if (!sl) return '<span class="hg-cell closed"></span>';
      const my = myOn.get(sl.id);
      if (my) return `<span class="hg-cell mine ${my.status}" title="${esc(t(my.status === 'confirmed' ? 'halls.myConfirmed' : 'halls.myAsked'))}">${my.status === 'confirmed' ? '✅' : '⏳'}</span>`;
      if (sl.taken) return `<span class="hg-cell taken" title="${esc(t('halls.taken'))}"></span>`;
      const asks = current!.asks.get(sl.id) ?? 0;
      const on = picked.has(sl.id);
      return `<button class="hg-cell free ${on ? 'on' : ''} ${asks ? 'asked' : ''}" data-act="hl-pick" data-id="${sl.id}" aria-pressed="${on}"
        title="${esc(`${t('hall.tableN', { n: n(tn) })} · ${timeFmt.format(at(sl))}${asks ? ` · ${t('halls.othersAsked', { n: n(asks) })}` : ''}`)}">${on ? icon('check', 16) : asks ? `<small>${n(asks)}</small>` : ''}</button>`;
    }).join('')}`).join('')}</div>
    <div class="hg-legend"><span><i class="hg-cell free"></i> ${t('hall.lgFree')}</span><span><i class="hg-cell free on"></i> ${t('halls.lgPicked')}</span>
      <span><i class="hg-cell free asked"></i> ${t('halls.lgOthers')}</span><span><i class="hg-cell taken"></i> ${t('hall.lgTaken')}</span><span><i class="hg-cell mine"></i> ${t('halls.lgMine')}</span></div>`
    : empty('calendar', t('halls.noHours'));
  return `<a class="backlink" href="#/halls">${icon('back', 18)} ${t('halls.all')}</a>
  <section class="banner b-hall slim"><div><h1 dir="auto">${icon('table', 26)} ${esc(h.name)}</h1>
    <p>${h.address ? `${icon('pin', 14)} <span dir="auto">${esc(h.address)}</span> · ` : ''}${t('hall.tablesN', { n: n(h.tables) })} · <b>${t('hall.perHour', { p: money(h.price_hour) })}</b></p></div>
    <div class="row">${h.map_url ? `<a class="btn soft small" target="_blank" rel="noopener" href="${esc(h.map_url)}">${icon('pin', 16)} ${t('halls.map')}</a>` : ''}
      ${payUi.waButton(s, t('halls.waText', { hall: h.name }), 'pay.waChat')}</div></section>
  <div class="card hall-info">
    ${owner ? `<a class="row" href="#/u/${owner.id}">${avatarOf(owner)}<span><small class="muted">${t('halls.owner')}</small><br><b dir="auto">${esc(owner.full_name)}</b></span></a>` : ''}
    <div class="facts">
      <span>${icon('wallet', 16)} ${esc(payUi.methodsLine(s))}</span>
      <span>${icon('clock', 16)} ${deadline == null ? t('halls.cancelAny') : t('halls.cancelUntil', { n: n(deadline) })}</span>
    </div>
    ${h.note ? `<p class="hint" dir="auto">${esc(h.note)}</p>` : ''}
    <p class="hint">${t('halls.howHint')}</p>
  </div>
  ${myHere(h)}
  <div class="card">
    ${days.length ? `<div class="days">${days.map((k) => {
      const d = new Date(`${k}T12:00:00`);
      const free = upcoming.filter((x) => dayKey(at(x)) === k && !x.taken).length;
      return `<button class="day ${k === day ? 'on' : ''} ${free ? '' : 'full'}" data-act="hl-day" data-v="${k}"><small>${k === dayKey(now) ? t('tr.today') : dayShort.format(d)}</small><b>${dayNum.format(d)}</b><i>${n(free)}</i></button>`;
    }).join('')}</div>
    <h3 class="sec">${day ? dayFmt.format(new Date(`${day}T12:00:00`)) : ''}</h3>` : ''}
    ${grid}
  </div>
  ${total ? `<div class="hall-bar rise">${session.profile
    ? `<span><b>${t('halls.pickedN', { n: n(total) })}</b> · ${money(total * h.price_hour)}</span>
       <button class="btn ghost small" data-act="hl-clear">${t('halls.clearPick')}</button>
       <button class="btn green" data-act="hl-book" ${busy ? 'disabled' : ''}>${icon('check')} ${t('halls.askBtn')}</button>`
    : needLogin('halls.loginToBook')}</div>` : ''}`;
}

/** This player's hours at one hall, with payment and cancel. */
function myHere(h: Hall): string {
  const rows = (mine ?? []).filter((b) => b.hall_id === h.id);
  return rows.length ? `<div class="card"><h3>${icon('calendar', 20)} ${t('halls.myHere')}</h3>${bookingRows(rows)}</div>` : '';
}

function bookingRows(rows: HallBooking[]): string {
  const now = new Date();
  const live = rows.map((b) => ({ b, s: mineSlots.get(b.slot_id) })).filter((x): x is { b: HallBooking; s: HallSlot } => !!x.s && at(x.s) > now)
    .sort((a, b) => at(a.s).getTime() - at(b.s).getTime());
  if (!live.length) return `<p class="muted small">${t('halls.noMine')}</p>`;
  return live.map(({ b, s }) => {
    const h = mineHalls.get(b.hall_id);
    const set = pay.settingsNow(b.owner_id);
    const cancelOk = b.status === 'requested' || pay.canCancel(at(s), set?.cancel_hours);
    const dl = pay.cancelDeadline(at(s), set?.cancel_hours);
    const badge = b.status === 'confirmed' ? `<span class="badge green">✅ ${t('halls.st.confirmed')}</span>`
      : b.status === 'rejected' ? `<span class="badge red">${t('halls.st.rejected')}</span>` : `<span class="badge gold">⏳ ${t('halls.st.requested')}</span>`;
    return `<div class="order hl-mine">
      <div class="row between"><b>${dayFmt.format(at(s))} · ${timeFmt.format(at(s))}</b>${badge}</div>
      <div class="row small muted"><span dir="auto">${icon('table', 14)} ${esc(h?.name ?? '')} · ${t('hall.tableN', { n: n(s.table_no) })}</span><span>${money(b.amount)}</span></div>
      ${b.status !== 'rejected' ? payUi.payerBox({ kind: 'hall', ref: b.id, amount: b.amount, settings: set, paid: b.paid, compact: true,
        waText: t('halls.waBooking', { hall: h?.name ?? '', when: `${dayFmt.format(at(s))} ${timeFmt.format(at(s))}` }) }) : ''}
      ${b.status !== 'rejected' ? (cancelOk
        ? `<button class="btn ghost small" data-act="hl-cancel" data-id="${b.id}">${icon('x', 14)} ${t('halls.cancel')}</button>${dl && b.status === 'confirmed' ? ` <small class="muted">${t('halls.cancelBy', { when: `${dayNum.format(dl)} ${timeFmt.format(dl)}` })}</small>` : ''}`
        : `<small class="muted">🔒 ${t('halls.cancelClosed')}</small>`) : ''}
    </div>`;
  }).join('');
}

/** "My hall bookings" on #/me and the halls list. */
export function myCard(): string {
  if (!session.profile) return '';
  if (mine === null) { loadMine(); return ''; }
  const now = new Date();
  const live = mine.filter((b) => { const s = mineSlots.get(b.slot_id); return s && at(s) > now; });
  if (!live.length) return '';
  return `<div class="card"><h3>${icon('table', 20)} ${t('halls.myBookings')}</h3>${bookingRows(live)}</div>`;
}

export function route(parts: string[]): string | null {
  if (parts[0] !== 'halls') return null;
  return parts[1] ? hallPage(parts[1]) : listPage();
}

export async function onClick(act: string, el: HTMLElement): Promise<boolean> {
  switch (act) {
    case 'hl-day': day = el.dataset.v!; render(); return true;
    case 'hl-pick': { const id = el.dataset.id!; if (picked.has(id)) picked.delete(id); else picked.add(id); render(); return true; }
    case 'hl-clear': picked.clear(); render(); return true;
    case 'hl-book': {
      busy = true; render();
      try {
        const k = await halls.book([...picked]);
        picked.clear();
        toast(`📨 ${t('halls.asked', { n: n(k) })}`);
        mine = null; current = null;
      } catch (e) { toast(authErr(e)); }
      busy = false; render(); return true;
    }
    case 'hl-cancel':
      try { await halls.cancel(el.dataset.id!); toast(t('halls.cancelledToast')); mine = null; current = null; }
      catch (e) { toast(/deadline/.test(String((e as Error)?.message)) ? t('halls.cancelClosed') : authErr(e)); }
      render(); return true;
  }
  return false;
}
