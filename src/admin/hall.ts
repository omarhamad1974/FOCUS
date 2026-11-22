/**
 * Hall owner's tool: the hall (tables, price per hour), the hours each table is open, players'
 * requests, confirmations and payments. Several players may ask for the same hour; the owner
 * confirms one. Paid players come first (approving a payment confirms the hour straight away).
 * The simulation lets demo players ask for hours and pay.
 */
import { t } from '../i18n/ar';
import * as content from '../data/content';
import * as halls from '../data/halls';
import type { Hall, HallBooking, HallSlot } from '../data/halls';
import * as pay from '../data/pay';
import { authErr, money, n, render, session, val } from '../app/ctx';
import { dayKey } from '../domain/training';
import { totals } from '../domain/payments';
import { empty } from '../ui/art';
import { icon } from '../ui/icons';
import { avatar, esc, toast } from '../ui/util';
import * as payUi from '../ui/pay';
import * as api from './api';
import { countChips, ensureSim, payBox, paidTick, personLine, playerGrid, statTile, tip } from './ui';

const timeFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: 'numeric' });
const dayFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
const dayShort = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'short' });
const dayNum = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' });

let hall: Hall | null | undefined;
let allHalls: Hall[] = [];
let hallId = '';
let adding = false;
let slots: HallSlot[] = [];
let bookings: HallBooking[] = [];
let bkSlots = new Map<string, HallSlot>();
let phones = new Map<string, { full_name: string; phone: string | null }>();
let loadingNow = false;
let editing = false;
let busy = false;
let day = '';
let simCount = 6;
let picking = false;
const picked = new Set<string>();
const gen = { days: [0, 1, 2, 3, 4, 5, 6], from: 16, to: 23, weeks: 1 };
let show: 'requests' | 'confirmed' = 'requests';

export function reset(): void { hall = undefined; slots = []; bookings = []; }
payUi.onPayChange(() => { if (location.hash.startsWith('#/desk/hall')) { hall = undefined; } });

function load(): void {
  const me = session.profile?.id;
  if (loadingNow || !me) return;
  loadingNow = true;
  halls.listHalls(me)
    .then(async (list) => {
      allHalls = list;
      hall = list.find((x) => x.id === hallId) ?? list[0] ?? null;
      if (!hall) return;
      hallId = hall.id;
      const [s, b, ph] = await Promise.all([halls.listSlots(hall.id, 28), halls.ownerBookings(me), halls.ownerPlayers().catch(() => new Map())]);
      slots = s; bookings = b.filter((x) => x.hall_id === hallId); phones = ph;
      const known = new Map(s.map((x) => [x.id, x]));
      for (const x of await halls.slotsById(b.map((x) => x.slot_id).filter((id) => !known.has(id)))) known.set(x.id, x);
      bkSlots = known;
      payUi.forget('hall');
      await Promise.all([content.people(b.map((x) => x.player_id)).catch(() => undefined), payUi.load('hall', b.map((x) => x.id)).catch(() => undefined)]);
    })
    .catch((e) => { hall = null; toast(authErr(e)); })
    .finally(() => { loadingNow = false; render(); });
}

const at = (s: HallSlot) => new Date(s.starts_at);
const loading = () => `<div class="card center muted"><span class="spin"></span> ${t('reg.loading')}</div>`;

