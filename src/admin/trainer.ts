/**
 * Trainer's tool: the week's one-hour slots, who booked them and who paid,
 * apart from the public site. The simulation lets demo players book the
 * trainer's free slots (randomly or picked by photo).
 */
import { t } from '../i18n/ar';
import * as content from '../data/content';
import type { Location, Slot } from '../data/content';
import { authErr, money, n, render, session } from '../app/ctx';
import { byDay, dayKey, slotEnd, slotStarts } from '../domain/training';
import { totals } from '../domain/payments';
import { empty } from '../ui/art';
import { icon } from '../ui/icons';
import { avatar, esc, toast } from '../ui/util';
import * as api from './api';
import { countChips, ensureSim, payBox, paidTick, personLine, playerGrid, statTile, tip } from './ui';

const timeFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
const dayShort = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'short' });
const dayNum = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' });

let slots: Slot[] | null = null;
let locs: Location[] = [];
let bookings: api.PaidBooking[] | null = null;
let bkSlots = new Map<string, Slot>();
let phones = new Map<string, { full_name: string; phone: string | null }>();
let loadingNow = false;
let bookCount = 3;
let picking = false;
const picked = new Set<string>();
let busy = false;
let show: 'upcoming' | 'past' = 'upcoming';

export function reset(): void { slots = null; bookings = null; }

function load(): void {
  const me = session.profile?.id;
  if (loadingNow || !me) return;
  loadingNow = true;
  Promise.all([content.listSlots(me, 21), content.listLocations(me), api.trainerBookings(me), content.myTrainees().catch(() => new Map())])
    .then(async ([s, l, b, ph]) => {
      slots = s; locs = l; bookings = b; phones = ph;
      const known = new Map(s.map((x) => [x.id, x]));
      const missing = b.map((x) => x.slot_id).filter((id) => !known.has(id));
      for (const x of await content.slotsById(missing)) known.set(x.id, x);
      bkSlots = known;
      await content.people(b.map((x) => x.player_id)).catch(() => undefined);
    })
    .catch((e) => { slots = []; bookings = []; toast(authErr(e)); })
    .finally(() => { loadingNow = false; render(); });
}

const at = (s: Slot) => new Date(s.starts_at);
const range = (s: Slot) => `${timeFmt.format(at(s))} – ${timeFmt.format(slotEnd(at(s)))}`;

