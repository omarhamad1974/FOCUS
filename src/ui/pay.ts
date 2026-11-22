/**
 * Payment pieces shared by the public pages and the role tools:
 * - payerBox(): what a player sees after joining, booking or ordering: amount, the provider's
 *   methods (wallet numbers to copy, or cash on the spot), receipt upload and the review state.
 * - proof(): what a provider sees on a line: method, receipt viewer, approve / reject.
 * - waButton(): chat with the provider on WhatsApp.
 * Every data-act here starts with "pay-" (main.ts and the role tools hand them over).
 */
import { t, type MessageKey } from '../i18n/ar';
import { authErr, money, render } from '../app/ctx';
import * as pay from '../data/pay';
import type { Payment, PayKind, PaySettings } from '../data/pay';
import { icon } from './icons';
import { esc, toast } from './util';

const key = (kind: PayKind, ref: string) => `${kind}:${ref}`;
const cache = new Map<string, Payment | null>();
const draft = new Map<string, { method?: 'wallet' | 'cash'; wallet?: string; receipt?: string; busy?: boolean }>();
const listeners = new Set<() => void>();

/** Called after a payment changes (sent, approved, rejected) so pages can reload their lists. */
export function onPayChange(fn: () => void): void { listeners.add(fn); }
const changed = () => { for (const fn of listeners) fn(); render(); };

/** Load the payments of these refs into the cache (then draw again). */
export async function load(kind: PayKind, refs: string[]): Promise<void> {
  const missing = refs.filter((r) => !cache.has(key(kind, r)));
  if (!missing.length) return;
  const got = await pay.paymentsFor(kind, missing);
  for (const r of missing) cache.set(key(kind, r), got.get(r) ?? null);
}
export const get = (kind: PayKind, ref: string) => cache.get(key(kind, ref)) ?? undefined;
export const put = (p: Payment) => cache.set(key(p.kind, p.ref), p);
export function forget(kind?: PayKind): void {
  if (!kind) { cache.clear(); return; }
  for (const k of [...cache.keys()]) if (k.startsWith(`${kind}:`)) cache.delete(k);
}

/** Wallet kind as words (InstaPay, Vodafone Cash…). */
export const walletName = (k: string | null | undefined) => t(`pay.w.${k && (pay.WALLET_KINDS as string[]).includes(k) ? k : 'other'}` as MessageKey);

export function waButton(s: PaySettings | null | undefined, text: string, label: MessageKey = 'pay.waChat', cls = 'small'): string {
  const num = pay.waNumber(s?.whatsapp);
  if (!num) return '';
  return `<a class="btn wa ${cls}" target="_blank" rel="noopener" href="https://wa.me/${num}?text=${encodeURIComponent(text)}">${icon('whatsapp', 16)} ${t(label)}</a>`;
}

/** The provider's methods in one line, for cards and pages ("InstaPay · Vodafone Cash · cash"). */
export function methodsLine(s: PaySettings | null | undefined): string {
  const set = s ?? null;
  const parts: string[] = [];
  if (set?.accepts_wallet) for (const w of set.wallets) parts.push(walletName(w.kind));
  if (!set || set.accepts_cash) parts.push(t('pay.cash'));
  return [...new Set(parts)].join(' · ');
}

interface PayerOpts {
  kind: PayKind;
  ref: string;
  amount: number;
  settings: PaySettings | null | undefined;
  /** Already marked paid by the provider (without a payment row, e.g. cash ticked by hand). */
  paid?: boolean;
  /** Text for the WhatsApp message to the provider. */
  waText?: string;
  compact?: boolean;
}

