/** Training: trainers publish one-hour slots at their locations; players book online. */
import { t, type MessageKey } from '../i18n/ar';
import * as content from '../data/content';
import type { Booking, Location, PublicProfile, Slot } from '../data/content';
import { authErr, hint, isTrainer, loading, money, n, needLogin, render, session, val } from '../app/ctx';
import { empty, skeleton } from '../ui/art';
import { icon } from '../ui/icons';
import { avatarOf, esc, toast } from '../ui/util';
import { byDay, dayKey, slotEnd, slotStarts } from '../domain/training';
import { becomePrompt } from './shop';

const timeFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
const dayShort = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'short' });
const dayNum = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' });
const WEEKDAYS = [6, 0, 1, 2, 3, 4, 5]; // Saturday first, as on Egyptian calendars

let trainers: PublicProfile[] | null = null;
let locations: Location[] | null = null;
let slots: Slot[] | null = null;
let busy = false;

let pickDay = '';
let picking: string | null = null; // slot being booked
let who: string | 'all' = 'all';

let myBk: Booking[] | null = null;
let myBkSlots: Slot[] = [];
let trainerBk: Booking[] | null = null;
let trainees = new Map<string, { full_name: string; phone: string | null }>();

const gen = { days: [] as number[], hours: [] as number[], weeks: 4 };

export function load(force = false): void {
  if (busy || (slots && !force)) return;
  busy = true;
  Promise.all([content.trainers(), content.listLocations(), content.listSlots()])
    .then(([tr, l, s]) => { trainers = tr; locations = l; slots = s; })
    .catch((e) => { trainers = []; locations = []; slots = []; toast(authErr(e)); })
    .finally(() => { busy = false; render(); });
}

export function reset(): void { slots = null; myBk = null; trainerBk = null; }

const at = (s: Slot) => new Date(s.starts_at);
const future = (s: Slot) => at(s) > new Date();
const loc = (id: string) => locations?.find((l) => l.id === id);
const range = (s: Slot) => `${timeFmt.format(at(s))} – ${timeFmt.format(slotEnd(at(s)))}`;

/** Upcoming free slots, soonest first (used on the home page too). */
export const openSlots = (count: number): Slot[] | null => slots && slots.filter((s) => !s.booked && future(s)).slice(0, count);
export const trainerName = (id: string) => content.personName(id);

export function slotCard(s: Slot, showTrainer = true): string {
  const l = loc(s.location_id);
  return `<button class="slot ${s.booked ? 'taken' : ''} ${picking === s.id ? 'on' : ''}" data-act="tr-pick" data-id="${s.id}" ${s.booked || !future(s) ? 'disabled' : ''}>
    <span class="slot-time">${icon('clock', 16)} ${range(s)}</span>
    ${showTrainer ? `<span class="small" dir="auto">${icon('coach', 14)} ${esc(trainerName(s.trainer_id))}</span>` : ''}
    ${l ? `<span class="small muted" dir="auto">${icon('pin', 14)} ${esc(l.name)}</span>` : ''}
    <span class="slot-price">${s.booked ? t('tr.taken') : s.price ? money(s.price) : t('tr.free')}</span>
  </button>`;
}

function bookPanel(s: Slot): string {
  const l = loc(s.location_id);
  if (!session.profile) return `<div class="card sheet rise">${needLogin('tr.loginToBook')}</div>`;
  if (s.trainer_id === session.profile.id) return `<div class="card sheet rise"><p class="muted">${t('tr.ownSlot')}</p></div>`;
  return `<form class="card sheet rise" data-form="tr-book" data-id="${s.id}" novalidate>
    <h3>${icon('calendar', 20)} ${t('tr.confirmTitle')}</h3>
    <div class="facts">
      <span>${icon('coach', 16)} <b dir="auto">${esc(trainerName(s.trainer_id))}</b></span>
      <span>${icon('calendar', 16)} ${dayFmt.format(at(s))}</span>
      <span>${icon('clock', 16)} ${range(s)}</span>
      ${l ? `<span dir="auto">${icon('pin', 16)} ${esc(l.name)}${l.address ? ` · ${esc(l.address)}` : ''}</span>` : ''}
      <span>${icon('money', 16)} ${s.price ? money(s.price) : t('tr.free')}</span>
    </div>
    <label class="field"><span>${t('tr.note')}</span><input class="input" id="bNote" dir="auto" placeholder="${esc(t('tr.notePh'))}"></label>
    <div class="row"><button class="btn green" type="submit">${icon('check')} ${t('tr.book')}</button>
      <button type="button" class="btn ghost" data-act="tr-pick" data-id="">${t('common.cancel')}</button></div>
    ${hint('tr.payHint')}
  </form>`;
}

