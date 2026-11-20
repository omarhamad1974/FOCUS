/**
 * Batch player entry and claim codes.
 * - Organizers paste names (one per line): each becomes a directory player, ready for
 *   tournaments, with a personal claim code to share on WhatsApp or print.
 * - #/claim/CODE lets that player set their own email, password, gender and photo;
 *   the profile (with every result) moves to the new account.
 */
import { numberFmt, t, type MessageKey } from '../i18n/ar';
import * as remote from '../data/remote';
import * as content from '../data/content';
import { authErr, hint, render, session, val } from '../app/ctx';
import { icon } from '../ui/icons';
import { avatar, confetti, esc, toast } from '../ui/util';
import { cleanCode, fmtCode, parseNames } from '../domain/claim';

const PHOTO_KEY = 'pingo.pendingPhoto';
export const MAX_BATCH = 300;

/* ----------------------------------------------------------- helpers */

/** Link that opens the claim page for this code, on whatever address the app runs. */
export function claimLink(code: string): string {
  return `${location.origin}${location.pathname}#/claim/${cleanCode(code)}`;
}

export function whatsappText(name: string, code: string): string {
  return t('claim.waText', { name, link: claimLink(code), code: fmtCode(code) });
}

async function copy(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); toast(`✅ ${t('batch.copied')}`); } catch { toast(text); }
}

/** Code chip + WhatsApp + copy buttons for one player. */
export function codeTools(name: string, code: string, playerId?: string): string {
  const wa = `https://wa.me/?text=${encodeURIComponent(whatsappText(name, code))}`;
  return `<span class="claim-tools">
    <span class="claim-code" dir="ltr" title="${esc(t('claim.code'))}">🎟️ ${esc(fmtCode(code))}</span>
    <a class="btn small wa" href="${wa}" target="_blank" rel="noopener">${icon('whatsapp', 16)} ${t('claim.whatsapp')}</a>
    <button type="button" class="btn soft small" data-act="claim-copy" data-code="${esc(code)}">🔗 ${t('claim.copy')}</button>
    ${playerId ? `<button type="button" class="btn ghost small" data-act="claim-renew" data-id="${playerId}" title="${esc(t('claim.renewHint'))}">♻️ ${t('claim.renew')}</button>` : ''}
  </span>`;
}

/* --------------------------------------------------------- batch entry */

let batchText = '';
let batchClub = '';
let batchGender: remote.Gender | '' = '';
let batchBusy = false;
let result: remote.BatchRow[] | null = null;
let onAdded: () => void = () => {};
/** Main page hook: reload the directory after a batch. */
export const setOnAdded = (fn: () => void) => { onAdded = fn; };
let afterClaim: () => Promise<void> = async () => {};
/** Main page hook: reload tournaments after a signed-in player claims a profile. */
export const setAfterClaim = (fn: () => Promise<void>) => { afterClaim = fn; };

function genderChoice(): string {
  const opt = (v: remote.Gender | '', label: MessageKey) =>
    `<button type="button" data-act="batch-gender" data-v="${v}" aria-pressed="${batchGender === v}">${v ? avatar('', null, v) : '👥'} ${t(label)}</button>`;
  return `<div class="choice batch-gender">${opt('', 'batch.mixed')}${opt('male', 'auth.male')}${opt('female', 'auth.female')}</div>`;
}

/** The card on the players page. */
export function batchCard(): string {
  const count = parseNames(batchText).length;
  return `<div class="card batch-card rise">
    <h2>🎟️ ${t('batch.title')}</h2>${hint('batch.hint')}
    <form data-form="batch-add" novalidate>
      <label class="field"><span>${t('batch.names')}</span>
        <textarea class="input batch-names" id="bNames" data-act="batch-names" rows="7" dir="auto" placeholder="${esc(t('batch.placeholder'))}">${esc(batchText)}</textarea></label>
      <p class="muted small batch-count" id="bCount">${t('batch.count', { n: numberFmt.format(count) })}</p>
      <label class="field"><span>${t('batch.club')}</span><input class="input" id="bClub" dir="auto" value="${esc(batchClub)}"></label>
      <span class="lbl">${t('batch.gender')}</span>
      ${genderChoice()}
      <p class="muted small">${t('batch.genderHint')}</p>
      <button class="btn green block" type="submit" id="bSubmit" ${batchBusy || !count ? 'disabled' : ''}>${batchBusy ? '<span class="spin"></span>' : '➕'} ${t('batch.submit', { n: numberFmt.format(count) })}</button>
    </form>
  </div>
  ${result ? resultCard(result) : ''}`;
}

