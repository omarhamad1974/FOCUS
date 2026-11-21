/**
 * Batch player entry (admin) and the older claim codes.
 * - The admin imports an Excel/CSV file or pastes "name, mobile" lines: each new mobile gets an
 *   account that signs in with that mobile and the password "pingo123" (changed at first sign-in),
 *   to share on WhatsApp or print. The batch can go straight onto a tournament's waiting list.
 * - #/claim/CODE still works for codes handed out before mobile sign-in (Nov 2026).
 */
import { numberFmt, t, type MessageKey } from '../i18n/ar';
import * as remote from '../data/remote';
import * as content from '../data/content';
import { authErr, hint, render, session, val } from '../app/ctx';
import { icon } from '../ui/icons';
import { avatar, confetti, esc, toast } from '../ui/util';
import { cleanCode, fmtCode } from '../domain/claim';
import { DEFAULT_PASSWORD, demoPhoto, parseCsv, parsePasted, rowsFromTable, type ParsedRows, type PlayerRow, type RowProblem } from '../domain/mobile';
import { readXlsx } from '../domain/xlsx';

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
let batchTournament = '';
let batchPhotos = false;
let batchBusy = false;
/** Rows read from an imported Excel or CSV file. */
let fileRows: ParsedRows | null = null;
let fileName = '';
let result: { rows: remote.AddedPlayer[]; waitlisted: number; tournament: string } | null = null;
let onAdded: () => void = () => {};
/** Main page hook: reload the directory after a batch. */
export const setOnAdded = (fn: () => void) => { onAdded = fn; };
let afterClaim: () => Promise<void> = async () => {};
/** Main page hook: reload tournaments after a signed-in player claims a profile. */
export const setAfterClaim = (fn: () => Promise<void>) => { afterClaim = fn; };

/** Tournaments that can still take players (groups not drawn yet), from the main page. */
export interface OpenTournament { id: string; name: string; open: boolean }
let tournaments: () => OpenTournament[] = () => [];
export const setTournaments = (fn: () => OpenTournament[]) => { tournaments = fn; };

/* Temporary accounts from the older batch (profile id → claim code), for the directory list. Admin only. */
let temps: Map<string, string | null> | null = null;
let tempsBusy = false;
export function tempCodes(): Map<string, string | null> {
  if (!temps && !tempsBusy) {
    tempsBusy = true;
    remote.tempAccounts()
      .then((rows) => { temps = new Map(rows.map((r) => [r.id, r.claim_code])); })
      .catch(() => { temps = new Map(); })
      .finally(() => { tempsBusy = false; render(); });
  }
  return temps ?? new Map();
}
export const resetTemps = () => { temps = null; };

function genderChoice(): string {
  const opt = (v: remote.Gender | '', label: MessageKey) =>
    `<button type="button" data-act="batch-gender" data-v="${v}" aria-pressed="${batchGender === v}">${v ? avatar('', null, v) : '👥'} ${t(label)}</button>`;
  return `<div class="choice batch-gender">${opt('', 'batch.mixed')}${opt('male', 'auth.male')}${opt('female', 'auth.female')}</div>`;
}

function tournamentChoice(): string {
  const list = tournaments();
  if (batchTournament && !list.some((x) => x.id === batchTournament)) batchTournament = '';
  return `<label class="field"><span>🏆 ${t('batch.tournament')}</span>
    <select class="input" id="bTour">
      <option value="">${t('batch.noTournament')}</option>
      ${list.map((x) => `<option value="${esc(x.id)}" ${x.id === batchTournament ? 'selected' : ''}>${esc(x.name)}${x.open ? '' : ` · ${t('batch.regClosed')}`}</option>`).join('')}
    </select></label>
    <p class="muted small" style="margin-block-start:-6px">${t(list.length ? 'batch.tournamentHint' : 'batch.noOpenTournaments')}</p>`;
}

function keepBatch(): void {
  const names = document.getElementById('bNames') as HTMLTextAreaElement | null;
  if (names) batchText = names.value;
  if (document.getElementById('bClub')) batchClub = val('bClub');
  if (document.getElementById('bTour')) batchTournament = val('bTour');
  const ph = document.getElementById('bPhotos') as HTMLInputElement | null;
  if (ph) batchPhotos = ph.checked;
}

/** Everything that will be added: file rows first, then pasted lines (each mobile once). */
function allRows(): ParsedRows {
  const pasted = parsePasted(batchText);
  const seen = new Set<string>();
  const rows: PlayerRow[] = [];
  const problems: RowProblem[] = [...(fileRows?.problems ?? []), ...pasted.problems];
  for (const r of [...(fileRows?.rows ?? []), ...pasted.rows]) {
    if (seen.has(r.mobile)) { problems.push({ line: 0, text: `${r.full_name} · ${r.mobile}`, reason: 'repeat' }); continue; }
    seen.add(r.mobile);
    rows.push(r);
  }
  return { rows, problems };
}