export function page(): string {
  if (hall === undefined) { load(); return loading(); }
  if (!hall || editing || adding) return setupForm(adding ? null : hall);
  if (picking) ensureSim();
  const now = new Date();
  const h = hall;
  const upcoming = slots.filter((s) => at(s) > now);
  const lines = bookings.map((b) => ({ b, s: bkSlots.get(b.slot_id) })).filter((x): x is { b: HallBooking; s: HallSlot } => !!x.s);
  const requests = lines.filter((x) => x.b.status === 'requested' && at(x.s) > now);
  const confirmed = lines.filter((x) => x.b.status === 'confirmed');
  const tt = totals(confirmed.map((x) => ({ amount: x.b.amount, paid: x.b.paid })));
  const week = upcoming.filter((s) => at(s).getTime() < now.getTime() + 7 * 86_400_000);
  const free = week.filter((s) => !s.taken);
  return `<section class="banner b-hall slim"><div><h1>${icon('table', 26)} ${esc(h.name)}</h1>
      <p>${h.address ? `${icon('pin', 14)} <span dir="auto">${esc(h.address)}</span> · ` : ''}${t('hall.tablesN', { n: n(h.tables) })} · ${t('hall.perHour', { p: money(h.price_hour) })}</p></div>
    <div class="row"><a class="btn soft" href="#/halls/${h.id}">${icon('eye')} ${t('hall.publicPage')}</a>
    <button class="btn gold" data-act="dk-hl-edit">${icon('edit')} ${t('hall.edit')}</button></div></section>
  <div class="row hl-switch">${allHalls.length > 1 ? `<div class="choice">${allHalls.map((x) => `<button data-act="dk-hl-pickhall" data-id="${x.id}" aria-pressed="${x.id === h.id}">${icon('table', 14)} <span dir="auto">${esc(x.name)}</span></button>`).join('')}</div>` : ''}
    <button class="btn soft small" data-act="dk-hl-add">${icon('plus', 14)} ${t('hall.addHall')}</button></div>
  <div class="stats dash-stats">
    ${statTile('calendar', n(free.length), 'hall.statFree')}
    ${statTile('bell', n(requests.length), 'hall.statRequests', requests.length > 0)}
    ${statTile('check', n(confirmed.filter((x) => at(x.s) > now).length), 'hall.statConfirmed')}
    ${statTile('money', money(tt.collected), 'desk.pay.collected')}
  </div>
  ${board(h, upcoming)}
  ${openHours(h, upcoming.length)}
  <div class="card sim-card dk-sim">
    <div class="row between"><h2>🎮 ${t('hall.simTitle')}</h2><span class="badge gold">${t('desk.sim.badge')}</span></div>
    ${tip('hall.simHint')}
    <div class="row" style="gap:8px">
      ${countChips('dk-hl-count', [3, 6, 12, 20], simCount)}
      <button class="btn green small" data-act="dk-hl-sim" ${busy || !free.length ? 'disabled' : ''}>🎲 ${t('hall.simRandom', { n: Math.min(simCount, free.length) })}</button>
      <button class="btn soft small" data-act="dk-pick-toggle" aria-pressed="${picking}">🖼️ ${t('desk.sim.pickByPhoto')}</button>
      <button class="btn soft small" data-act="dk-hl-simpay" ${busy || !lines.length ? 'disabled' : ''}>💳 ${t('hall.simPay')}</button>
      <button class="btn ghost small" data-act="dk-hl-clear" ${busy ? 'disabled' : ''}>🧹 ${t('desk.sim.clear')}</button>
    </div>
    ${picking ? `<div class="dk-picker">${playerGrid(picked, new Set())}
      <div class="row"><button class="btn green small" data-act="dk-hl-sim-picked" ${busy || !picked.size || !free.length ? 'disabled' : ''}>✅ ${t('hall.simPicked', { n: picked.size })}</button>
      <button class="btn ghost small" data-act="dk-pick-clear">${t('desk.sim.clearPick')}</button></div></div>` : ''}
  </div>
  <div class="card">
    <div class="row between"><h2>📋 ${t('hall.bookings')}</h2>
      <div class="choice"><button data-act="dk-hl-show" data-v="requests" aria-pressed="${show === 'requests'}">⏳ ${t('hall.requests')} (${n(requests.length)})</button>
      <button data-act="dk-hl-show" data-v="confirmed" aria-pressed="${show === 'confirmed'}">✅ ${t('hall.confirmed')} (${n(confirmed.length)})</button></div></div>
    ${tip(show === 'requests' ? 'hall.requestsHint' : 'hall.confirmedHint')}
    ${show === 'requests' ? requestList(requests) : confirmedList(confirmed, now)}
  </div>
  <div class="card dk-pay"><h2>💰 ${t('hall.payTitle')}</h2>${tip('hall.payHint')}${payBox(tt, 'hall.hours')}</div>`;
}

/* ------------------------------------------------------------- setup */

