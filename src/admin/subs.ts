/**
 * Subscriptions in the role tools.
 * - card(role): plan, status, expiry, amount due, prices and how to pay, on the
 *   organizer, trainer and seller tools' front page.
 * - adminPage(): #/desk/admin/subs, prices, people and their status, recording
 *   payments (offline), the payments ledger and revenue totals.
 * Expired subscriptions only bring warnings, nothing is blocked (Omar, 2026-11-22).
 */
import { t, type MessageKey } from '../i18n/ar';
import { db, listProfiles, type Profile } from '../data/remote';
import * as content from '../data/content';
import { SUPPORT_WHATSAPP } from '../config';
import { authErr, money, n, render, session, val } from '../app/ctx';
import {
  cleanSettings, clampProducts, periodEnd, plansFor, priceOf, productsCovered, revenue, statusOf, suggestion, todayIso,
  yearlySaving, SUB_ROLES, type PlanSettings, type SubPlan, type SubRole, type SubState, type SubStatus, type Subscription,
} from '../domain/subscriptions';
import { empty } from '../ui/art';
import { icon } from '../ui/icons';
import { avatarOf, esc, toast } from '../ui/util';
import { statTile, tip } from './ui';

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

const dateFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtDate = (d: string) => dateFmt.format(new Date(`${d}T00:00:00Z`));

const roleName = (r: SubRole) => t(`sub.role.${r}` as MessageKey);
const planName = (s: Pick<Subscription, 'plan' | 'products'>) =>
  s.plan === 'per_product' && s.products ? t('sub.planProducts', { n: s.products }) : t(`sub.plan.${s.plan}` as MessageKey);
const BADGE: Record<SubState, string> = { none: 'gold', active: 'green', soon: 'gold', expired: 'red' };
const STATE_ICON: Record<SubState, string> = { none: '🕓', active: '✅', soon: '⏳', expired: '⚠️' };
export const stateBadge = (st: SubStatus) => `<span class="badge ${BADGE[st.state]}">${STATE_ICON[st.state]} ${t(`sub.state.${st.state}` as MessageKey)}</span>`;

/* ------------------------------------------------------------ data */

let settings: PlanSettings | null = null;
let mine: Subscription[] | null = null;
let myActive = 0;
let all: Subscription[] | null = null;
let people: Profile[] = [];
let activeBySeller = new Map<string, number>();
let notReady = false;
let loadingMine = false;
let loadingAll = false;

const clean = (rows: Subscription[]) => rows.map((r) => ({ ...r, amount: Number(r.amount) }));

export function reset(): void { settings = null; mine = null; all = null; notReady = false; }

async function loadSettings(): Promise<PlanSettings> {
  return cleanSettings(check(await db().from('plan_settings').select('*').maybeSingle()) as Partial<PlanSettings> | null);
}

function loadMine(): void {
  const me = session.profile?.id;
  if (loadingMine || !me) return;
  loadingMine = true;
  Promise.all([loadSettings(), db().from('subscriptions').select('*').eq('user_id', me), content.listProducts().catch(() => [])])
    .then(([s, res, prods]) => {
      settings = s;
      mine = clean(check(res) as Subscription[]);
      myActive = prods.filter((p) => p.seller_id === me && p.active).length;
    })
    .catch(() => { notReady = true; mine = []; })
    .finally(() => { loadingMine = false; render(); });
}

function loadAll(): void {
  if (loadingAll) return;
  loadingAll = true;
  Promise.all([loadSettings(), db().from('subscriptions').select('*').order('created_at', { ascending: false }), listProfiles(), content.listProducts().catch(() => [])])
    .then(([s, res, profs, prods]) => {
      settings = s;
      all = clean(check(res) as Subscription[]);
      people = profs;
      activeBySeller = new Map();
      for (const p of prods) if (p.active) activeBySeller.set(p.seller_id, (activeBySeller.get(p.seller_id) ?? 0) + 1);
    })
    .catch(() => { notReady = true; all = []; })
    .finally(() => { loadingAll = false; render(); });
}

/* ------------------------------------------------------- role's own card */

