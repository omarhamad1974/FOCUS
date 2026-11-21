/** Small building blocks shared by the role tools. */
import { t, type MessageKey } from '../i18n/ar';
import { money, n } from '../app/ctx';
import { icon } from '../ui/icons';
import { avatar, esc } from '../ui/util';
import type { PayTotals } from '../domain/payments';
import { simPlayers, simPlayersNow, type SimPlayer } from './api';
import { authErr, render } from '../app/ctx';
import { toast } from '../ui/util';

export const tip = (key: MessageKey) => `<p class="hint">${esc(t(key))}</p>`;

/** Totals strip: to collect, collected, still due, with a progress bar. */
export function payBox(tt: PayTotals, unit: MessageKey = 'desk.pay.people'): string {
  const pct = tt.total ? Math.round((tt.collected / tt.total) * 100) : 0;
  return `<div class="pay-box">
    <div class="pay-cell"><small>${t('desk.pay.total')}</small><b>${money(tt.total)}</b></div>
    <div class="pay-cell ok"><small>${t('desk.pay.collected')}</small><b>${money(tt.collected)}</b></div>
    <div class="pay-cell due"><small>${t('desk.pay.due')}</small><b>${money(tt.due)}</b></div>
    <div class="pay-bar" title="${pct}%"><span style="width:${pct}%"></span></div>
    <small class="muted pay-count">${t('desk.pay.count', { paid: n(tt.paidCount), all: n(tt.count) })} ${t(unit)}</small>
  </div>`;
}

/** The "paid" tick for one line. */
export function paidTick(kind: 'fee' | 'booking' | 'order', id: string, paid: boolean, extra = ''): string {
  return `<label class="paid-tick ${paid ? 'on' : ''}" title="${esc(t('desk.pay.tickTip'))}">
    <input type="checkbox" data-act="dk-paid" data-kind="${kind}" data-id="${esc(id)}" ${extra} ${paid ? 'checked' : ''}>
    <span>${paid ? `${icon('check', 14)} ${t('desk.pay.paid')}` : t('desk.pay.unpaid')}</span></label>`;
}

/** Row of count buttons (1, 4, 8…) for a simulation. */
export function countChips(act: string, options: number[], current: number): string {
  return `<div class="choice sim-counts">${options.map((c) =>
    `<button data-act="${act}" data-v="${c}" aria-pressed="${current === c}">${n(c)}</button>`).join('')}</div>`;
}

export function simAvatar(p: SimPlayer | undefined, fallback = '?'): string {
  return avatar(p?.full_name ?? fallback, p?.avatar_url, p?.gender);
}

/**
 * The 40 demo players as a photo grid to pick from. `taken` players are shown
 * faded (already joined, booked…). Picked ones get a green tick.
 */
export function playerGrid(picked: Set<string>, taken: Set<string> = new Set()): string {
  const all = simPlayersNow();
  if (!all) return `<p class="muted"><span class="spin"></span> ${t('reg.loading')}</p>`;
  if (!all.length) return `<p class="err">${t('desk.sim.noPlayers')}</p>`;
  return `<div class="pick-grid">${all.map((p) => {
    const off = taken.has(p.id);
    const on = picked.has(p.id);
    return `<button class="pick ${on ? 'on' : ''}" data-act="dk-pick" data-id="${p.id}" ${off ? 'disabled' : ''} aria-pressed="${on}" title="${esc(p.full_name)}">
      ${simAvatar(p)}<span dir="auto">${esc(p.full_name.split(' ')[0])}</span>${on ? `<i class="pick-ok">${icon('check', 14)}</i>` : ''}</button>`;
  }).join('')}</div>`;
}

/** A person line: photo, name, small details, then actions at the end. */
export function personLine(photo: string, name: string, sub: string, end = '', cls = ''): string {
  return `<div class="dk-line ${cls}">${photo}<span class="dk-who"><b dir="auto">${esc(name)}</b>${sub ? `<small class="muted" dir="auto">${sub}</small>` : ''}</span>
    <span class="dk-end">${end}</span></div>`;
}

/** Numbered steps across the top of a workflow; `active` is 0-based. */
export function stepper(labels: MessageKey[], active: number): string {
  return `<ol class="dk-steps">${labels.map((l, i) => `<li class="${i < active ? 'done' : i === active ? 'now' : ''}">
    <span class="dk-dot">${i < active ? '✓' : n(i + 1)}</span><span>${t(l)}</span></li>`).join('')}</ol>`;
}

export function statTile(ic: string, value: string, label: MessageKey, hot = false): string {
  return `<div class="stat ${hot ? 'hot' : ''}">${icon(ic, 22)}<b>${value}</b><small>${t(label)}</small></div>`;
}

/** Random sample of `count` items. */
export function sample<T>(list: T[], count: number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, count);
}

let simAsked = false;
/** Load the 40 demo players once (for the photo pickers), then draw again. */
export function ensureSim(): void {
  if (simAsked || simPlayersNow()) return;
  simAsked = true;
  simPlayers().then(() => render(), (e) => { simAsked = false; toast(authErr(e)); });
}