function setupForm(h: Hall | null): string {
  return `<section class="banner b-hall slim"><div><h1>${icon('table', 26)} ${t(h ? 'hall.edit' : 'hall.setupTitle')}</h1><p>${t('hall.setupHint')}</p></div></section>
  <form class="card dk-form-card" data-form="dk-hl-save">
    <label class="field"><span>${t('hall.name')}</span><input class="input" id="hlName" dir="auto" required maxlength="80" value="${esc(h?.name ?? '')}" placeholder="${esc(t('hall.namePh'))}"></label>
    <label class="field"><span>${t('hall.address')}</span><input class="input" id="hlAddr" dir="auto" maxlength="200" value="${esc(h?.address ?? '')}"></label>
    <label class="field"><span>${t('hall.map')}</span><input class="input" id="hlMap" dir="ltr" maxlength="500" value="${esc(h?.map_url ?? '')}" placeholder="https://maps.google.com/…"></label>
    <div class="row">
      <label class="field" style="flex:1"><span>${icon('table', 16)} ${t('hall.tables')}</span><input class="input" id="hlTables" type="number" min="1" max="40" value="${h?.tables ?? 4}"></label>
      <label class="field" style="flex:1"><span>${icon('money', 16)} ${t('hall.price')}</span><input class="input" id="hlPrice" inputmode="decimal" value="${h?.price_hour ?? 100}"></label>
    </div>
    <p class="hint">${t('hall.priceHint')}</p>
    <label class="field"><span>${t('hall.note')}</span><input class="input" id="hlNote" dir="auto" maxlength="400" value="${esc(h?.note ?? '')}" placeholder="${esc(t('hall.notePh'))}"></label>
    <div class="row"><button class="btn green" type="submit" ${busy ? 'disabled' : ''}>${icon('check')} ${t('desk.save')}</button>
      ${h || adding ? `<button class="btn ghost" type="button" data-act="${adding ? 'dk-hl-add' : 'dk-hl-edit'}">${t('common.cancel')}</button>`
        : `<button class="btn soft" type="button" data-act="dk-hl-demo" ${busy ? 'disabled' : ''}>🎮 ${t('hall.demoHall')}</button>`}</div>
  </form>`;
}

/* --------------------------------------------------------- day board */

function dayKeys(): string[] {
  const base = new Date();
  return Array.from({ length: 7 }, (_, i) => dayKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)));
}

function board(h: Hall, upcoming: HallSlot[]): string {
  const keys = dayKeys();
  if (!keys.includes(day)) day = keys.find((k) => upcoming.some((s) => dayKey(at(s)) === k)) ?? keys[0];
  const daySlots = upcoming.filter((s) => dayKey(at(s)) === day);
  const reqBySlot = new Map<string, HallBooking[]>();
  const confBySlot = new Map<string, HallBooking>();
  for (const b of bookings) {
    if (b.status === 'confirmed') confBySlot.set(b.slot_id, b);
    else if (b.status === 'requested') reqBySlot.set(b.slot_id, [...(reqBySlot.get(b.slot_id) ?? []), b]);
  }
  const hours = [...new Set(daySlots.map((s) => at(s).getHours()))].sort((a, b) => a - b);
  const strip = `<div class="dk-week">${keys.map((k) => {
    const list = upcoming.filter((s) => dayKey(at(s)) === k);
    const taken = list.filter((s) => s.taken).length;
    const d = new Date(`${k}T12:00:00`);
    const pct = list.length ? Math.round((taken / list.length) * 100) : 0;
    return `<button class="dk-day ${list.length ? '' : 'off'} ${k === day ? 'on' : ''}" data-act="dk-hl-day" data-v="${k}"><small>${dayShort.format(d)}</small><b>${dayNum.format(d)}</b>
      <span class="dk-daybar"><i style="height:${pct}%"></i></span><small>${list.length ? `${n(taken)}/${n(list.length)}` : '—'}</small></button>`;
  }).join('')}</div>`;
  const grid = hours.length ? `<div class="hall-grid" style="--cols:${hours.length}">
    <span class="hg-corner">${icon('table', 16)}</span>${hours.map((hr) => `<span class="hg-hour">${hourFmt.format(new Date(2026, 0, 1, hr))}</span>`).join('')}
    ${Array.from({ length: h.tables }, (_, i) => i + 1).map((tn) => `<span class="hg-table">${t('hall.tableN', { n: n(tn) })}</span>${hours.map((hr) => {
      const s = daySlots.find((x) => x.table_no === tn && at(x).getHours() === hr);
      if (!s) return '<span class="hg-cell closed"></span>';
      const c = confBySlot.get(s.id);
      if (c) { const p = content.person(c.player_id); return `<span class="hg-cell taken ${c.paid ? 'paid' : ''}" title="${esc(p?.full_name ?? '')}">${avatar(p?.full_name ?? '?', p?.avatar_url, p?.gender)}</span>`; }
      const r = reqBySlot.get(s.id)?.length ?? 0;
      return `<span class="hg-cell ${r ? 'asked' : 'free'}" title="${esc(r ? t('hall.cellAsked', { n: r }) : t('hall.cellFree'))}">${r ? `<b>${n(r)}</b>` : ''}</span>`;
    }).join('')}`).join('')}</div>
    <div class="hg-legend"><span><i class="hg-cell free"></i> ${t('hall.lgFree')}</span><span><i class="hg-cell asked"></i> ${t('hall.lgAsked')}</span>
      <span><i class="hg-cell taken"></i> ${t('hall.lgTaken')}</span><span><i class="hg-cell closed"></i> ${t('hall.lgClosed')}</span></div>`
    : empty('calendar', t('hall.noHoursDay'));
  return `<div class="card"><h2>🗓️ ${dayFmt.format(new Date(`${day}T12:00:00`))}</h2>${strip}${grid}</div>`;
}