const DESK_ROLE: Record<'org' | 'trainer' | 'seller' | 'hall', SubRole> = { org: 'organizer', trainer: 'trainer', seller: 'seller', hall: 'hall' };

function whenLine(st: SubStatus): string {
  if (st.daysLeft == null) return t('sub.noneYet');
  if (st.daysLeft < 0) return t('sub.endedAgo', { n: -st.daysLeft });
  return st.daysLeft === 0 ? t('sub.lastDay') : t('sub.daysLeft', { n: st.daysLeft + 1 });
}

function priceChips(role: SubRole, s: PlanSettings): string {
  if (role === 'seller') {
    return `<span class="sub-price">🛍️ ${t('sub.price.perProduct', { p: money(s.seller_per_product), max: n(s.seller_max_products) })}</span>
      <span class="sub-price">♾️ ${t('sub.price.unlimited', { p: money(s.seller_unlimited) })}</span>`;
  }
  const save = yearlySaving(s, role);
  return `<span class="sub-price">📅 ${t('sub.price.month', { p: money(priceOf(s, role, 'monthly')) })}</span>
    <span class="sub-price">🗓️ ${t('sub.price.year', { p: money(priceOf(s, role, 'yearly')) })}${save.pct > 0 ? ` <b class="badge green">${t('sub.price.save', { pct: n(save.pct) })}</b>` : ''}</span>`;
}

export function card(deskRole: 'org' | 'trainer' | 'seller' | 'hall'): string {
  const me = session.profile;
  if (!me || me.role === 'admin') return '';
  if (!mine || !settings) { if (!notReady) loadMine(); return notReady ? '' : `<div class="card dk-plan muted"><span class="spin"></span> ${t('reg.loading')}</div>`; }
  const role = DESK_ROLE[deskRole];
  const st = statusOf(mine, me.id, role);
  const next = suggestion(st, role, settings, myActive);
  const amount = st.due > 0 ? st.due : next.amount;
  const planLabel = st.current ? planName(st.current) : planName({ plan: next.plan, products: next.products });
  const msg = st.due > 0 ? 'sub.msg.due' : st.state === 'active' ? null : `sub.msg.${st.state}`;
  const covered = role === 'seller' ? productsCovered(st) : null;
  const wa = SUPPORT_WHATSAPP ? `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(t('sub.waText', {
    name: me.full_name, role: roleName(role), plan: planLabel, amount: money(amount),
  }))}` : '';
  return `<div class="card dk-plan st-${st.state}">
    <div class="row between"><h2>💳 ${t('sub.title')}</h2>${stateBadge(st)}</div>
    ${msg ? `<p class="sub-msg ${st.state === 'expired' || st.due > 0 ? 'bad' : ''}">${t(msg as MessageKey)}</p>` : ''}
    <div class="pay-box sub-box">
      <div class="pay-cell"><small>${t('sub.plan')}</small><b>${esc(st.current ? planLabel : t('sub.nothing'))}</b></div>
      <div class="pay-cell ${st.state === 'expired' ? 'due' : st.state === 'none' ? '' : 'ok'}"><small>${t('sub.ends')}</small><b>${st.endsOn ? fmtDate(st.endsOn) : t('sub.nothing')}</b><small>${whenLine(st)}</small></div>
      <div class="pay-cell ${st.due > 0 ? 'due' : ''}"><small>${st.due > 0 ? t('sub.due') : t('sub.renewal')}</small><b>${money(amount)}</b><small>${esc(planLabel)}</small></div>
    </div>
    ${role === 'seller' ? `<p class="small">${icon('box', 14)} ${covered === null && st.current ? t('sub.productsUnlimited', { active: n(myActive) }) : t('sub.products', { active: n(myActive), covered: n(covered ?? 0) })}</p>
      ${myActive > settings.seller_max_products ? `<p class="sub-msg">${t('sub.overMax', { max: n(settings.seller_max_products) })}</p>`
        : covered !== null && st.current && myActive > covered ? `<p class="sub-msg">${t('sub.overLimit')}</p>` : ''}` : ''}
    <div class="sub-prices"><small class="muted">${t('sub.prices')}:</small> ${priceChips(role, settings)}</div>
    <div class="sub-how"><p class="hint"><b>${t('sub.howTitle')}:</b> ${esc(t('sub.how'))}</p>
      ${wa ? `<a class="btn wa small" target="_blank" rel="noopener" href="${esc(wa)}">${icon('whatsapp', 16)} ${t('sub.payWa')}</a>` : ''}</div>
  </div>`;
}