function resultCard(rows: remote.BatchRow[]): string {
  const withCode = rows.filter((r) => r.claim_code);
  return `<div class="card batch-result pop" id="batchResult">
    <div class="sec-head"><h2>🎉 ${t('batch.done', { n: numberFmt.format(rows.length) })}</h2>
      <button type="button" class="btn ghost small" data-act="batch-close">${icon('x', 16)} ${t('batch.close')}</button></div>
    ${hint('batch.doneHint')}
    ${withCode.length ? `<div class="row" style="margin-block:8px">
      <button type="button" class="btn soft small" data-act="batch-copy-all">📋 ${t('batch.copyAll')}</button>
      <button type="button" class="btn soft small" data-act="batch-print">🖨️ ${t('batch.print')}</button></div>` : ''}
    <div class="stack">${rows.map((r) => `<div class="chip ro batch-row">
      ${avatar(r.full_name, null, batchGender || null)}<b dir="auto">${esc(r.full_name)}</b>
      ${r.existed ? `<span class="badge">${t('batch.existed')}</span>` : ''}
      ${r.has_account ? `<span class="badge green">${t('batch.hasAccount')}</span>` : ''}
      ${r.claim_code ? codeTools(r.full_name, r.claim_code) : ''}
    </div>`).join('')}</div>
  </div>`;
}

/* --------------------------------------------------------------- print */

export interface PrintItem { full_name: string; claim_code: string; club?: string | null }

/** Print one card per player (8 per A4 page): name, code and link. */
export function printCards(items: PrintItem[]): void {
  document.getElementById('print-sheet')?.remove();
  const sheet = document.createElement('div');
  sheet.id = 'print-sheet';
  sheet.className = 'print-sheet';
  sheet.setAttribute('dir', 'rtl');
  sheet.innerHTML = items.map((p) => `<div class="print-card">
    <img src="${import.meta.env.BASE_URL}brand/logo.png" alt="Pingo" class="print-logo">
    <h3 dir="auto">${esc(p.full_name)}</h3>
    ${p.club ? `<p class="muted" dir="auto">${esc(p.club)}</p>` : ''}
    <p>${t('claim.cardTitle')} 🏓</p>
    <p class="small">${t('claim.cardStep')}</p>
    <p class="print-code" dir="ltr">${esc(fmtCode(p.claim_code))}</p>
    <p class="print-link" dir="ltr">${esc(claimLink(p.claim_code))}</p>
  </div>`).join('');
  document.body.appendChild(sheet);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); sheet.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}

/* ---------------------------------------------------------- claim page */

let lookedUp: { code: string; info: remote.ClaimInfo | null } | null = null;
let lookupBusy = false;
let claimBusy = false;
let claimMsg = '';
let claimGender: remote.Gender | '' = '';
let claimPhoto: string | null = null;
const typed: Record<string, string> = {};

function lookup(code: string): void {
  if (lookupBusy) return;
  lookupBusy = true;
  remote.claimInfo(code)
    .then((info) => { lookedUp = { code, info }; claimGender = info?.gender ?? ''; claimMsg = ''; })
    .catch((e) => { lookedUp = { code, info: null }; toast(authErr(e)); })
    .finally(() => { lookupBusy = false; render(); });
}

function codeForm(bad: boolean, code = ''): string {
  return `<div class="card claim-card" style="max-width:480px;margin-inline:auto">
    <h2>🎟️ ${t('claim.title')}</h2>
    ${bad ? `<div class="err" role="alert">${t('claim.bad')}</div><p class="muted small">${t('claim.badHint')}</p>` : hint('claim.enterHint')}
    <form data-form="claim-code" novalidate>
      <label class="field"><span>${t('claim.enterCode')}</span>
        <input class="input claim-input" id="cCode" dir="ltr" autocomplete="one-time-code" autocapitalize="characters" maxlength="12" placeholder="XXXX-XXXX" value="${esc(code ? fmtCode(code) : '')}"></label>
      <button class="btn green block" type="submit">${t('claim.go')}</button>
    </form>
  </div>`;
}