function openHours(h: Hall, count: number): string {
  const hoursOpts = Array.from({ length: 24 }, (_, i) => i);
  const days = [6, 0, 1, 2, 3, 4, 5];
  const dn = new Intl.DateTimeFormat('ar-EG', { weekday: 'short' });
  return `<details class="card dk-gen" ${count ? '' : 'open'}><summary><h2 style="display:inline">⏰ ${t('hall.openTitle')}</h2> <small class="muted">${t('hall.openCount', { n: n(count) })}</small></summary>
    ${tip('hall.openHint')}
    <span class="lbl">${t('hall.days')}</span>
    <div class="choice">${days.map((d) => `<button data-act="dk-hl-gday" data-v="${d}" aria-pressed="${gen.days.includes(d)}">${dn.format(new Date(2026, 10, 1 + d))}</button>`).join('')}</div>
    <div class="row">
      <label class="field"><span>${t('hall.from')}</span><select class="input" id="hlFrom">${hoursOpts.map((x) => `<option value="${x}" ${x === gen.from ? 'selected' : ''}>${timeFmt.format(new Date(2026, 0, 1, x))}</option>`).join('')}</select></label>
      <label class="field"><span>${t('hall.to')}</span><select class="input" id="hlTo">${hoursOpts.map((x) => `<option value="${x + 1}" ${x + 1 === gen.to ? 'selected' : ''}>${timeFmt.format(new Date(2026, 0, 1, (x + 1) % 24))}</option>`).join('')}</select></label>
      <label class="field"><span>${t('hall.weeks')}</span><select class="input" id="hlWeeks">${[1, 2, 3, 4].map((w) => `<option value="${w}" ${w === gen.weeks ? 'selected' : ''}>${n(w)}</option>`).join('')}</select></label>
    </div>
    <p class="small muted">${t('hall.genAll', { n: n(h.tables) })}</p>
    <button class="btn green" data-act="dk-hl-gen" ${busy || !gen.days.length ? 'disabled' : ''}>➕ ${t('hall.genBtn')}</button>
  </details>`;
}

/* ---------------------------------------------------------- bookings */

function who(b: HallBooking) {
  const p = content.person(b.player_id);
  return { photo: avatar(p?.full_name ?? '?', p?.avatar_url, p?.gender), name: p?.full_name ?? phones.get(b.id)?.full_name ?? '?', phone: phones.get(b.id)?.phone };
}

const slotText = (s: HallSlot) => `${icon('calendar', 13)} ${dayNum.format(at(s))} · ${icon('clock', 13)} ${timeFmt.format(at(s))} · ${icon('table', 13)} ${t('hall.tableN', { n: n(s.table_no) })}`;