/* ------------------------------------------------------------ admin */

type Filter = 'all' | 'attention' | 'active';
let filter: Filter = 'all';
let roleFilter: SubRole | 'all' = 'all';
let busy = false;
let armed: string | null = null;
let draft: { user: string; role: SubRole; plan: SubPlan; products: number; start: string; end: string; amount: number; paid: boolean; note: string } | null = null;

const holds = (p: Profile, r: SubRole) => p.role !== 'admin' && (r === 'organizer' ? !!p.is_organizer || p.role === 'organizer' : r === 'trainer' ? !!p.is_trainer : r === 'hall' ? !!p.is_hall : !!p.is_seller);
const personOf = (id: string) => people.find((p) => p.id === id);

function draftForm(p: Profile): string {
  if (!draft || !settings) return '';
  const d = draft;
  return `<form class="sub-form rise" data-form="dk-sub-add">
    <h3>➕ ${t('subA.newTitle', { name: esc(p.full_name), role: roleName(d.role) })}</h3>
    <div class="choice">${plansFor(d.role).map((pl) => `<button type="button" data-act="dk-sub-plan" data-v="${pl}" aria-pressed="${d.plan === pl}">${t(`sub.plan.${pl}` as MessageKey)}</button>`).join('')}</div>
    <div class="dk-form">
      ${d.plan === 'per_product' ? `<label class="field"><span>${t('subA.productsN')} <small class="muted">${t('subA.activeNow', { n: n(activeBySeller.get(d.user) ?? 0) })}</small></span>
        <input class="input" id="dkSubN" data-act="dk-sub-n" type="number" min="1" max="${settings.seller_max_products}" value="${d.products}"></label>` : ''}
      <label class="field"><span>${t('subA.start')}</span><input class="input" id="dkSubStart" data-act="dk-sub-start" type="date" value="${d.start}"></label>
      <label class="field"><span>${t('subA.end')}</span><input class="input" id="dkSubEnd" type="date" value="${d.end}"></label>
      <label class="field"><span>${t('subA.amount')}</span><input class="input" id="dkSubAmt" inputmode="decimal" value="${d.amount}"></label>
      <label class="field"><span>${t('subA.note')}</span><input class="input" id="dkSubNote" maxlength="120" value="${esc(d.note)}" placeholder="${esc(t('subA.notePh'))}"></label>
    </div>
    <label class="row"><input type="checkbox" id="dkSubPaid" ${d.paid ? 'checked' : ''}> <b>${t('subA.paidNow')}</b></label>
    <p class="hint">${esc(t('subA.paidNowHint'))}</p>
    <div class="row"><button class="btn green" ${busy ? 'disabled' : ''}>${icon('check', 16)} ${t('subA.save')}</button>
      <button type="button" class="btn ghost" data-act="dk-sub-cancel">${t('common.cancel')}</button></div>
  </form>`;
}

function pricesForm(s: PlanSettings): string {
  const f = (id: string, label: MessageKey, v: number) => `<label class="field"><span>${t(label)}</span><input class="input" id="${id}" inputmode="decimal" value="${v}"></label>`;
  return `<form class="card" data-form="dk-sub-prices">
    <h2>🏷️ ${t('subA.pricesTitle')}</h2>${tip('subA.pricesHint')}
    <div class="dk-form sub-prices-form">
      ${f('spOrgM', 'subA.orgMonth', s.org_month)}${f('spOrgY', 'subA.orgYear', s.org_year)}
      ${f('spTrM', 'subA.trMonth', s.trainer_month)}${f('spTrY', 'subA.trYear', s.trainer_year)}
      ${f('spHaM', 'subA.hallMonth', s.hall_month)}${f('spHaY', 'subA.hallYear', s.hall_year)}
      ${f('spPer', 'subA.perProduct', s.seller_per_product)}${f('spMax', 'subA.maxProducts', s.seller_max_products)}
      ${f('spUnl', 'subA.unlimited', s.seller_unlimited)}
    </div>
    <button class="btn green small" ${busy ? 'disabled' : ''}>${icon('check', 14)} ${t('desk.save')}</button>
  </form>`;
}