function banner(): string {
  return `<section class="banner b-train">
    <div><h1>${icon('coach', 28)} ${t('tr.title')}</h1><p>${t('tr.tagline')}</p></div>
    ${isTrainer() ? `<a class="btn gold" href="#/training/manage">${icon('calendar')} ${t('tr.manage')}</a>` : ''}
  </section>`;
}

function trainerCard(tr: PublicProfile): string {
  const free = (slots ?? []).filter((s) => s.trainer_id === tr.id && !s.booked && future(s)).length;
  const locs = (locations ?? []).filter((l) => l.trainer_id === tr.id);
  return `<a class="card trainer rise" href="#/training/t/${tr.id}">
    <div class="row">${avatarOf(tr)}<div><h3 dir="auto">${esc(tr.full_name)}</h3>${tr.club ? `<span class="muted small" dir="auto">${esc(tr.club)}</span>` : ''}</div>
      <span class="badge ${free ? 'green' : ''}" style="margin-inline-start:auto">${free ? t('tr.freeCount', { n: free }) : t('tr.full')}</span></div>
    ${tr.bio ? `<p class="small clamp" dir="auto">${esc(tr.bio)}</p>` : ''}
    ${locs.length ? `<div class="row small muted">${locs.map((l) => `<span dir="auto">${icon('pin', 14)} ${esc(l.name)}</span>`).join('')}</div>` : ''}
  </a>`;
}

/** Day strip + slots of the chosen day. */
function dayPicker(list: Slot[], showTrainer: boolean): string {
  const days = byDay(list.filter(future), at);
  if (!days.length) return empty('calendar', t('tr.noSlots'));
  if (!days.some(([k]) => k === pickDay)) pickDay = days.find(([, xs]) => xs.some((s) => !s.booked))?.[0] ?? days[0][0];
  const today = dayKey(new Date());
  const chosen = days.find(([k]) => k === pickDay)![1];
  const picked = chosen.find((s) => s.id === picking);
  return `<div class="days">${days.map(([k, xs]) => {
    const d = new Date(`${k}T12:00:00`);
    const free = xs.filter((s) => !s.booked).length;
    return `<button class="day ${k === pickDay ? 'on' : ''} ${free ? '' : 'full'}" data-act="tr-day" data-v="${k}">
      <small>${k === today ? t('tr.today') : dayShort.format(d)}</small><b>${dayNum.format(d)}</b><i>${n(free)}</i></button>`;
  }).join('')}</div>
  <h3 class="sec">${dayFmt.format(new Date(`${pickDay}T12:00:00`))}</h3>
  <div class="slots">${chosen.map((s) => slotCard(s, showTrainer)).join('')}</div>
  ${picked ? bookPanel(picked) : ''}`;
}