function requestList(list: { b: HallBooking; s: HallSlot }[]): string {
  if (!list.length) return empty('bell', t('hall.noRequests'));
  // Same hour together; inside an hour, paid and receipts first (priority).
  const bySlot = new Map<string, { b: HallBooking; s: HallSlot }[]>();
  for (const x of list) bySlot.set(x.s.id, [...(bySlot.get(x.s.id) ?? []), x]);
  const groups = [...bySlot.values()].sort((a, b) => at(a[0].s).getTime() - at(b[0].s).getTime() || a[0].s.table_no - b[0].s.table_no);
  return groups.map((g) => {
    const sorted = [...g].sort((a, b) => payUi.priority(a.b.paid, payUi.get('hall', a.b.id)) - payUi.priority(b.b.paid, payUi.get('hall', b.b.id)));
    return `<div class="hl-req">
      <h3 class="dk-sub"><span class="hl-when">${slotText(g[0].s)}</span> ${g.length > 1 ? `<span class="badge gold">${t('hall.manyAsked', { n: n(g.length) })}</span>` : ''}</h3>
      ${sorted.map(({ b }, i) => {
        const w = who(b);
        const p = payUi.get('hall', b.id);
        return personLine(w.photo, w.name, `${w.phone ? `${icon('phone', 13)} <span dir="ltr">${esc(w.phone)}</span> · ` : ''}${money(b.amount)} ${payUi.proof(p)}`,
          `${i === 0 && g.length > 1 && payUi.priority(b.paid, p) < 3 ? `<span class="badge green" title="${esc(t('hall.firstTip'))}">⭐ ${t('hall.first')}</span>` : ''}
           ${paidTick('hall', b.id, b.paid)}
           <button class="btn green small" data-act="dk-hl-ok" data-id="${b.id}">${icon('check', 14)} ${t('hall.confirm')}</button>
           <button class="btn ghost small" data-act="dk-hl-no" data-id="${b.id}" title="${esc(t('hall.decline'))}">${icon('x', 14)}</button>`, b.paid ? 'paid' : 'pend');
      }).join('')}</div>`;
  }).join('');
}

function confirmedList(list: { b: HallBooking; s: HallSlot }[], now: Date): string {
  if (!list.length) return empty('calendar', t('hall.noConfirmed'));
  return [...list].sort((a, b) => at(a.s).getTime() - at(b.s).getTime()).map(({ b, s }) => {
    const w = who(b);
    return personLine(w.photo, w.name, `${slotText(s)}${w.phone ? ` · ${icon('phone', 13)} <span dir="ltr">${esc(w.phone)}</span>` : ''} ${payUi.proof(payUi.get('hall', b.id))}`,
      `<b class="dk-price">${money(b.amount)}</b>${paidTick('hall', b.id, b.paid)}
       ${at(s) > now ? `<button class="btn ghost small" data-act="dk-hl-cancel" data-id="${b.id}" title="${esc(t('hall.cancel'))}">${icon('x', 14)}</button>` : ''}`,
      b.paid ? 'paid' : '');
  }).join('');
}

/* ------------------------------------------------------------ events */

async function act(fn: () => Promise<string | void>): Promise<void> {
  busy = true; render();
  try { const msg = await fn(); if (msg) toast(msg); } catch (e) { toast(authErr(e)); }
  busy = false; hall = undefined; render();
}

function hourRows(h: Hall, days: number[], from: number, to: number, weeks: number, startOffset = 0): { table_no: number; starts_at: string }[] {
  const out: { table_no: number; starts_at: string }[] = [];
  const now = new Date();
  for (let i = startOffset; i < weeks * 7 + startOffset; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (!days.includes(d.getDay())) continue;
    for (let hr = from; hr < to; hr++) {
      const st = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hr);
      if (st <= now) continue;
      for (let tn = 1; tn <= h.tables; tn++) out.push({ table_no: tn, starts_at: st.toISOString() });
    }
  }
  return out;
}