export function adminPage(): string {
  if (!all || !settings) {
    if (!notReady) loadAll();
    return notReady ? empty('money', t('sub.notReady')) : `<div class="card center muted"><span class="spin"></span> ${t('reg.loading')}</div>`;
  }
  const s = settings;
  const subs = all;
  const today = todayIso();
  const rev = revenue(subs, today);
  const rows: { p: Profile; role: SubRole; st: SubStatus }[] = [];
  for (const p of people) for (const r of SUB_ROLES) if (holds(p, r)) rows.push({ p, role: r, st: statusOf(subs, p.id, r, today) });
  const activeCount = rows.filter((x) => x.st.state === 'active' || x.st.state === 'soon').length;
  const shown = rows
    .filter((x) => roleFilter === 'all' || x.role === roleFilter)
    .filter((x) => filter === 'all' || (filter === 'active' ? x.st.state === 'active' : x.st.state !== 'active' || x.st.due > 0))
    .sort((a, b) => (a.st.daysLeft ?? -9999) - (b.st.daysLeft ?? -9999));
  const counts = (f: Filter) => rows.filter((x) => (roleFilter === 'all' || x.role === roleFilter) && (f === 'all' || (f === 'active' ? x.st.state === 'active' : x.st.state !== 'active' || x.st.due > 0))).length;

  return `<section class="banner b-admin slim"><div><h1>${icon('money', 26)} ${t('subA.title')}</h1><p>${t('subA.hint')}</p></div>
    <a class="btn soft small" href="#/desk/admin">${icon('back', 14)} ${t('desk.back')}</a></section>
  <div class="stats dash-stats">
    ${statTile('money', money(rev.collected), 'subA.collected')}
    ${statTile('calendar', money(rev.thisMonth), 'subA.thisMonth')}
    ${statTile('bell', money(rev.due), 'subA.due', rev.due > 0)}
    ${statTile('users', n(activeCount), 'subA.activeCount')}
  </div>
  <p class="small muted center">${t('subA.byRole', { o: money(rev.byRole.organizer), t: money(rev.byRole.trainer), s: money(rev.byRole.seller) })}</p>
  <div class="card">
    <div class="row between"><h2>👥 ${t('subA.people')}</h2>
      <div class="choice">${(['all', 'attention', 'active'] as Filter[]).map((f) => `<button data-act="dk-sub-filter" data-v="${f}" aria-pressed="${filter === f}">${t(`subA.f.${f}` as MessageKey)} <small>${n(counts(f))}</small></button>`).join('')}</div></div>
    <div class="choice sub-roles">${(['all', ...SUB_ROLES] as const).map((r) => `<button data-act="dk-sub-role" data-v="${r}" aria-pressed="${roleFilter === r}">${r === 'all' ? t('subA.f.all') : roleName(r)}</button>`).join('')}</div>
    ${tip('subA.peopleHint')}
    <div class="dk-lines">${shown.length ? shown.map(({ p, role, st }) => {
      const sub = [roleName(role), st.current ? planName(st.current) : '', st.endsOn ? t('subA.until', { d: fmtDate(st.endsOn) }) : '',
        role === 'seller' ? t('subA.activeNow', { n: n(activeBySeller.get(p.id) ?? 0) }) : ''].filter(Boolean).join(' · ');
      const open = draft?.user === p.id && draft.role === role;
      return `<div class="dk-line ${st.state === 'expired' ? 'pend' : st.state === 'active' ? 'paid' : ''}">${avatarOf(p)}
        <span class="dk-who"><b dir="auto">${esc(p.full_name)}</b><small class="muted">${sub}</small></span>
        <span class="dk-end">${stateBadge(st)}${st.due > 0 ? `<b class="dk-price due-amt">${money(st.due)}</b>` : ''}
          <button class="btn small ${open ? 'soft' : 'green'}" data-act="dk-sub-new" data-u="${p.id}" data-r="${role}">${icon('plus', 14)} ${t('subA.record')}</button></span></div>
        ${open ? draftForm(p) : ''}`;
    }).join('') : `<p class="muted">${t('subA.noPeople')}</p>`}</div>
  </div>
  <div class="card">
    <h2>🧾 ${t('subA.ledger')}</h2>${tip('subA.ledgerHint')}
    <div class="dk-lines">${subs.length ? subs.slice(0, 80).map((x) => {
      const p = personOf(x.user_id);
      return `<div class="dk-line ${x.paid ? 'paid' : 'pend'}">${avatarOf(p)}
        <span class="dk-who"><b dir="auto">${esc(p?.full_name ?? '?')}</b><small class="muted">${roleName(x.role)} · ${planName(x)} · ${t('subA.period', { from: fmtDate(x.starts_on), to: fmtDate(x.ends_on) })}${x.note ? ` · <span dir="auto">${esc(x.note)}</span>` : ''}</small></span>
        <span class="dk-end"><b class="dk-price">${money(x.amount)}</b>
          <label class="paid-tick ${x.paid ? 'on' : ''}" title="${esc(t('desk.pay.tickTip'))}"><input type="checkbox" data-act="dk-sub-paid" data-id="${x.id}" ${x.paid ? 'checked' : ''}>
            <span>${x.paid ? `${icon('check', 14)} ${t('desk.pay.paid')}` : t('desk.pay.unpaid')}</span></label>
          <button class="btn small ${armed === x.id ? 'red' : 'ghost'}" data-act="dk-sub-del" data-id="${x.id}" title="${esc(t('subA.del'))}">${armed === x.id ? t('subA.delSure') : icon('trash', 14)}</button></span></div>`;
    }).join('') : `<p class="muted">${t('subA.noLedger')}</p>`}</div>
  </div>
  ${pricesForm(s)}`;
}