/** The player's payment card for one item. */
export function payerBox(o: PayerOpts): string {
  if (!(o.amount > 0)) return '';
  const p = get(o.kind, o.ref);
  const k = key(o.kind, o.ref);
  const d = draft.get(k) ?? {};
  const s = o.settings ?? null;
  const wallets = s?.accepts_wallet ? s.wallets.filter((w) => w.number) : [];
  const cashOk = !s || s.accepts_cash;
  const wa = o.waText ? waButton(s, o.waText) : '';
  const head = `<div class="row between"><b>💳 ${t('pay.title')}</b><b class="pay-amt">${money(o.amount)}</b></div>`;
  if (o.paid || p?.status === 'approved') {
    return `<div class="pay-me ok">${head}<p class="pay-state">✅ ${t('pay.st.approved')}${p ? ` · ${p.method === 'cash' ? t('pay.cash') : walletName(p.wallet_kind)}` : ''}</p>${wa}</div>`;
  }
  const state = p?.status === 'pending'
    ? `<p class="pay-state wait">⏳ ${t(p.method === 'cash' ? 'pay.st.cashPending' : 'pay.st.pending')}${p.receipt_path ? ` · 🧾 ${t('pay.receiptSent')}` : ''}</p>`
    : p?.status === 'rejected' ? `<p class="pay-state bad">⚠️ ${t('pay.st.rejected')}</p>` : '';
  const open = !p || p.status === 'rejected' || d.method;
  if (!open) {
    return `<div class="pay-me">${head}${state}<div class="row"><button class="btn ghost small" data-act="pay-change" data-k="${esc(k)}" data-v="${wallets.length ? 'wallet' : 'cash'}">${icon('edit', 14)} ${t('pay.change')}</button>${wa}</div></div>`;
  }
  const method = d.method ?? (wallets.length ? 'wallet' : 'cash');
  const choice = `<div class="choice pay-choice">
    ${wallets.length ? `<button data-act="pay-method" data-k="${esc(k)}" data-v="wallet" aria-pressed="${method === 'wallet'}">📱 ${t('pay.byWallet')}</button>` : ''}
    ${cashOk ? `<button data-act="pay-method" data-k="${esc(k)}" data-v="cash" aria-pressed="${method === 'cash'}">💵 ${t('pay.byCash')}</button>` : ''}</div>`;
  const walletPart = method === 'wallet' && wallets.length ? `
    <p class="small">${t('pay.sendTo', { amount: money(o.amount) })}</p>
    <div class="pay-wallets">${wallets.map((w, i) => `<label class="pay-wallet ${(d.wallet ?? wallets[0].kind) === w.kind && (d.wallet || i === 0) ? 'on' : ''}">
      <input type="radio" name="pw-${esc(k)}" data-act="pay-wallet" data-k="${esc(k)}" value="${esc(w.kind)}" ${(d.wallet ? d.wallet === w.kind : i === 0) ? 'checked' : ''}>
      <span class="pw-kind">${walletName(w.kind)}${w.label ? ` <small class="muted" dir="auto">${esc(w.label)}</small>` : ''}</span>
      <b dir="ltr" class="pw-num">${esc(w.number)}</b>
      <button type="button" class="btn ghost small" data-act="pay-copy" data-v="${esc(w.number)}" title="${esc(t('pay.copy'))}">${icon('copy', 14)}</button></label>`).join('')}</div>
    <label class="btn soft small pay-up">${icon('image', 16)} ${t(d.receipt ? 'pay.receiptChange' : 'pay.receiptAdd')}
      <input type="file" accept="image/*" class="hidden" data-act="pay-receipt" data-k="${esc(k)}"></label>
    ${d.receipt ? `<span class="badge green">🧾 ${t('pay.receiptReady')}</span>` : `<span class="muted small">${t('pay.receiptHint')}</span>`}
    <button class="btn green block" data-act="pay-send" data-k="${esc(k)}" data-m="wallet" data-amount="${o.amount}" ${d.busy || !d.receipt ? 'disabled' : ''}>📤 ${t('pay.sendReceipt')}</button>`
    : `<p class="small">${t('pay.cashText')}</p>
    <button class="btn green block" data-act="pay-send" data-k="${esc(k)}" data-m="cash" ${d.busy ? 'disabled' : ''}>💵 ${t('pay.cashBtn')}</button>`;
  return `<div class="pay-me ${o.compact ? 'compact' : ''}">${head}${state}
    ${!wallets.length && !cashOk ? `<p class="muted small">${t('pay.noMethods')}</p>` : `${choice}${walletPart}`}
    ${s?.note ? `<p class="hint" dir="auto">${esc(s.note)}</p>` : ''}
    <div class="row">${wa}${d.method && p ? `<button class="btn ghost small" data-act="pay-change" data-k="${esc(k)}">${t('common.cancel')}</button>` : ''}</div></div>`;
}

/** Provider's view of one payment: method, receipt and approve / reject while it waits. */
export function proof(p: Payment | null | undefined): string {
  if (!p) return '';
  const m = p.method === 'cash' ? `💵 ${t('pay.cash')}` : `📱 ${walletName(p.wallet_kind)}`;
  const st = p.status === 'approved' ? '' : p.status === 'rejected' ? `<span class="badge red">${t('pay.rejected')}</span>`
    : `<span class="badge gold">${t(p.method === 'cash' ? 'pay.cashWaiting' : 'pay.review')}</span>`;
  return `<span class="pay-proof"><span class="badge blue">${m}</span>${st}
    ${p.receipt_path ? `<button class="btn soft small" data-act="pay-view" data-path="${esc(p.receipt_path)}">🧾 ${t('pay.seeReceipt')}</button>` : ''}
    ${p.status === 'pending' ? `<button class="btn green small" data-act="pay-ok" data-id="${p.id}" title="${esc(t('pay.approveTip'))}">${icon('check', 14)} ${t('pay.approve')}</button>
      <button class="btn ghost small" data-act="pay-no" data-id="${p.id}" title="${esc(t('pay.rejectTip'))}">${icon('x', 14)}</button>` : ''}</span>`;
}