export async function onClick(a: string, el: HTMLElement): Promise<boolean> {
  const id = el.dataset.id!;
  switch (a) {
    case 'dk-hl-edit': editing = !editing; render(); return true;
    case 'dk-hl-add': adding = !adding; render(); return true;
    case 'dk-hl-pickhall': hallId = id; hall = undefined; day = ''; render(); return true;
    case 'dk-hl-day': day = el.dataset.v!; render(); return true;
    case 'dk-hl-show': show = el.dataset.v as typeof show; render(); return true;
    case 'dk-hl-count': simCount = Number(el.dataset.v) || 6; render(); return true;
    case 'dk-pick-toggle': picking = !picking; render(); return true;
    case 'dk-pick': if (picked.has(id)) picked.delete(id); else picked.add(id); render(); return true;
    case 'dk-pick-clear': picked.clear(); render(); return true;
    case 'dk-hl-gday': {
      const d = Number(el.dataset.v);
      gen.days = gen.days.includes(d) ? gen.days.filter((x) => x !== d) : [...gen.days, d];
      render(); return true;
    }
    case 'dk-hl-gen': {
      if (!hall) return true;
      const h = hall;
      gen.from = Number(val('hlFrom')); gen.to = Number(val('hlTo')); gen.weeks = Number(val('hlWeeks')) || 1;
      if (gen.to <= gen.from) { toast(t('hall.badHours')); return true; }
      await act(async () => `⏰ ${t('hall.genDone', { n: n(await halls.addSlots(h.id, hourRows(h, gen.days, gen.from, gen.to, gen.weeks))) })}`);
      return true;
    }
    case 'dk-hl-demo':
      await act(async () => {
        const h = await halls.saveHall({ name: t('hall.demoName'), address: t('hall.demoAddress'), tables: 6, price_hour: 120, note: t('hall.demoNote') });
        await halls.addSlots(h.id, hourRows(h, [0, 1, 2, 3, 4, 5, 6], 16, 23, 1));
        editing = false; adding = false; hallId = h.id;
        return `🏓 ${t('hall.demoDone')}`;
      });
      return true;
    case 'dk-hl-sim': case 'dk-hl-sim-picked': {
      const list = a === 'dk-hl-sim-picked' ? [...picked] : null;
      await act(async () => { const k = await halls.simHall(list ? list.length : simCount, list, hall?.id); picked.clear(); return `🎮 ${t('hall.simDone', { n: n(k) })}`; });
      return true;
    }
    case 'dk-hl-simpay':
      await act(async () => `💳 ${t('desk.pay.simulated', { n: n(await pay.simPay('hall')) })}`);
      return true;
    case 'dk-hl-clear':
      await act(async () => `🧹 ${t('desk.sim.cleared', { n: n(await api.simClear('hall')) })}`);
      return true;
    case 'dk-hl-ok': case 'dk-hl-no':
      await act(async () => { await halls.decide(id, a === 'dk-hl-ok'); return a === 'dk-hl-ok' ? `✅ ${t('hall.confirmedToast')}` : t('hall.declinedToast'); });
      return true;
    case 'dk-hl-cancel':
      await act(async () => { await halls.cancel(id); return t('hall.cancelled'); });
      return true;
  }
  return false;
}

export async function onSubmit(kind: string): Promise<boolean> {
  if (kind !== 'dk-hl-save') return false;
  const name = val('hlName');
  if (name.length < 2) { toast(t('hall.needName')); return true; }
  const tables = Math.max(1, Math.min(40, Math.round(Number(val('hlTables')) || 1)));
  const price = Math.max(0, Number(val('hlPrice').replace(/[^\d.]/g, '')) || 0);
  await act(async () => {
    const saved = await halls.saveHall({ id: adding ? undefined : hall?.id, name, address: val('hlAddr') || null, map_url: val('hlMap') || null, tables, price_hour: price, note: val('hlNote') || null });
    editing = false; adding = false; hallId = saved.id;
    return `✅ ${t('hall.saved')}`;
  });
  return true;
}

export async function onChange(el: HTMLInputElement): Promise<boolean> {
  if (el.dataset.act !== 'dk-paid' || el.dataset.kind !== 'hall') return false;
  try { await pay.setPaid('hall', el.dataset.id!, el.checked); } catch (e) { toast(authErr(e)); el.checked = !el.checked; }
  hall = undefined; render();
  return true;
}