/** Small revenue line for the admin tool's front page. */
export function adminSummary(): string {
  if (!all) { if (!notReady) loadAll(); return ''; }
  const rev = revenue(all);
  return `<a class="card sub-sum" href="#/desk/admin/subs"><b>💰 ${t('desk.admin.subs')}</b>
    <span>${t('subA.collected')}: <b>${money(rev.collected)}</b></span><span>${t('subA.thisMonth')}: <b>${money(rev.thisMonth)}</b></span>
    <span class="${rev.due > 0 ? 'due-amt' : ''}">${t('subA.due')}: <b>${money(rev.due)}</b></span></a>`;
}

/* ------------------------------------------------------------ events */

function keepDraft(): void {
  if (!draft) return;
  const num = (id: string) => Number((val(id) || '').replace(/[^\d.]/g, ''));
  if (document.getElementById('dkSubStart')) draft.start = val('dkSubStart') || draft.start;
  if (document.getElementById('dkSubEnd')) draft.end = val('dkSubEnd') || draft.end;
  if (document.getElementById('dkSubAmt')) draft.amount = num('dkSubAmt');
  if (document.getElementById('dkSubN')) draft.products = settings ? clampProducts(num('dkSubN'), settings) : draft.products;
  draft.paid = (document.getElementById('dkSubPaid') as HTMLInputElement | null)?.checked ?? draft.paid;
  draft.note = val('dkSubNote');
}