/** #/claim and #/claim/CODE. */
export function page(parts: string[]): string {
  const code = cleanCode(parts[1] ?? '');
  if (!code) return codeForm(false);
  if (!lookedUp || lookedUp.code !== code) {
    lookup(code);
    return `<div class="card center muted"><span class="spin"></span> ${t('reg.loading')}</div>`;
  }
  const info = lookedUp.info;
  if (!info) return codeForm(true, code);
  const head = `<div class="hero claim-hero rise">
    <div class="claim-who">${avatar(info.full_name, claimPhoto, claimGender || info.gender)}
      <div><h1 dir="auto">${esc(t('claim.hello', { name: info.full_name }))}</h1>
      ${info.club ? `<p class="muted" dir="auto">${esc(info.club)}</p>` : ''}
      ${info.tournaments ? `<span class="badge gold">🏆 ${t('claim.played', { n: numberFmt.format(info.tournaments) })}</span>` : ''}</div></div>
    <p>${t('claim.intro')}</p>
  </div>`;
  if (session.profile) {
    return `${head}<div class="card" style="max-width:520px;margin-inline:auto">
      <p>${esc(t('claim.signedIn', { name: session.profile.full_name }))}</p>${hint('claim.linkHint')}
      <button class="btn green block" data-act="claim-mine" data-code="${code}" ${claimBusy ? 'disabled' : ''}>🔗 ${t('claim.linkMine')}</button>
    </div>`;
  }
  const g = (v: remote.Gender) => `<label class="gender-opt"><input type="radio" name="cGender" value="${v}" ${claimGender === v ? 'checked' : ''}>${avatar(info.full_name, null, v)}<b>${t(`auth.${v}` as MessageKey)}</b></label>`;
  return `${head}<div class="card" style="max-width:520px;margin-inline:auto">
    <form data-form="claim-new" data-code="${code}" novalidate>
      <label class="field"><span>${t('auth.email')}</span><input class="input" id="cEmail" type="email" autocomplete="email" dir="ltr" value="${esc(typed.cEmail ?? '')}"></label>
      <label class="field"><span>${t('auth.password')}</span><input class="input" id="cPass" type="password" autocomplete="new-password" dir="ltr" minlength="6" value="${esc(typed.cPass ?? '')}"></label>
      <p class="muted small" style="margin-block-start:-6px">${t('auth.passwordHint')}</p>
      <span class="lbl">${t('auth.gender')}</span>
      <div class="gender-pick" role="radiogroup">${g('male')}${g('female')}</div>
      <span class="lbl">${t('me.photo')}</span>
      <div class="row">${avatar(info.full_name, claimPhoto, claimGender || info.gender)}
        <label class="btn soft small">${icon('image', 16)} ${t(claimPhoto ? 'media.change' : 'media.choose')}<input type="file" accept="image/*" class="hidden" data-act="claim-photo"></label>
        <span class="muted small">${t('me.photoHint')}</span></div>
      ${claimMsg ? `<div class="err" role="alert">${esc(claimMsg)}</div>` : ''}
      <button class="btn green block" type="submit" style="margin-block-start:12px" ${claimBusy ? 'disabled' : ''}>${claimBusy ? '<span class="spin"></span>' : '🚀'} ${t('claim.submit')}</button>
      <p class="muted small center" style="margin-block-start:8px">${esc(t('claim.notYou', { name: info.full_name }))}</p>
    </form>
    <hr class="sep">
    <p class="center"><b>${t('claim.haveAccount')}</b><br>
      <a class="btn soft small" href="#/login" data-return="#/claim/${code}">🔑 ${t('claim.loginFirst')}</a></p>
  </div>`;
}

function keepTyped(): void {
  for (const id of ['cEmail', 'cPass']) if (document.getElementById(id)) typed[id] = val(id);
  const g = document.querySelector<HTMLInputElement>('input[name="cGender"]:checked')?.value;
  if (g === 'male' || g === 'female') claimGender = g;
}

/* -------------------------------------------------------------- events */

