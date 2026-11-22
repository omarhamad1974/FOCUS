/**
 * "How players pay me" card on the front page of each provider's tool (organizer, trainer,
 * seller, hall owner): wallet / InstaPay / Fawry numbers, cash on the spot, a WhatsApp number,
 * and for organizers and hall owners the cancel / withdraw deadline.
 */
import { t } from '../i18n/ar';
import { authErr, n, render, session, val } from '../app/ctx';
import * as pay from '../data/pay';
import type { PaySettings, Wallet, WalletKind } from '../data/pay';
import { icon } from '../ui/icons';
import { esc, toast } from '../ui/util';
import { methodsLine, walletName } from '../ui/pay';
import { tip } from './ui';
import type { DeskRole } from './shell';

let mine: PaySettings | null | undefined;
let loading = false;
let open = false;
let busy = false;
let rows: Wallet[] = [];

export function reset(): void { mine = undefined; open = false; }

function load(): void {
  const me = session.profile?.id;
  if (!me || loading) return;
  loading = true;
  pay.settingsOf([me]).then((m) => { mine = m.get(me) ?? null; }).catch(() => { mine = null; }).finally(() => { loading = false; render(); });
}

const HOURS = [0, 2, 6, 12, 24, 48, 72];

export function card(role: DeskRole): string {
  if (role === 'admin') return '';
  if (mine === undefined) { load(); return ''; }
  const s = mine ?? pay.defaultSettings(session.profile!.id);
  const deadline = role === 'org' || role === 'hall';
  const summary = `<div class="ps-sum">
    <span class="badge blue">${icon('wallet', 14)} ${esc(methodsLine(mine))}</span>
    ${s.whatsapp ? `<span class="badge green">${icon('whatsapp', 14)} <span dir="ltr">${esc(s.whatsapp)}</span></span>` : `<span class="badge gold">${icon('whatsapp', 14)} ${t('ps.noWa')}</span>`}
    ${deadline ? `<span class="badge">${icon('clock', 14)} ${s.cancel_hours == null ? t('ps.anyTime') : t('ps.hoursBefore', { n: n(s.cancel_hours) })}</span>` : ''}</div>`;
  if (!open) {
    return `<div class="card dk-ps"><div class="row between"><h2>💳 ${t('ps.title')}</h2>
      <button class="btn soft small" data-act="dk-ps-open">${icon('edit', 14)} ${t(mine ? 'ps.edit' : 'ps.setup')}</button></div>
      ${tip(deadline ? 'ps.hintDeadline' : 'ps.hint')}${summary}
      ${!mine ? `<p class="sub-msg">${t('ps.notSet')}</p>` : ''}</div>`;
  }
  return `<form class="card dk-ps rise" data-form="dk-ps-save">
    <h2>💳 ${t('ps.title')}</h2>${tip('ps.formHint')}
    <label class="row"><input type="checkbox" id="psWallet" ${s.accepts_wallet ? 'checked' : ''}> 📱 ${t('ps.wallet')}</label>
    <div class="ps-wallets">${rows.map((w, i) => `<div class="row ps-wrow">
      <select class="input" id="psKind${i}" style="max-width:170px">${pay.WALLET_KINDS.map((k) => `<option value="${k}" ${w.kind === k ? 'selected' : ''}>${walletName(k)}</option>`).join('')}</select>
      <input class="input" id="psNum${i}" dir="ltr" inputmode="tel" placeholder="${esc(t('ps.numberPh'))}" value="${esc(w.number)}" style="max-width:170px">
      <input class="input" id="psLabel${i}" dir="auto" placeholder="${esc(t('ps.labelPh'))}" value="${esc(w.label ?? '')}" style="max-width:200px">
      <button type="button" class="btn ghost small" data-act="dk-ps-del" data-i="${i}" title="${esc(t('ps.remove'))}">${icon('x', 14)}</button></div>`).join('')}
      ${rows.length < 6 ? `<button type="button" class="btn soft small" data-act="dk-ps-add">${icon('plus', 14)} ${t('ps.addNumber')}</button>` : ''}</div>
    <p class="hint">${t('ps.walletHint')}</p>
    <label class="row"><input type="checkbox" id="psCash" ${s.accepts_cash ? 'checked' : ''}> 💵 ${t('ps.cash')}</label>
    <label class="field"><span>${icon('whatsapp', 16)} ${t('ps.whatsapp')}</span>
      <input class="input" id="psWa" dir="ltr" inputmode="tel" placeholder="01001234567" value="${esc(s.whatsapp ?? '')}" style="max-width:220px"></label>
    <p class="hint">${t('ps.whatsappHint')}</p>
    ${deadline ? `<label class="field"><span>${icon('clock', 16)} ${t(role === 'hall' ? 'ps.cancelHall' : 'ps.cancelOrg')}</span>
      <select class="input" id="psHours" style="max-width:260px"><option value="">${t('ps.anyTime')}</option>
      ${[...new Set([...HOURS, ...(s.cancel_hours != null ? [s.cancel_hours] : [])])].sort((a, b) => a - b).map((h) => `<option value="${h}" ${s.cancel_hours === h ? 'selected' : ''}>${h === 0 ? t('ps.untilStart') : t('ps.hoursBefore', { n: n(h) })}</option>`).join('')}</select></label>
      <p class="hint">${t('ps.cancelHint')}</p>` : ''}
    <label class="field"><span>${t('ps.note')}</span><input class="input" id="psNote" dir="auto" maxlength="300" placeholder="${esc(t('ps.notePh'))}" value="${esc(s.note ?? '')}"></label>
    <div class="row"><button class="btn green" type="submit" ${busy ? 'disabled' : ''}>${icon('check')} ${t('desk.save')}</button>
      <button class="btn ghost" type="button" data-act="dk-ps-open">${t('common.cancel')}</button></div>
  </form>`;
}