export function page(): string {
  if (!slots || !bookings) { load(); return `<div class="card center muted"><span class="spin"></span> ${t('reg.loading')}</div>`; }
  if (picking) ensureSim();
  const now = new Date();
  const upcoming = slots.filter((s) => at(s) > now);
  const free = upcoming.filter((s) => !s.booked);
  const lines = bookings.map((b) => ({ b, s: bkSlots.get(b.slot_id) })).filter((x): x is { b: api.PaidBooking; s: Slot } => !!x.s);
  const future = lines.filter((x) => at(x.s) > now);
  const past = lines.filter((x) => at(x.s) <= now);
  const tt = totals(lines.map((x) => ({ amount: x.s.price, paid: x.b.paid })));
  const shown = show === 'upcoming' ? future : past.reverse();
  const bookedBy = new Set(future.map((x) => x.b.player_id));
  return `<section class="banner b-train slim"><div><h1>${icon('coach', 26)} ${t('desk.tr.title')}</h1><p>${t('desk.tr.hint')}</p></div>
    <a class="btn gold" href="#/training/manage">${icon('calendar')} ${t('desk.tr.schedule')}</a></section>
  <div class="stats dash-stats">
    ${statTile('calendar', n(free.length), 'desk.tr.statFree')}
    ${statTile('users', n(future.length), 'desk.tr.statBooked', future.length > 0)}
    ${statTile('money', money(tt.collected), 'desk.pay.collected')}
    ${statTile('bell', money(tt.due), 'desk.pay.due', tt.due > 0)}
  </div>
  ${weekStrip(upcoming)}
  <div class="card sim-card dk-sim">
    <div class="row between"><h2>🎮 ${t('desk.tr.simTitle')}</h2><span class="badge gold">${t('desk.sim.badge')}</span></div>
    ${tip('desk.tr.simHint')}
    ${free.length < 4 ? `<div class="dk-next"><p class="small">${t('desk.tr.fewFree', { n: free.length })}</p>
      <button class="btn soft small" data-act="dk-tr-week" ${busy ? 'disabled' : ''}>🗓️ ${t('desk.tr.addWeek')}</button></div>` : ''}
    <div class="row" style="gap:8px">
      ${countChips('dk-tr-count', [1, 3, 5, 10], bookCount)}
      <button class="btn green small" data-act="dk-tr-book" ${busy || !free.length ? 'disabled' : ''}>🎲 ${t('desk.tr.bookRandom', { n: Math.min(bookCount, free.length) })}</button>
      <button class="btn soft small" data-act="dk-pick-toggle" aria-pressed="${picking}">🖼️ ${t('desk.sim.pickByPhoto')}</button>
      <button class="btn ghost small" data-act="dk-tr-clear" ${busy ? 'disabled' : ''}>🧹 ${t('desk.sim.clear')}</button>
    </div>
    ${picking ? `<div class="dk-picker">${tip('desk.tr.pickHint')}${playerGrid(picked, new Set())}
      <div class="row"><button class="btn green small" data-act="dk-tr-book-picked" ${busy || !picked.size || !free.length ? 'disabled' : ''}>✅ ${t('desk.tr.bookPicked', { n: picked.size })}</button>
      <button class="btn ghost small" data-act="dk-pick-clear">${t('desk.sim.clearPick')}</button></div></div>` : ''}
  </div>
  <div class="card dk-pay">
    <h2>💰 ${t('desk.tr.payTitle')}</h2>
    ${tip('desk.tr.payHint')}
    ${payBox(tt, 'desk.pay.sessions')}
  </div>
  <div class="card">
    <div class="row between"><h2>📋 ${t('desk.tr.bookings')}</h2>
      <div class="choice"><button data-act="dk-tr-show" data-v="upcoming" aria-pressed="${show === 'upcoming'}">${t('desk.tr.upcoming')} (${n(future.length)})</button>
      <button data-act="dk-tr-show" data-v="past" aria-pressed="${show === 'past'}">${t('desk.tr.past')} (${n(past.length)})</button></div></div>
    ${shown.length ? byDay(shown, (x) => at(x.s)).sort(([a], [b]) => (show === 'past' ? b.localeCompare(a) : a.localeCompare(b))).map(([, items]) => `
      <h3 class="dk-sub">${icon('calendar', 16)} ${dayFmt.format(at(items[0].s))}</h3>
      ${items.map(({ b, s }) => {
        const who = content.person(b.player_id);
        const ph = phones.get(b.id)?.phone;
        const l = locs.find((x) => x.id === s.location_id);
        return personLine(avatar(who?.full_name ?? '?', who?.avatar_url, who?.gender), who?.full_name ?? phones.get(b.id)?.full_name ?? '?',
          `${icon('clock', 13)} ${range(s)}${l ? ` · ${icon('pin', 13)} ${esc(l.name)}` : ''}${ph ? ` · ${icon('phone', 13)} <span dir="ltr">${esc(ph)}</span>` : ''}`,
          `<b class="dk-price">${s.price ? money(s.price) : t('tr.free')}</b>${paidTick('booking', b.id, b.paid)}
           ${at(s) > now ? `<button class="btn ghost small" data-act="dk-tr-cancel" data-id="${b.id}" title="${esc(t('desk.tr.cancel'))}">${icon('x', 14)}</button>` : ''}`,
          b.paid ? 'paid' : '');
      }).join('')}`).join('')
      : empty('calendar', t(show === 'upcoming' ? 'desk.tr.noUpcoming' : 'desk.tr.noPast'))}
    ${bookedBy.size ? `<p class="small muted">${t('desk.tr.players', { n: bookedBy.size })}</p>` : ''}
  </div>`;
}