export async function onClick(act: string, el: HTMLElement): Promise<boolean> {
  switch (act) {
    case 'batch-gender':
      batchText = (document.getElementById('bNames') as HTMLTextAreaElement | null)?.value ?? batchText;
      batchClub = val('bClub');
      batchGender = (el.dataset.v as remote.Gender) || '';
      render(); return true;
    case 'batch-close':
      result = null; render(); return true;
    case 'batch-copy-all':
      if (result) await copy(result.filter((r) => r.claim_code).map((r) => `${r.full_name}: ${claimLink(r.claim_code!)}`).join('\n'));
      return true;
    case 'batch-print':
      if (result) printCards(result.filter((r) => r.claim_code).map((r) => ({ full_name: r.full_name, claim_code: r.claim_code!, club: batchClub || null })));
      return true;
    case 'claim-copy':
      await copy(claimLink(el.dataset.code!)); return true;
    case 'claim-make':
      try { await remote.renewClaimCode(el.dataset.id!); onAdded(); } catch (e) { toast(authErr(e)); }
      return true;
    case 'claim-renew': {
      if (el.dataset.armed !== '1') { el.dataset.armed = '1'; el.textContent = `♻️ ${t('claim.renewHint')}`; return true; }
      try { await remote.renewClaimCode(el.dataset.id!); toast(`✅ ${t('claim.renewed')}`); onAdded(); } catch (e) { toast(authErr(e)); }
      return true;
    }
    case 'claim-mine': {
      claimBusy = true; render();
      try {
        await remote.claimForMe(el.dataset.code!);
        lookedUp = null; confetti(); toast(`✅ ${t('claim.linked')}`);
        await afterClaim();
        location.hash = '#/me';
      } catch (e) { toast(authErr(e)); }
      claimBusy = false; render();
      return true;
    }
  }
  return false;
}

export function onInput(el: HTMLElement): boolean {
  if (el.dataset.act !== 'batch-names') return false;
  batchText = (el as HTMLTextAreaElement).value;
  const n = parseNames(batchText).length;
  const count = document.getElementById('bCount');
  if (count) count.textContent = t('batch.count', { n: numberFmt.format(n) });
  const btn = document.getElementById('bSubmit') as HTMLButtonElement | null;
  if (btn) { btn.disabled = !n || batchBusy; btn.textContent = `➕ ${t('batch.submit', { n: numberFmt.format(n) })}`; }
  return true;
}

export async function onChange(el: HTMLInputElement): Promise<boolean> {
  if (el.name === 'cGender') { keepTyped(); render(); return true; }
  if (el.dataset.act !== 'claim-photo' || !el.files?.[0]) return false;
  keepTyped();
  try {
    claimPhoto = await content.squareDataUrl(el.files[0]);
  } catch { toast(t('auth.err.upload')); }
  render();
  return true;
}

export async function onSubmit(kind: string, form: HTMLFormElement): Promise<boolean> {
  if (kind === 'batch-add') {
    batchText = (document.getElementById('bNames') as HTMLTextAreaElement).value;
    batchClub = val('bClub');
    const names = parseNames(batchText);
    if (!names.length) { toast(t('batch.empty')); return true; }
    if (names.length > MAX_BATCH) { toast(t('batch.tooMany')); return true; }
    batchBusy = true; render();
    try {
      result = await remote.batchAddPlayers(names, batchClub || null, batchGender || null);
      batchText = '';
      confetti();
      onAdded();
    } catch (e) { toast(authErr(e)); }
    batchBusy = false; render();
    document.getElementById('batchResult')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }
  if (kind === 'claim-code') {
    const code = cleanCode(val('cCode'));
    if (code) location.hash = `#/claim/${code}`;
    return true;
  }
  if (kind === 'claim-new') {
    keepTyped();
    const email = typed.cEmail ?? '', password = typed.cPass ?? '';
    if (!email || !password) { claimMsg = t('auth.err.required'); render(); return true; }
    if (password.length < 6) { claimMsg = t('auth.err.weakPassword'); render(); return true; }
    if (!claimGender) { claimMsg = t('auth.err.gender'); render(); return true; }
    claimBusy = true; claimMsg = ''; render();
    try {
      // The photo waits in the browser; it is uploaded right after the first sign-in.
      if (claimPhoto) { try { localStorage.setItem(PHOTO_KEY, claimPhoto); } catch { /* ignore */ } }
      await remote.claimAccount({ code: form.dataset.code!, email, password, gender: claimGender });
      for (const k of Object.keys(typed)) delete typed[k];
      lookedUp = null; claimPhoto = null;
      await afterClaim();
      confetti(); toast(`🎉 ${t('claim.done')}`);
      location.hash = '#/me';
    } catch (e) {
      claimMsg = authErr(e);
    }
    claimBusy = false; render();
    return true;
  }
  return false;
}