export async function onClick(act: string, el: HTMLElement): Promise<boolean> {
  switch (act) {
    case 'dk-sub-filter': filter = el.dataset.v as Filter; render(); return true;
    case 'dk-sub-role': roleFilter = el.dataset.v as SubRole | 'all'; render(); return true;
    case 'dk-sub-cancel': draft = null; render(); return true;
    case 'dk-sub-new': {
      const user = el.dataset.u!, role = el.dataset.r as SubRole;
      if (draft?.user === user && draft.role === role) { draft = null; render(); return true; }
      if (!all || !settings) return true;
      const sg = suggestion(statusOf(all, user, role), role, settings, activeBySeller.get(user) ?? 0);
      draft = { user, role, ...sg, paid: true, note: '' };
      render(); return true;
    }
    case 'dk-sub-plan':
      if (!draft || !settings) return true;
      keepDraft();
      draft.plan = el.dataset.v as SubPlan;
      draft.end = periodEnd(draft.start, draft.plan);
      draft.amount = priceOf(settings, draft.role, draft.plan, draft.products);
      render(); return true;
    case 'dk-sub-del': {
      const id = el.dataset.id!;
      if (armed !== id) { armed = id; render(); return true; }
      armed = null;
      try {
        check(await db().from('subscriptions').delete().eq('id', id));
        all = all?.filter((x) => x.id !== id) ?? null;
        toast(t('subA.deleted'));
      } catch (e) { toast(authErr(e)); }
      render(); return true;
    }
  }
  return false;
}

export async function onChange(el: HTMLInputElement): Promise<boolean> {
  const act = el.dataset.act;
  if (act === 'dk-sub-paid') {
    const x = all?.find((s) => s.id === el.dataset.id);
    try {
      const row = check(await db().from('subscriptions').update({ paid: el.checked }).eq('id', el.dataset.id!).select('*').single()) as Subscription;
      if (x) Object.assign(x, row, { amount: Number(row.amount) });
    } catch (e) { toast(authErr(e)); el.checked = !el.checked; }
    render(); return true;
  }
  if ((act === 'dk-sub-start' || act === 'dk-sub-n') && draft && settings) {
    keepDraft();
    if (act === 'dk-sub-start') draft.end = periodEnd(draft.start, draft.plan);
    else draft.amount = priceOf(settings, draft.role, draft.plan, draft.products);
    render(); return true;
  }
  return false;
}

export async function onSubmit(kind: string): Promise<boolean> {
  if (kind === 'dk-sub-prices') {
    const num = (id: string, fallback: number) => { const v = Number(val(id).replace(/[^\d.]/g, '')); return Number.isFinite(v) && val(id) !== '' ? v : fallback; };
    const s = settings ?? cleanSettings(null);
    const next = cleanSettings({
      org_month: num('spOrgM', s.org_month), org_year: num('spOrgY', s.org_year),
      trainer_month: num('spTrM', s.trainer_month), trainer_year: num('spTrY', s.trainer_year),
      hall_month: num('spHaM', s.hall_month), hall_year: num('spHaY', s.hall_year),
      seller_per_product: num('spPer', s.seller_per_product), seller_max_products: num('spMax', s.seller_max_products),
      seller_unlimited: num('spUnl', s.seller_unlimited),
    });
    busy = true; render();
    try {
      check(await db().from('plan_settings').update({ ...next, updated_at: new Date().toISOString() }).eq('id', true));
      settings = next;
      toast(`✅ ${t('subA.pricesSaved')}`);
    } catch (e) { toast(authErr(e)); }
    busy = false; render(); return true;
  }
  if (kind === 'dk-sub-add') {
    if (!draft) return true;
    keepDraft();
    const d = draft;
    if (!d.start || !d.end || d.end < d.start) { toast(t('subA.badDates')); return true; }
    busy = true; render();
    try {
      const row = check(await db().from('subscriptions').insert({
        user_id: d.user, role: d.role, plan: d.plan, products: d.plan === 'per_product' ? d.products : null,
        amount: Math.max(0, d.amount || 0), starts_on: d.start, ends_on: d.end, paid: d.paid, note: d.note || null,
      }).select('*').single()) as Subscription;
      all = [{ ...row, amount: Number(row.amount) }, ...(all ?? [])];
      draft = null;
      toast(`✅ ${t('subA.saved')}`);
    } catch (e) { toast(authErr(e)); }
    busy = false; render(); return true;
  }
  return false;
}