function preview(): string {
  const { rows, problems } = allRows();
  return `<p class="muted small batch-count" id="bCount">${t('batch.count', { n: numberFmt.format(rows.length) })}</p>
    ${problems.length ? `<div class="err batch-problems"><b>${t('batch.problems', { n: numberFmt.format(problems.length) })}</b>
      <ul>${problems.slice(0, 8).map((p) => `<li>${p.line ? `${t('batch.line', { n: numberFmt.format(p.line) })}: ` : ''}<span dir="auto">${esc(p.text || '—')}</span> · ${t(`batch.why.${p.reason}` as MessageKey)}</li>`).join('')}
      ${problems.length > 8 ? `<li>…</li>` : ''}</ul></div>` : ''}
    ${rows.length ? `<div class="batch-preview">${rows.slice(0, 6).map((r) => `<span class="chip ro">${avatar(r.full_name, batchPhotos ? demoPhoto(r.gender ?? (batchGender || null), hash(r.mobile)) : null, r.gender ?? (batchGender || null))}<b dir="auto">${esc(r.full_name)}</b><span class="muted small" dir="ltr">${esc(r.mobile)}</span></span>`).join('')}${rows.length > 6 ? `<span class="muted small">+${numberFmt.format(rows.length - 6)}</span>` : ''}</div>` : ''}`;
}

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** The card on the players page (admin only). */
export function batchCard(): string {
  const count = allRows().rows.length;
  return `<div class="card batch-card rise">
    <h2>📥 ${t('batch.title')}</h2>${hint('batch.hint')}
    <form data-form="batch-add" novalidate>
      <span class="lbl">${t('batch.file')}</span>
      <div class="row batch-file">
        <label class="btn soft">${icon('plus', 16)} ${t(fileName ? 'batch.fileChange' : 'batch.fileChoose')}<input type="file" class="hidden" data-act="batch-file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
        ${fileName ? `<span class="badge green" dir="auto">📄 ${esc(fileName)} · ${numberFmt.format(fileRows?.rows.length ?? 0)}</span>
          <button type="button" class="btn ghost small" data-act="batch-file-clear">${icon('x', 14)}</button>` : ''}
        <button type="button" class="btn ghost small" data-act="batch-template">⬇️ ${t('batch.template')}</button>
      </div>
      <p class="muted small">${t('batch.fileHint')}</p>
      <label class="field"><span>${t('batch.names')}</span>
        <textarea class="input batch-names" id="bNames" data-act="batch-names" rows="6" dir="auto" placeholder="${esc(t('batch.placeholder'))}">${esc(batchText)}</textarea></label>
      <div id="bPreview">${preview()}</div>
      ${tournamentChoice()}
      <label class="field"><span>${t('batch.club')}</span><input class="input" id="bClub" dir="auto" value="${esc(batchClub)}"></label>
      <span class="lbl">${t('batch.gender')}</span>
      ${genderChoice()}
      <p class="muted small">${t('batch.genderHint')}</p>
      <label class="tog check-tog"><input type="checkbox" id="bPhotos" data-act="batch-photos" ${batchPhotos ? 'checked' : ''}> 🧪 ${t('batch.photos')}</label>
      <p class="muted small">${t('batch.photosHint')}</p>
      <div class="hint">🔑 ${t('batch.passwordNote')}</div>
      <button class="btn green block" type="submit" id="bSubmit" ${batchBusy || !count ? 'disabled' : ''}>${batchBusy ? '<span class="spin"></span>' : '➕'} ${t('batch.submit', { n: numberFmt.format(count) })}</button>
      ${batchBusy ? `<p class="muted small center">${t('batch.working')}</p>` : ''}
    </form>
  </div>
  ${result ? resultCard() : ''}`;
}

const KIND_BADGE: Record<remote.AddKind, [string, MessageKey]> = {
  new: ['green', 'batch.kind.new'],
  account: ['blue', 'batch.kind.account'],
  bad_mobile: ['red', 'batch.kind.badMobile'],
  failed: ['red', 'batch.kind.failed'],
};

/** Link to the app's sign-in page, on whatever address it runs. */
export const loginLink = () => `${location.origin}${location.pathname}#/login`;

/** WhatsApp message for a player whose account was just made: mobile + "pingo123". */
export function loginText(name: string, mobile: string): string {
  return t('batch.waText', { name, mobile, password: DEFAULT_PASSWORD, link: loginLink() });
}