/** Sort helper: paid first, then waiting payments with a receipt, then waiting cash, then nothing. */
export function priority(paid: boolean, p: Payment | null | undefined): number {
  if (paid || p?.status === 'approved') return 0;
  if (p?.status === 'pending') return p.receipt_path ? 1 : 2;
  return 3;
}

function showReceipt(url: string): void {
  document.querySelector('.receipt-view')?.remove();
  const box = document.createElement('div');
  box.className = 'receipt-view';
  box.innerHTML = `<div class="rv-inner"><button class="btn small soft rv-x" type="button" aria-label="${esc(t('common.close'))}">${icon('x', 16)} ${t('common.close')}</button>
    <img src="${esc(url)}" alt="${esc(t('pay.receipt'))}"></div>`;
  box.addEventListener('click', (e) => { if (e.target === box || (e.target as HTMLElement).closest('.rv-x')) box.remove(); });
  document.body.append(box);
}

function findByKey(k: string): { kind: PayKind; ref: string } {
  const i = k.indexOf(':');
  return { kind: k.slice(0, i) as PayKind, ref: k.slice(i + 1) };
}

export async function onClick(act: string, el: HTMLElement): Promise<boolean> {
  const k = el.dataset.k ?? '';
  switch (act) {
    case 'pay-method': draft.set(k, { ...draft.get(k), method: el.dataset.v as 'wallet' | 'cash' }); render(); return true;
    case 'pay-change': if (draft.get(k)?.method) draft.delete(k); else draft.set(k, { method: undefined });
      if (!draft.get(k)?.method && draft.has(k)) draft.set(k, { method: 'wallet' });
      render(); return true;
    case 'pay-copy':
      try { await navigator.clipboard.writeText(el.dataset.v ?? ''); toast(`📋 ${t('pay.copied')}`); } catch { toast(el.dataset.v ?? ''); }
      return true;
    case 'pay-view':
      try { showReceipt(await pay.receiptUrl(el.dataset.path!)); } catch (e) { toast(authErr(e)); }
      return true;
    case 'pay-send': {
      const { kind, ref } = findByKey(k);
      const d = draft.get(k) ?? {};
      const method = el.dataset.m as 'wallet' | 'cash';
      const box = el.closest('.pay-me');
      const wallet = method === 'wallet' ? (box?.querySelector<HTMLInputElement>('input[data-act="pay-wallet"]:checked')?.value ?? d.wallet ?? null) : null;
      draft.set(k, { ...d, busy: true }); render();
      try {
        await pay.submitPayment(kind, ref, method, wallet, method === 'wallet' ? d.receipt ?? null : null);
        draft.delete(k);
        cache.delete(key(kind, ref));
        await load(kind, [ref]);
        toast(`📤 ${t(method === 'cash' ? 'pay.sentCash' : 'pay.sent')}`);
      } catch (e) { draft.set(k, { ...d, busy: false }); toast(authErr(e)); }
      changed(); return true;
    }
    case 'pay-ok': case 'pay-no': {
      el.setAttribute('disabled', '');
      try {
        await pay.decidePayment(el.dataset.id!, act === 'pay-ok');
        for (const [ck, v] of cache) if (v && v.id === el.dataset.id) cache.set(ck, { ...v, status: act === 'pay-ok' ? 'approved' : 'rejected' });
        toast(act === 'pay-ok' ? `✅ ${t('pay.approved')}` : t('pay.rejectedToast'));
      } catch (e) { toast(authErr(e)); }
      changed(); return true;
    }
  }
  return false;
}

export async function onChange(el: HTMLInputElement): Promise<boolean> {
  const k = el.dataset.k ?? '';
  if (el.dataset.act === 'pay-wallet') { draft.set(k, { ...draft.get(k), method: 'wallet', wallet: el.value }); return true; }
  if (el.dataset.act !== 'pay-receipt') return false;
  const file = el.files?.[0];
  if (!file) return true;
  const d = draft.get(k) ?? {};
  const wallet = el.closest('.pay-me')?.querySelector<HTMLInputElement>('input[data-act="pay-wallet"]:checked')?.value ?? d.wallet;
  draft.set(k, { ...d, method: 'wallet', wallet, busy: true }); render();
  try {
    const path = await pay.uploadReceipt(file);
    draft.set(k, { ...draft.get(k), receipt: path, busy: false });
    toast(`🧾 ${t('pay.receiptReady')}`);
  } catch (e) { draft.set(k, { ...draft.get(k), busy: false }); toast(authErr(e)); }
  render();
  return true;
}