function listPage(): string {
  if (!slots || !trainers) { load(); return banner() + skeleton(3); }
  const shown = slots.filter((s) => who === 'all' || s.trainer_id === who);
  return `${banner()}
  ${hint('tr.howTo')}
  ${trainers.length ? `<h2 class="sec">${icon('users', 22)} ${t('tr.trainers')}</h2><div class="grid">${trainers.map(trainerCard).join('')}</div>` : ''}
  <h2 class="sec">${icon('calendar', 22)} ${t('tr.available')}</h2>
  ${trainers.length > 1 ? `<div class="chips-row"><button class="pill ${who === 'all' ? 'on' : ''}" data-act="tr-who" data-v="all">${t('news.all')}</button>
    ${trainers.map((tr) => `<button class="pill ${who === tr.id ? 'on' : ''}" data-act="tr-who" data-v="${tr.id}" dir="auto">${esc(tr.full_name)}</button>`).join('')}</div>` : ''}
  ${dayPicker(shown, true)}`;
}

function trainerPage(id: string): string {
  if (!slots || !trainers) { load(); return loading(); }
  const tr = trainers.find((x) => x.id === id);
  if (!tr) return empty('coach', t('tr.notFound'), `<a class="btn" href="#/training">${t('tr.back')}</a>`);
  const locs = (locations ?? []).filter((l) => l.trainer_id === id);
  return `<a class="backlink" href="#/training">${icon('back', 18)} ${t('tr.back')}</a>
  <section class="banner b-train slim rise"><div class="row">${avatarOf(tr)}<div><h1 dir="auto">${esc(tr.full_name)}</h1>
    ${tr.club ? `<p dir="auto">${esc(tr.club)}</p>` : ''}</div></div></section>
  ${tr.bio ? `<div class="card"><p dir="auto">${esc(tr.bio)}</p></div>` : ''}
  ${locs.length ? `<div class="card"><h3>${icon('map', 20)} ${t('tr.locations')}</h3>${locs.map((l) => locRow(l)).join('')}</div>` : ''}
  <h2 class="sec">${icon('calendar', 22)} ${t('tr.available')}</h2>
  ${dayPicker(slots.filter((s) => s.trainer_id === id), false)}`;
}

function locRow(l: Location, removable = false): string {
  return `<div class="loc"><span class="loc-ic">${icon('pin', 18)}</span><div><b dir="auto">${esc(l.name)}</b>${l.address ? `<br><span class="muted small" dir="auto">${esc(l.address)}</span>` : ''}</div>
    <span class="row" style="margin-inline-start:auto">${l.map_url ? `<a class="btn soft small" href="${esc(l.map_url)}" target="_blank" rel="noopener">${icon('map', 16)} ${t('tr.map')}</a>` : ''}
    ${removable ? `<button class="btn ghost small" data-act="tr-loc-del" data-id="${l.id}" aria-label="${esc(t('news.delete'))}">${icon('trash', 16)}</button>` : ''}</span></div>`;
}

function loadTrainerBookings(): void {
  trainerBk = [];
  Promise.all([content.trainerBookings(), content.myTrainees()])
    .then(([b, tn]) => { trainerBk = b; trainees = tn; })
    .catch((e) => toast(authErr(e)))
    .finally(render);
}