/** WhatsApp button (to the player's own number) + copy for one new account. */
export function loginTools(name: string, mobile: string): string {
  const intl = mobile.startsWith('0') ? `20${mobile.slice(1)}` : mobile;
  const wa = `https://wa.me/${intl}?text=${encodeURIComponent(loginText(name, mobile))}`;
  return `<span class="claim-tools">
    <span class="claim-code" dir="ltr">📱 ${esc(mobile)} · 🔑 ${DEFAULT_PASSWORD}</span>
    <a class="btn small wa" href="${wa}" target="_blank" rel="noopener">${icon('whatsapp', 16)} ${t('claim.whatsapp')}</a>
  </span>`;
}

function resultCard(): string {
  const { rows, waitlisted, tournament } = result!;
  const made = rows.filter((r) => r.kind === 'new');
  const tName = tournament ? tournaments().find((x) => x.id === tournament)?.name ?? '' : '';
  return `<div class="card batch-result pop" id="batchResult">
    <div class="sec-head"><h2>🎉 ${t('batch.done', { n: numberFmt.format(made.length) })}</h2>
      <button type="button" class="btn ghost small" data-act="batch-close">${icon('x', 16)} ${t('batch.close')}</button></div>
    ${tournament ? `<div class="hint" style="background:var(--green-soft)">📝 ${esc(t('batch.waitlisted', { n: numberFmt.format(waitlisted), name: tName }))}</div>` : ''}
    ${hint('batch.doneHint')}
    ${made.length ? `<div class="row" style="margin-block:8px">
      <button type="button" class="btn soft small" data-act="batch-copy-all">📋 ${t('batch.copyAll')}</button>
      <button type="button" class="btn soft small" data-act="batch-print">🖨️ ${t('batch.print')}</button></div>` : ''}
    <div class="stack">${rows.map((r) => {
      const [cls, key] = KIND_BADGE[r.kind] ?? KIND_BADGE.failed;
      return `<div class="chip ro batch-row">
      ${avatar(r.full_name, null, batchGender || null)}<b dir="auto">${esc(r.full_name)}</b>
      <span class="badge ${cls}">${t(key)}</span>
      ${r.kind === 'new' ? loginTools(r.full_name, r.mobile) : `<span class="muted small" dir="ltr">${esc(r.mobile)}</span>`}
    </div>`;
    }).join('')}</div>
  </div>`;
}

/** Download an example file to fill in Excel (UTF-8 with BOM so Arabic opens correctly). */
function downloadTemplate(): void {
  const csv = '\uFEFF' + t('batch.templateCsv');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'pingo-players.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function readFile(file: File): Promise<ParsedRows> {
  if (/\.xlsx$/i.test(file.name) || file.type.includes('spreadsheetml')) return rowsFromTable(await readXlsx(await file.arrayBuffer()));
  if (/\.xls$/i.test(file.name)) throw new Error('xls');
  return rowsFromTable(parseCsv(await file.text()));
}

/** Print one card per new account (8 per A4 page): name, mobile, password and link. */
function printLogins(items: { full_name: string; mobile: string }[]): void {
  document.getElementById('print-sheet')?.remove();
  const sheet = document.createElement('div');
  sheet.id = 'print-sheet';
  sheet.className = 'print-sheet';
  sheet.setAttribute('dir', 'rtl');
  sheet.innerHTML = items.map((p) => `<div class="print-card">
    <img src="${import.meta.env.BASE_URL}brand/logo.png" alt="Pingo" class="print-logo">
    <h3 dir="auto">${esc(p.full_name)}</h3>
    <p>${t('batch.cardTitle')} 🏓</p>
    <p class="small">${t('batch.cardMobile')}</p>
    <p class="print-code" dir="ltr">${esc(p.mobile)}</p>
    <p class="small">${t('batch.cardPassword')} <b dir="ltr">${DEFAULT_PASSWORD}</b></p>
    <p class="print-link" dir="ltr">${esc(loginLink())}</p>
  </div>`).join('');
  document.body.appendChild(sheet);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); sheet.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
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
/** The code whose "link to my account" was pressed once and now waits for a yes. */
let linkArmed = '';
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
  if (session.profile) return signedInCard(head, code, info.full_name);
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

/**
 * Someone is already signed in on this device. Usually it is the organizer or admin who
 * made the link, opening it to check it: never link without a clear, two-step choice,
 * and an admin account can't take a player's profile at all.
 */