/** Keep what was typed in the wallet rows before drawing again. */
function keepRows(): void {
  rows = rows.map((w, i) => document.getElementById(`psNum${i}`) ? {
    kind: (val(`psKind${i}`) || w.kind) as WalletKind, number: val(`psNum${i}`), label: val(`psLabel${i}`) || undefined,
  } : w);
}

export async function onClick(act: string, el: HTMLElement): Promise<boolean> {
  switch (act) {
    case 'dk-ps-open':
      open = !open;
      rows = open ? [...(mine?.wallets ?? [])].map((w) => ({ ...w })) : [];
      if (open && !rows.length) rows.push({ kind: 'instapay', number: '' });
      render(); return true;
    case 'dk-ps-add': keepRows(); rows.push({ kind: 'vodafone', number: '' }); render(); return true;
    case 'dk-ps-del': keepRows(); rows.splice(Number(el.dataset.i), 1); render(); return true;
  }
  return false;
}

export async function onSubmit(kind: string): Promise<boolean> {
  if (kind !== 'dk-ps-save') return false;
  keepRows();
  const wallets = rows.map((w) => ({ ...w, number: w.number.replace(/[^\d+]/g, '') })).filter((w) => w.number.length >= 5);
  const checked = (id: string) => !!(document.getElementById(id) as HTMLInputElement | null)?.checked;
  const hours = document.getElementById('psHours') ? val('psHours') : String(mine?.cancel_hours ?? '');
  const next = {
    accepts_wallet: checked('psWallet') && wallets.length > 0,
    accepts_cash: checked('psCash'),
    wallets,
    whatsapp: val('psWa').replace(/[^\d+]/g, '') || null,
    note: val('psNote') || null,
    cancel_hours: hours === '' ? null : Number(hours),
  };
  if (!next.accepts_wallet && !next.accepts_cash) { toast(t('ps.needOne')); return true; }
  if (checked('psWallet') && !wallets.length) { toast(t('ps.needNumber')); return true; }
  busy = true; render();
  try {
    await pay.saveSettings(next);
    mine = { user_id: session.profile!.id, ...next };
    open = false;
    toast(`✅ ${t('ps.saved')}`);
  } catch (e) { toast(authErr(e)); }
  busy = false; render();
  return true;
}