/** Next 7 days as tiles: free and booked hours per day. */
function weekStrip(upcoming: Slot[]): string {
  const days: string[] = [];
  const base = new Date();
  for (let i = 0; i < 7; i++) days.push(dayKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)));
  return `<div class="dk-week">${days.map((k) => {
    const list = upcoming.filter((s) => dayKey(at(s)) === k);
    const booked = list.filter((s) => s.booked).length;
    const d = new Date(`${k}T12:00:00`);
    const pct = list.length ? Math.round((booked / list.length) * 100) : 0;
    return `<div class="dk-day ${list.length ? '' : 'off'}"><small>${dayShort.format(d)}</small><b>${dayNum.format(d)}</b>
      <span class="dk-daybar"><i style="height:${pct}%"></i></span><small>${list.length ? `${n(booked)}/${n(list.length)}` : '—'}</small></div>`;
  }).join('')}</div>`;
}

/** Make sure there is a place and a week of evening slots (5–9 PM) to book. */
async function addWeek(): Promise<number> {
  let loc = locs[0];
  if (!loc) loc = await content.saveLocation({ name: t('desk.tr.demoPlace'), address: t('desk.tr.demoAddress'), map_url: null });
  const today = new Date();
  const from = dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
  const rows = slotStarts({ from, weeks: 1, days: [0, 1, 2, 3, 4, 5, 6], hours: [17, 18, 19, 20] })
    .map((d) => ({ location_id: loc.id, starts_at: d.toISOString(), price: 300, note: null }));
  return content.addSlots(rows);
}

export async function onClick(act: string, el: HTMLElement): Promise<boolean> {
  switch (act) {
    case 'dk-tr-count': bookCount = Number(el.dataset.v) || 3; render(); return true;
    case 'dk-tr-show': show = el.dataset.v as typeof show; render(); return true;
    case 'dk-pick-toggle': picking = !picking; render(); return true;
    case 'dk-pick': if (picked.has(el.dataset.id!)) picked.delete(el.dataset.id!); else picked.add(el.dataset.id!); render(); return true;
    case 'dk-pick-clear': picked.clear(); render(); return true;
    case 'dk-tr-week':
      busy = true; render();
      try { toast(`🗓️ ${t('desk.tr.weekAdded', { n: await addWeek() })}`); } catch (e) { toast(authErr(e)); }
      busy = false; reset(); render(); return true;
    case 'dk-tr-book': case 'dk-tr-book-picked': {
      const who = act === 'dk-tr-book-picked' ? [...picked] : null;
      busy = true; render();
      try {
        const k = await api.simBook(who ? who.length : bookCount, who);
        toast(`🎮 ${t('desk.tr.booked', { n: k })}`);
        picked.clear();
      } catch (e) { toast(authErr(e)); }
      busy = false; reset(); render(); return true;
    }
    case 'dk-tr-clear':
      busy = true; render();
      try { toast(`🧹 ${t('desk.sim.cleared', { n: await api.simClear('trainer') })}`); } catch (e) { toast(authErr(e)); }
      busy = false; reset(); render(); return true;
    case 'dk-tr-cancel':
      try { await content.cancelBooking(el.dataset.id!); toast(t('desk.tr.cancelled')); } catch (e) { toast(authErr(e)); }
      reset(); render(); return true;
  }
  return false;
}

export async function onChange(el: HTMLInputElement): Promise<boolean> {
  if (el.dataset.act !== 'dk-paid' || el.dataset.kind !== 'booking') return false;
  const b = bookings?.find((x) => x.id === el.dataset.id);
  try {
    await api.setBookingPaid(el.dataset.id!, el.checked);
    if (b) b.paid = el.checked;
  } catch (e) { toast(authErr(e)); el.checked = !el.checked; }
  render();
  return true;
}