function signedInCard(head: string, code: string, player: string): string {
  const me = session.profile!;
  const admin = me.role === 'admin';
  const staff = admin || me.role === 'organizer' || !!me.is_organizer;
  const linkBtn = admin ? '' : linkArmed === code
    ? `<div class="err" role="alert">${esc(t('claim.linkConfirm', { player, name: me.full_name }))}</div>
      <div class="row" style="margin-block-start:8px">
        <button class="btn green" data-act="claim-mine" data-code="${code}" ${claimBusy ? 'disabled' : ''}>✅ ${t('claim.linkYes')}</button>
        <button class="btn ghost" data-act="claim-unarm">${t('claim.linkNo')}</button></div>`
    : `<button class="btn ${staff ? 'ghost' : 'soft'} block" data-act="claim-arm" data-code="${code}">🔗 ${esc(t('claim.linkMine', { player }))}</button>`;
  return `${head}<div class="card" style="max-width:520px;margin-inline:auto">
    <p><b>${esc(t('claim.signedIn', { name: me.full_name }))}</b></p>
    <p>${esc(t(staff ? 'claim.staffNote' : 'claim.otherNote', { player }))}</p>
    <button class="btn green block" data-act="claim-logout" style="margin-block:8px">🚪 ${esc(t('claim.signOutFor', { player }))}</button>
    ${admin ? `<p class="muted small">${t('claim.adminNoLink')}</p>` : `${hint('claim.linkHint')}${linkBtn}`}
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
      keepBatch();
      batchGender = (el.dataset.v as remote.Gender) || '';
      render(); return true;
    case 'batch-close':
      result = null; render(); return true;
    case 'batch-copy-all':
      if (result) await copy(result.rows.filter((r) => r.kind === 'new').map((r) => `${r.full_name}: ${r.mobile} / ${DEFAULT_PASSWORD}`).join('\n') + `\n${loginLink()}`);
      return true;
    case 'batch-print':
      if (result) printLogins(result.rows.filter((r) => r.kind === 'new'));
      return true;
    case 'batch-template':
      downloadTemplate(); return true;
    case 'batch-file-clear':
      keepBatch(); fileRows = null; fileName = ''; render(); return true;
    case 'claim-copy':
      await copy(claimLink(el.dataset.code!)); return true;
    case 'claim-make':
      try { await remote.renewClaimCode(el.dataset.id!); temps = null; onAdded(); } catch (e) { toast(authErr(e)); }
      return true;
    case 'claim-renew': {
      if (el.dataset.armed !== '1') { el.dataset.armed = '1'; el.textContent = `♻️ ${t('claim.renewHint')}`; return true; }
      try { await remote.renewClaimCode(el.dataset.id!); toast(`✅ ${t('claim.renewed')}`); temps = null; onAdded(); } catch (e) { toast(authErr(e)); }
      return true;
    }
    case 'claim-arm':
      linkArmed = el.dataset.code ?? ''; render(); return true;
    case 'claim-unarm':
      linkArmed = ''; render(); return true;
    case 'claim-logout':
      linkArmed = '';
      try { await remote.signOut(); await afterClaim(); } catch (e) { toast(authErr(e)); }
      render(); return true;
    case 'claim-mine': {
      if (linkArmed !== el.dataset.code) return true;
      linkArmed = '';
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
  const n = allRows().rows.length;
  const box = document.getElementById('bPreview');
  if (box) box.innerHTML = preview();
  const btn = document.getElementById('bSubmit') as HTMLButtonElement | null;
  if (btn) { btn.disabled = !n || batchBusy; btn.textContent = `➕ ${t('batch.submit', { n: numberFmt.format(n) })}`; }
  return true;
}

export async function onChange(el: HTMLInputElement): Promise<boolean> {
  if (el.name === 'cGender') { keepTyped(); render(); return true; }
  if (el.dataset.act === 'batch-photos') { keepBatch(); render(); return true; }
  if (el.dataset.act === 'batch-file' && el.files?.[0]) {
    keepBatch();
    const file = el.files[0];
    try {
      fileRows = await readFile(file);
      fileName = file.name;
      if (!fileRows.rows.length) toast(t('batch.fileEmpty'));
    } catch (e) {
      toast(t(e instanceof Error && e.message === 'xls' ? 'batch.fileXls' : 'batch.fileBad'));
    }
    render();
    return true;
  }
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
    keepBatch();
    const { rows } = allRows();
    if (!rows.length) { toast(t('batch.empty')); return true; }
    if (rows.length > MAX_BATCH) { toast(t('batch.tooMany')); return true; }
    batchBusy = true; render();
    try {
      const tournament = batchTournament;
      const send = rows.map((r) => {
        const gender = r.gender ?? (batchGender || undefined);
        return {
          ...r,
          club: r.club ?? (batchClub || undefined),
          gender,
          ...(batchPhotos ? { photo: demoPhoto(gender, hash(r.mobile)) } : {}),
        };
      });
      const r = await remote.addPlayers(send, tournament || null);
      result = { rows: r.rows ?? [], waitlisted: r.waitlisted ?? 0, tournament };
      batchText = ''; fileRows = null; fileName = '';
      temps = null;
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