function managePage(): string {
  if (!session.profile) return needLogin('tr.loginToTrain');
  if (!isTrainer()) return becomePrompt('trainer');
  if (!slots || !locations) { load(); return loading(); }
  if (trainerBk === null) { loadTrainerBookings(); return loading(); }
  const me = session.profile.id;
  const mySlots = slots.filter((s) => s.trainer_id === me && future(s));
  const myLocs = locations.filter((l) => l.trainer_id === me);
  const booked = trainerBk.map((b) => ({ b, s: slots!.find((s) => s.id === b.slot_id) })).filter((x) => x.s && future(x.s))
    .sort((a, b) => at(a.s!).getTime() - at(b.s!).getTime());
  const week = Date.now() + 7 * 86_400_000;
  const income = booked.filter((x) => at(x.s!).getTime() < week).reduce((s, x) => s + x.s!.price, 0);
  const from = dayKey(new Date());
  const hours = Array.from({ length: 18 }, (_, i) => i + 6);
  const preview = gen.days.length && gen.hours.length ? slotStarts({ from: val('gFrom') || from, weeks: gen.weeks, days: gen.days, hours: gen.hours }).length : 0;
  return `<a class="backlink" href="#/training">${icon('back', 18)} ${t('tr.back')}</a>
  <section class="banner b-train slim"><div><h1>${icon('calendar', 26)} ${t('tr.manage')}</h1><p>${t('tr.manageHint')}</p></div></section>
  <div class="stats">
    <div class="stat">${icon('calendar', 22)}<b>${n(mySlots.filter((s) => !s.booked).length)}</b><small>${t('tr.statFree')}</small></div>
    <div class="stat ${booked.length ? 'hot' : ''}">${icon('users', 22)}<b>${n(booked.length)}</b><small>${t('tr.statBooked')}</small></div>
    <div class="stat">${icon('money', 22)}<b>${money(income)}</b><small>${t('tr.statWeek')}</small></div>
  </div>
  <div class="card"><h2>${icon('users', 22)} ${t('tr.bookings')}</h2>
    ${booked.length ? booked.map(({ b, s }) => {
      const p = trainees.get(b.id);
      const l = loc(s!.location_id);
      return `<div class="order"><div class="row between"><b>${dayFmt.format(at(s!))} · ${range(s!)}</b><span class="badge green">${t('tr.bookedBadge')}</span></div>
        <div class="row small muted">${p ? `<span dir="auto">${icon('user', 14)} ${esc(p.full_name)}</span>${p.phone ? `<a href="tel:${esc(p.phone)}" dir="ltr">${icon('phone', 14)} ${esc(p.phone)}</a>` : ''}` : ''}
          ${l ? `<span dir="auto">${icon('pin', 14)} ${esc(l.name)}</span>` : ''}</div>
        ${b.note ? `<p class="small" dir="auto">💬 ${esc(b.note)}</p>` : ''}
        <button class="btn ghost small" data-act="tr-cancel" data-id="${b.id}">${icon('x', 16)} ${t('tr.cancelBooking')}</button></div>`;
    }).join('') : `<p class="muted">${t('tr.noBookings')}</p>`}</div>
  <div class="card"><h2>${icon('map', 22)} ${t('tr.myLocations')}</h2>${hint('tr.locHint')}
    ${myLocs.map((l) => locRow(l, true)).join('')}
    <form data-form="tr-loc" novalidate class="row" style="align-items:flex-end">
      <label class="field" style="flex:2;min-width:160px"><span>${t('tr.locName')}</span><input class="input" id="lName" dir="auto" placeholder="${esc(t('tr.locNamePh'))}"></label>
      <label class="field" style="flex:2;min-width:160px"><span>${t('tr.locAddress')}</span><input class="input" id="lAddr" dir="auto"></label>
      <label class="field" style="flex:2;min-width:160px"><span>${t('tr.locMap')}</span><input class="input" id="lMap" dir="ltr" placeholder="https://maps.google.com/…"></label>
      <button class="btn" type="submit" style="margin-block-end:10px">${icon('plus')} ${t('tr.addLoc')}</button>
    </form></div>
  <div class="card"><h2>${icon('plus', 22)} ${t('tr.addSlots')}</h2>${hint('tr.genHint')}
    ${myLocs.length ? `<form data-form="tr-gen" novalidate>
      <div class="row">
        <label class="field" style="flex:2;min-width:160px"><span>${t('tr.location')}</span><select class="input" id="gLoc">${myLocs.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></label>
        <label class="field" style="flex:1;min-width:130px"><span>${t('tr.from')}</span><input class="input" id="gFrom" type="date" value="${esc(val('gFrom') || from)}" min="${from}" dir="ltr"></label>
        <label class="field" style="flex:1;min-width:110px"><span>${t('tr.weeks')}</span><select class="input" id="gWeeks" data-act="tr-weeks">${[1, 2, 3, 4, 6, 8, 12].map((w) => `<option value="${w}" ${w === gen.weeks ? 'selected' : ''}>${n(w)}</option>`).join('')}</select></label>
        <label class="field" style="flex:1;min-width:110px"><span>${t('tr.price')}</span><input class="input" id="gPrice" inputmode="decimal" dir="ltr" value="${esc(val('gPrice'))}" placeholder="0"></label>
      </div>
      <span class="lbl">${t('tr.days')}</span>
      <div class="toggles">${WEEKDAYS.map((d) => `<button type="button" class="tog ${gen.days.includes(d) ? 'on' : ''}" data-act="tr-gday" data-v="${d}">${t(`tr.wd.${d}` as MessageKey)}</button>`).join('')}</div>
      <span class="lbl">${t('tr.hours')}</span>
      <div class="toggles hours">${hours.map((h) => `<button type="button" class="tog ${gen.hours.includes(h) ? 'on' : ''}" data-act="tr-ghour" data-v="${h}">${timeFmt.format(new Date(2026, 0, 1, h))}</button>`).join('')}</div>
      <button class="btn green block" type="submit" ${preview ? '' : 'disabled'}>${icon('calendar')} ${preview ? t('tr.genButton', { n: preview }) : t('tr.genPick')}</button>
    </form>` : `<p class="muted">${t('tr.needLoc')}</p>`}</div>
  <div class="card"><h2>${icon('clock', 22)} ${t('tr.mySlots')}</h2>
    ${mySlots.length ? byDay(mySlots, at).map(([k, xs]) => `<h4 class="dayhead">${dayFmt.format(new Date(`${k}T12:00:00`))}</h4>
      <div class="slots">${xs.map((s) => `<div class="slot mini ${s.booked ? 'taken' : ''}"><span class="slot-time">${icon('clock', 16)} ${range(s)}</span>
        <span class="small muted" dir="auto">${esc(loc(s.location_id)?.name ?? '')}</span>
        ${s.booked ? `<span class="slot-price">${t('tr.bookedBadge')}</span>` : `<button class="btn ghost small" data-act="tr-slot-del" data-id="${s.id}" aria-label="${esc(t('news.delete'))}">${icon('trash', 14)}</button>`}</div>`).join('')}</div>`).join('')
      : `<p class="muted">${t('tr.noSlotsYet')}</p>`}</div>`;
}

/** Player's upcoming bookings, for the account page. */
export function myBookingsCard(): string {
  if (myBk === null) {
    myBk = [];
    content.myBookings()
      .then(async (b) => {
        myBk = b;
        myBkSlots = await content.slotsById(b.map((x) => x.slot_id));
        await content.people(b.map((x) => x.trainer_id));
        if (!locations) locations = await content.listLocations();
      })
      .catch(() => undefined).finally(render);
    return '';
  }
  const rows = myBk.map((b) => ({ b, s: myBkSlots.find((s) => s.id === b.slot_id) })).filter((x) => x.s && future(x.s));
  if (!rows.length) return '';
  return `<div class="card"><h3>${icon('calendar', 20)} ${t('tr.myBookings')}</h3>${rows.map(({ b, s }) => `<div class="order">
    <div class="row between"><b>${dayFmt.format(at(s!))} · ${range(s!)}</b><span class="badge green">${t('tr.bookedBadge')}</span></div>
    <div class="row small muted"><span dir="auto">${icon('coach', 14)} ${esc(trainerName(b.trainer_id))}</span>${loc(s!.location_id) ? `<span dir="auto">${icon('pin', 14)} ${esc(loc(s!.location_id)!.name)}</span>` : ''}
      <span>${s!.price ? money(s!.price) : t('tr.free')}</span></div>
    <button class="btn ghost small" data-act="tr-cancel" data-id="${b.id}">${icon('x', 16)} ${t('tr.cancelBooking')}</button></div>`).join('')}</div>`;
}

export function route(parts: string[]): string | null {
  if (parts[0] !== 'training') return null;
  if (parts[1] === 'manage') return managePage();
  if (parts[1] === 't' && parts[2]) return trainerPage(parts[2]);
  return listPage();
}

const toggle = (list: number[], v: number) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Keep the generator's typed fields across re-renders. */
function keepGen(): () => void {
  const vals: Record<string, string> = {};
  for (const id of ['gLoc', 'gFrom', 'gPrice']) vals[id] = (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';
  return () => { for (const [id, v] of Object.entries(vals)) { const f = document.getElementById(id) as HTMLInputElement | null; if (f && v) f.value = v; } };
}

export async function onClick(act: string, el: HTMLElement): Promise<boolean> {
  switch (act) {
    case 'tr-day': pickDay = el.dataset.v!; picking = null; render(); return true;
    case 'tr-who': who = el.dataset.v!; picking = null; render(); return true;
    case 'tr-pick':
      picking = el.dataset.id || null; render();
      if (picking) document.querySelector('.sheet')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    case 'tr-gday': case 'tr-ghour': {
      const back = keepGen();
      if (act === 'tr-gday') gen.days = toggle(gen.days, Number(el.dataset.v));
      else gen.hours = toggle(gen.hours, Number(el.dataset.v));
      render(); back();
      return true;
    }
    case 'tr-cancel': {
      if (el.dataset.armed !== '1') { el.dataset.armed = '1'; el.innerHTML = `${icon('x', 16)} ${t('tr.cancelConfirm')}`; return true; }
      try { await content.cancelBooking(el.dataset.id!); toast(t('tr.cancelled')); } catch (e) { toast(authErr(e)); }
      slots = null; myBk = null; trainerBk = null; render(); return true;
    }
    case 'tr-slot-del':
      try { await content.deleteSlot(el.dataset.id!); slots = slots?.filter((s) => s.id !== el.dataset.id) ?? null; } catch (e) { toast(authErr(e)); }
      render(); return true;
    case 'tr-loc-del':
      if (el.dataset.armed !== '1') { el.dataset.armed = '1'; el.innerHTML = `${icon('trash', 16)} ${t('tr.locDelConfirm')}`; return true; }
      try { await content.deleteLocation(el.dataset.id!); locations = locations?.filter((l) => l.id !== el.dataset.id) ?? null; slots = null; } catch (e) { toast(authErr(e)); }
      render(); return true;
  }
  return false;
}

export function onChange(el: HTMLInputElement): boolean {
  if (el.dataset.act !== 'tr-weeks') return false;
  gen.weeks = Number(el.value);
  const back = keepGen(); render(); back();
  return true;
}

export async function onSubmit(kind: string, form: HTMLFormElement): Promise<boolean> {
  if (kind === 'tr-book') {
    try {
      await content.bookSlot(form.dataset.id!, val('bNote'));
      toast(`✅ ${t('tr.booked')}`);
      picking = null; slots = null; myBk = null;
      location.hash = '#/me';
    } catch (e) { toast(authErr(e)); slots = null; render(); }
    return true;
  }
  if (kind === 'tr-loc') {
    const name = val('lName');
    if (!name) { toast(t('tr.needLocName')); return true; }
    const map = val('lMap');
    try {
      const l = await content.saveLocation({ name, address: val('lAddr') || null, map_url: /^https?:\/\//.test(map) ? map : null });
      locations = [...(locations ?? []), l];
      toast(t('settings.saved'));
    } catch (e) { toast(authErr(e)); }
    render(); return true;
  }
  if (kind === 'tr-gen') {
    const starts = slotStarts({ from: val('gFrom'), weeks: gen.weeks, days: gen.days, hours: gen.hours });
    const price = Number(val('gPrice').replace(',', '.')) || 0;
    const locId = val('gLoc');
    try {
      const added = await content.addSlots(starts.map((d) => ({ location_id: locId, starts_at: d.toISOString(), price, note: null })));
      toast(`✅ ${t('tr.added', { n: added })}${added < starts.length ? ` · ${t('tr.skipped', { n: starts.length - added })}` : ''}`);
      gen.days = []; gen.hours = [];
      slots = null;
    } catch (e) { toast(authErr(e)); }
    render(); return true;
  }
  return false;
}

