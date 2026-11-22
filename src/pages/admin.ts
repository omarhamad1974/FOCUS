/** Admin control screen: one place for approvals, people, news, products, tournaments and the journey simulator. */
import { dateFmt, t, type MessageKey } from '../i18n/ar';
import * as content from '../data/content';
import type { AdminCounts, Post, Product, RoleRequest } from '../data/content';
import * as remote from '../data/remote';
import { remoteStatus } from '../domain/tournament';
import { authErr, hint, money, n, preview, PREVIEWS, render, session, type Preview } from '../app/ctx';
import { CONFIRM_WORD, confirmed, holdsRole, planRoleRemoval, roleOff, type BulkRole } from '../domain/bulk';
import { cover } from '../ui/art';
import { icon } from '../ui/icons';
import { avatarOf, esc, toast } from '../ui/util';
import { CAT_ICON as NEWS_ICON } from './news';
import { CAT_ICON as SHOP_ICON } from './shop';

type Tab = 'home' | 'approvals' | 'users' | 'news' | 'shop' | 'tournaments' | 'bulk' | 'sim';
const TABS: [Tab, string, MessageKey][] = [
  ['home', 'grid', 'adm.tab.home'], ['approvals', 'check', 'adm.tab.approvals'], ['users', 'users', 'adm.tab.users'],
  ['news', 'news', 'adm.tab.news'], ['shop', 'shop', 'adm.tab.shop'], ['tournaments', 'trophy', 'adm.tab.tournaments'],
  ['bulk', 'trash', 'adm.tab.bulk'], ['sim', 'eye', 'adm.tab.sim'],
];

let counts: AdminCounts | null = null;
let requests: RoleRequest[] | null = null;
let posts: Post[] | null = null;
let products: Product[] | null = null;
let tournaments: { id: string; name: string; status: string; organizer_id: string; players: number; date: string | null; cover: string | null }[] | null = null;
let profiles: remote.Profile[] | null = null;
let busy = false;

/** The accounts page (unconfirmed sign-ups, create account, roles) lives in main. */
let usersView: () => string = () => '';
export const setUsersView = (fn: () => string) => { usersView = fn; };
/** Reloads the app's own tournament list after a bulk delete (set by main). */
let afterBulk: () => Promise<void> = async () => undefined;
export const setAfterBulk = (fn: () => Promise<void>) => { afterBulk = fn; };

export function reset(): void { counts = null; requests = null; posts = null; products = null; tournaments = null; profiles = null; }

function loadAll(): void {
  if (busy) return;
  busy = true;
  Promise.all([
    content.adminCounts(), content.pendingRoleRequests(), content.listPosts(1000), content.listProducts(), listTournamentRows(), remote.listProfiles(),
  ]).then(async ([c, r, p, pr, tr, pf]) => {
    counts = c; requests = r; posts = p; products = pr; tournaments = tr; profiles = pf;
    await content.people([...r.map((x) => x.user_id), ...pr.map((x) => x.seller_id), ...tr.map((x) => x.organizer_id)]);
  }).catch((e) => { toast(authErr(e)); counts = counts ?? ({} as AdminCounts); requests = requests ?? []; posts = posts ?? []; products = products ?? []; tournaments = tournaments ?? []; profiles = profiles ?? []; })
    .finally(() => { busy = false; render(); });
}

async function listTournamentRows() {
  const rows = (await remote.listTournaments());
  return rows.map((x) => ({ id: x.id, name: x.name, status: remoteStatus(x), organizer_id: x.organizerId ?? '', players: x.players.length, date: x.date || null, cover: x.cover ?? null }));
}

export function page(parts: string[]): string {
  const tab = (TABS.some(([k]) => k === parts[1]) ? parts[1] : 'home') as Tab;
  if (counts === null && tab !== 'users' && tab !== 'sim') { loadAll(); }
  const pending = (counts?.pendingRoles ?? 0) + (counts?.pendingProducts ?? 0);
  const nav = `<nav class="adm-tabs">${TABS.map(([k, ic, label]) => `<a href="#/admin/${k}" ${k === tab ? 'aria-current="page"' : ''}>${icon(ic, 18)}<span>${t(label)}</span>
    ${k === 'approvals' && pending ? `<i class="dot">${n(pending)}</i>` : ''}</a>`).join('')}</nav>`;
  const head = `<section class="banner b-admin slim"><div><h1>${icon('shield', 26)} ${t('adm.title')}</h1><p>${t('adm.subtitle')}</p></div></section>`;
  const loading = `<div class="card center muted"><span class="spin"></span> ${t('reg.loading')}</div>`;
  let body = '';
  if (tab === 'users') body = usersView();
  else if (tab === 'sim') body = simView();
  else if (counts === null || requests === null) body = loading;
  else if (tab === 'home') body = homeView();
  else if (tab === 'approvals') body = approvalsView();
  else if (tab === 'news') body = newsView();
  else if (tab === 'shop') body = shopView();
  else if (tab === 'bulk') body = bulkView(parts[2]);
  else body = tournamentsView();
  return head + nav + body;
}

function homeView(): string {
  const c = counts!;
  const tile = (href: string, ic: string, value: number | undefined, label: MessageKey, hot = false) =>
    `<a class="stat adm-stat ${hot && value ? 'hot' : ''}" href="${href}">${icon(ic, 24)}<b>${n(value ?? 0)}</b><small>${t(label)}</small></a>`;
  return `<div class="adm-grid">
    ${tile('#/admin/approvals', 'bell', (c.pendingRoles ?? 0) + (c.pendingProducts ?? 0), 'adm.c.pending', true)}
    ${tile('#/admin/users', 'users', c.users, 'adm.c.users')}
    ${tile('#/admin/tournaments', 'trophy', c.running, 'adm.c.running')}
    ${tile('#/admin/news', 'news', c.posts, 'adm.c.posts')}
    ${tile('#/admin/shop', 'shop', c.products, 'adm.c.products')}
    ${tile('#/admin/shop', 'cart', c.orders, 'adm.c.orders')}
    ${tile('#/training', 'calendar', c.bookings, 'adm.c.bookings')}
    ${tile('#/admin/users', 'coach', c.trainers, 'adm.c.trainers')}
  </div>
  <div class="card"><h3>${icon('bolt', 20)} ${t('adm.quick')}</h3>
    <div class="quick-actions">
      <a class="qa" href="#/news/new">${icon('edit', 22)}<span>${t('news.write')}</span></a>
      <a class="qa" href="#/new">${icon('trophy', 22)}<span>${t('home.create')}</span></a>
      <a class="qa" href="#/admin/users">${icon('user', 22)}<span>${t('users.create')}</span></a>
      <a class="qa" href="#/admin/approvals">${icon('check', 22)}<span>${t('adm.tab.approvals')}</span></a>
      <a class="qa" href="#/admin/bulk">${icon('trash', 22)}<span>${t('adm.tab.bulk')}</span></a>
      <a class="qa" href="#/admin/sim">${icon('eye', 22)}<span>${t('adm.tab.sim')}</span></a>
      <a class="qa" href="#/players">${icon('users', 22)}<span>${t('dir.link')}</span></a>
      <a class="qa" href="#/players/batch">${icon('plus', 22)}<span>${t('batch.title')}</span></a>
    </div></div>`;
}

function approvalsView(): string {
  const pendingProducts = products!.filter((p) => !p.approved);
  const roleIcon: Record<string, string> = { organizer: 'trophy', seller: 'shop', trainer: 'coach' };
  return `<div class="card"><h2>${icon('star', 22)} ${t('roles.requests')}</h2>${hint('roles.requestsHint')}
    ${requests!.length ? requests!.map((r) => `<div class="chip ro">${avatarOf(content.person(r.user_id))}
      <span><b dir="auto">${esc(content.personName(r.user_id))}</b><br><span class="badge blue">${icon(roleIcon[r.role], 14)} ${t(`roles.${r.role}` as MessageKey)}</span>
      ${r.note ? ` <span class="muted small" dir="auto">${esc(r.note)}</span>` : ''}</span>
      <span class="row" style="margin-inline-start:auto;gap:6px"><button class="btn green small" data-act="adm-role" data-id="${r.id}" data-v="yes">${icon('check', 14)} ${t('roles.approve')}</button>
      <button class="btn ghost small" data-act="adm-role" data-id="${r.id}" data-v="no" aria-label="${esc(t('adm.reject'))}">${icon('x', 14)}</button></span></div>`).join('')
      : `<p class="muted">${t('adm.noRequests')}</p>`}</div>
  <div class="card"><h2>${icon('box', 22)} ${t('adm.pendingProducts')}</h2>${hint('adm.pendingProductsHint')}
    ${pendingProducts.length ? pendingProducts.map(productRow).join('') : `<p class="muted">${t('adm.noPendingProducts')}</p>`}</div>`;
}

function productRow(p: Product): string {
  return `<div class="adm-row">${cover(p.image_url, p.id, SHOP_ICON[p.category], esc(p.name))}
    <div class="adm-row-main"><a href="#/shop/p/${p.id}"><b dir="auto">${esc(p.name)}</b></a>
      <span class="muted small" dir="auto">${icon('shop', 12)} ${esc(content.personName(p.seller_id))} · ${money(p.price)} · ${t('shop.inStock', { n: p.stock })}</span>
      <span class="row" style="gap:6px">${p.approved ? `<span class="badge green">${t('adm.approved')}</span>` : `<span class="badge gold">${t('adm.waiting')}</span>`}
        ${p.featured ? `<span class="badge gold">${icon('star', 12)} ${t('shop.featured')}</span>` : ''}${p.active ? '' : `<span class="badge">${t('shop.hidden')}</span>`}</span></div>
    <div class="adm-row-actions">
      ${p.approved ? `<button class="btn soft small" data-act="adm-prod" data-id="${p.id}" data-f="featured" data-v="${p.featured ? '0' : '1'}">${icon('star', 14)} ${t(p.featured ? 'adm.unfeature' : 'adm.feature')}</button>
        <button class="btn ghost small" data-act="adm-prod" data-id="${p.id}" data-f="approved" data-v="0">${t('adm.unapprove')}</button>`
      : `<button class="btn green small" data-act="adm-prod" data-id="${p.id}" data-f="approved" data-v="1">${icon('check', 14)} ${t('roles.approve')}</button>
        <button class="btn ghost small" data-act="adm-prod-del" data-id="${p.id}">${icon('trash', 14)} ${t('adm.reject')}</button>`}
    </div></div>`;
}

function shopView(): string {
  const list = [...products!].sort((a, b) => Number(b.featured) - Number(a.featured) || Number(a.approved) - Number(b.approved));
  return `<div class="card"><div class="row between"><h2>${icon('shop', 22)} ${t('adm.allProducts')}</h2><a class="btn soft small" href="#/shop">${t('roles.open')}</a></div>
    ${hint('adm.featuredHint')}
    ${list.length ? list.map(productRow).join('') : `<p class="muted">${t('shop.empty')}</p>`}</div>`;
}

function newsView(): string {
  return `<div class="card"><div class="row between"><h2>${icon('news', 22)} ${t('adm.tab.news')}</h2>
    <a class="btn gold small" href="#/news/new">${icon('edit', 16)} ${t('news.write')}</a></div>${hint('adm.newsHint')}
    ${posts!.length ? posts!.map((p) => `<div class="adm-row">${cover(p.cover_url, p.id, NEWS_ICON[p.category], esc(p.title))}
      <div class="adm-row-main"><a href="#/news/${p.id}"><b dir="auto">${esc(p.title)}</b></a>
        <span class="muted small">${t(`news.cat.${p.category}` as MessageKey)} · ${dateFmt.format(new Date(p.created_at))}</span>
        <span>${p.published ? `<span class="badge green">${t('adm.published')}</span>` : `<span class="badge gold">${t('news.draft')}</span>`}</span></div>
      <div class="adm-row-actions"><a class="btn soft small" href="#/news/${p.id}/edit">${icon('edit', 14)} ${t('news.edit')}</a>
        <button class="btn ghost small" data-act="adm-post-pub" data-id="${p.id}" data-v="${p.published ? '0' : '1'}">${t(p.published ? 'adm.unpublish' : 'adm.publish')}</button></div></div>`).join('')
      : `<p class="muted">${t('news.empty')}</p>`}</div>`;
}

function tournamentsView(): string {
  const label: Record<string, MessageKey> = { draft: 'adm.st.draft', registration: 'reg.badge', running: 'home.liveNow', finished: 'stage.champion' };
  const missing = tournaments!.filter((x) => !x.cover).length;
  return `<div class="card"><div class="row between"><h2>${icon('trophy', 22)} ${t('adm.tab.tournaments')}</h2>
    <a class="btn gold small" href="#/new">${icon('plus', 16)} ${t('home.create')}</a></div>
    ${hint('tl.adminCoverHint')}
    ${missing ? `<p class="small"><span class="badge gold">${icon('image', 12)} ${t('tl.missingCovers', { n: missing })}</span></p>` : ''}
    ${tournaments!.length ? tournaments!.map((x) => `<div class="adm-row">
      ${cover(x.cover ? esc(x.cover) : null, x.id, 'trophy', esc(x.name))}
      <div class="adm-row-main"><a href="#/t/${x.id}"><b dir="auto">${esc(x.name)}</b></a>
        <span class="muted small" dir="auto">${icon('user', 12)} ${esc(content.personName(x.organizer_id) || '—')} · ${n(x.players)} ${t('t.players')}${x.date ? ` · ${dateFmt.format(new Date(x.date))}` : ''}</span>
        <span><span class="badge ${x.status === 'running' ? 'green' : x.status === 'registration' ? 'gold' : ''}">${t(label[x.status] ?? 'adm.st.draft')}</span></span></div>
      <div class="adm-row-actions">
        <label class="btn ${x.cover ? 'soft' : 'gold'} small">${icon('image', 14)} ${t(x.cover ? 'media.change' : 'tl.coverUpload')}<input type="file" accept="image/*" class="hidden" data-act="t-cover" data-tid="${x.id}"></label>
        ${x.cover ? `<button class="btn ghost small" data-act="t-cover-del" data-tid="${x.id}" aria-label="${esc(t('media.remove'))}">${icon('trash', 14)}</button>` : ''}
      </div></div>`).join('')
      : `<p class="muted">${t('home.empty')}</p>`}</div>`;
}

/* Bulk delete: pick a type, tick items (or all), then type the confirm word. */
type BulkKind = 'tournaments' | 'products' | 'posts' | BulkRole;
const KINDS: [BulkKind, string, MessageKey][] = [
  ['tournaments', 'trophy', 'bulk.k.tournaments'], ['products', 'shop', 'bulk.k.products'], ['posts', 'news', 'bulk.k.posts'],
  ['organizer', 'trophy', 'bulk.k.organizer'], ['seller', 'shop', 'bulk.k.seller'], ['trainer', 'coach', 'bulk.k.trainer'], ['player', 'user', 'bulk.k.player'],
];
const isRole = (k: BulkKind): k is BulkRole => k === 'organizer' || k === 'seller' || k === 'trainer' || k === 'player';

const bulk: { kind: BulkKind | null; selected: Set<string>; confirm: string[] | null; running: boolean } = { kind: null, selected: new Set(), confirm: null, running: false };

interface BulkItem { id: string; title: string; sub: string; pic: string }

function bulkItems(kind: BulkKind): BulkItem[] {
  if (kind === 'tournaments') return tournaments!.map((x) => ({ id: x.id, title: x.name, sub: `${esc(content.personName(x.organizer_id) || '—')} · ${n(x.players)} ${t('t.players')}`, pic: cover(x.cover ? esc(x.cover) : null, x.id, 'trophy', esc(x.name)) }));
  if (kind === 'products') return products!.map((p) => ({ id: p.id, title: p.name, sub: `${esc(content.personName(p.seller_id))} · ${money(p.price)}`, pic: cover(p.image_url, p.id, SHOP_ICON[p.category], esc(p.name)) }));
  if (kind === 'posts') return posts!.map((p) => ({ id: p.id, title: p.title, sub: `${t(`news.cat.${p.category}` as MessageKey)} · ${dateFmt.format(new Date(p.created_at))}`, pic: cover(p.cover_url, p.id, NEWS_ICON[p.category], esc(p.title)) }));
  const me = session.profile?.id;
  return (profiles ?? []).filter((p) => p.id !== me && holdsRole(p, kind)).map((p) => ({
    id: p.id, title: p.full_name || '—',
    sub: [p.club ? esc(p.club) : '', ...(['organizer', 'seller', 'trainer'] as const).filter((r) => holdsRole(p, r)).map((r) => `<span class="badge ${r === kind ? 'red' : ''}">${t(`roles.${r}` as MessageKey)}</span>`)].filter(Boolean).join(' '),
    pic: `<span class="bulk-av">${avatarOf(p)}</span>`,
  }));
}

function bulkView(kindPart: string | undefined): string {
  const kind = KINDS.some(([k]) => k === kindPart) ? kindPart as BulkKind : null;
  if (kind !== bulk.kind) { bulk.kind = kind; bulk.selected.clear(); bulk.confirm = null; }
  const tiles = `<div class="bulk-kinds">${KINDS.map(([k, ic, label]) => `<a class="bulk-kind ${k === kind ? 'on' : ''}" href="#/admin/bulk/${k}" ${k === kind ? 'aria-current="page"' : ''}>
    ${icon(ic, 22)}<b>${n(bulkItems(k).length)}</b><small>${t(label)}</small></a>`).join('')}</div>`;
  const intro = `<div class="card bulk-warn"><h2>${icon('trash', 22)} ${t('adm.tab.bulk')}</h2>${hint('bulk.hint')}${tiles}</div>`;
  if (!kind) return intro;
  const items = bulkItems(kind);
  const sel = items.filter((x) => bulk.selected.has(x.id));
  const all = items.length > 0 && sel.length === items.length;
  const list = items.length ? `<label class="bulk-all"><input type="checkbox" data-act="adm-sel-all" ${all ? 'checked' : ''}> ${t('bulk.selectAll')} <span class="muted">(${n(sel.length)} / ${n(items.length)})</span></label>
    <div class="bulk-list">${items.map((x) => `<label class="bulk-item ${bulk.selected.has(x.id) ? 'on' : ''}"><input type="checkbox" data-act="adm-sel" data-id="${x.id}" ${bulk.selected.has(x.id) ? 'checked' : ''}>
      ${x.pic}<span class="adm-row-main"><b dir="auto">${esc(x.title)}</b><span class="muted small" dir="auto">${x.sub}</span></span></label>`).join('')}</div>`
    : `<p class="muted">${t('bulk.empty')}</p>`;
  const actions = items.length && !bulk.confirm ? `<div class="row bulk-actions">
    <button class="btn red" data-act="adm-bulk-ask" data-v="sel" ${sel.length ? '' : 'disabled'}>${icon('trash', 16)} ${t('bulk.deleteSelected', { n: sel.length })}</button>
    <button class="btn ghost" data-act="adm-bulk-ask" data-v="all">${icon('trash', 16)} ${t('bulk.deleteAll', { n: items.length })}</button></div>` : '';
  const label = t(KINDS.find(([k]) => k === kind)![2]);
  return `${intro}<div class="card"><h2>${icon(KINDS.find(([k]) => k === kind)![1], 22)} ${label}</h2>${isRole(kind) ? hint(`bulk.roleHint.${kind}` as MessageKey) : ''}
    ${bulk.confirm ? confirmBox(kind, label) : ''}${actions}${list}</div>`;
}

function confirmBox(kind: BulkKind, label: string): string {
  const ids = bulk.confirm!;
  let detail = `<p><b>${t('bulk.willDelete', { n: ids.length, what: label })}</b></p>`;
  if (isRole(kind)) {
    const plan = planRoleRemoval(profiles ?? [], kind, ids, session.profile?.id);
    detail = `<ul class="bulk-plan">${plan.deleteAccounts.length ? `<li>${icon('trash', 14)} ${t('bulk.planDelete', { n: plan.deleteAccounts.length })}</li>` : ''}
      ${plan.removeRole.length ? `<li>${icon('user', 14)} ${t('bulk.planRole', { n: plan.removeRole.length, role: t(`roles.${kind}` as MessageKey) })}</li>` : ''}
      ${kind === 'organizer' && plan.deleteAccounts.length ? `<li>${icon('trophy', 14)} ${t('bulk.planKeepTournaments')}</li>` : ''}</ul>`;
  } else if (kind === 'tournaments') detail += `<p class="small">${t('bulk.tournamentsNote')}</p>`;
  return `<div class="bulk-confirm" role="alertdialog" aria-labelledby="bulkQ">
    <h3 id="bulkQ">${icon('bell', 20)} ${t('bulk.sure')}</h3>${detail}
    <p class="small">${t('bulk.noUndo')}</p>
    <label class="field"><span>${t('bulk.typeWord', { word: CONFIRM_WORD })}</span><input class="input" id="bulkWord" dir="auto" autocomplete="off" data-act="adm-bulk-type" placeholder="${CONFIRM_WORD}"></label>
    <div class="row"><button class="btn red" id="bulkGo" data-act="adm-bulk-go" disabled>${bulk.running ? '<span class="spin"></span>' : icon('trash', 16)} ${t('bulk.confirmBtn', { n: ids.length })}</button>
    <button class="btn ghost" data-act="adm-bulk-cancel">${t('bulk.cancel')}</button></div></div>`;
}

/** Checkbox clicks (the main click handler skips inputs). */
export function onChange(el: HTMLInputElement): boolean {
  if (el.dataset.act === 'adm-sel') {
    if (el.checked) bulk.selected.add(el.dataset.id!); else bulk.selected.delete(el.dataset.id!);
  } else if (el.dataset.act === 'adm-sel-all') {
    bulk.selected = new Set(el.checked && bulk.kind ? bulkItems(bulk.kind).map((x) => x.id) : []);
  } else return false;
  bulk.confirm = null;
  render();
  return true;
}

/** The confirm button wakes up only after the exact word is typed. */
export function onInput(el: HTMLInputElement): boolean {
  if (el.dataset.act !== 'adm-bulk-type') return false;
  const go = document.getElementById('bulkGo') as HTMLButtonElement | null;
  if (go) go.disabled = bulk.running || !confirmed(el.value);
  return true;
}

/** A clear reason instead of the generic "try again" message. */
function bulkError(e: unknown): string {
  const code = remote.errorCode(e);
  if (code === 'noFunction') return t('users.functionMissing');
  if (code !== 'unknown') return authErr(e);
  const why = e instanceof Error ? e.message : String(e);
  console.warn('Pingo bulk delete failed:', e);
  return /non-2xx|unknown action/i.test(why) ? t('bulk.oldFunction') : t('bulk.failedWhy', { why });
}

async function runBulk(kind: BulkKind, ids: string[]): Promise<string> {
  if (kind === 'tournaments') { await remote.deleteTournaments(ids); return t('bulk.done', { n: ids.length }); }
  if (kind === 'products') { await content.deleteProducts(ids); return t('bulk.done', { n: ids.length }); }
  if (kind === 'posts') { await content.deletePosts(ids); return t('bulk.done', { n: ids.length }); }
  const plan = planRoleRemoval(profiles ?? [], kind, ids, session.profile?.id);
  if (kind !== 'player' && plan.removeRole.length) {
    const groups = new Map<string, { fields: Record<string, unknown>; ids: string[] }>();
    for (const id of plan.removeRole) {
      const fields = roleOff(kind, profiles!.find((p) => p.id === id)!);
      const key = JSON.stringify(fields);
      (groups.get(key) ?? groups.set(key, { fields, ids: [] }).get(key)!).ids.push(id);
    }
    for (const g of groups.values()) await content.setRolesMany(g.ids, g.fields);
  }
  let deleted = 0;
  const failed: { id: string; error: string }[] = [];
  // Small calls: each one finishes quickly, and a problem stops after what was already done.
  for (const part of content.chunks(plan.deleteAccounts, 10)) {
    const r = await remote.deleteAccounts(part);
    deleted += r.deleted;
    failed.push(...(r.failed ?? []));
  }
  if (failed.length) {
    console.warn('Pingo bulk delete: accounts not deleted', failed);
    toast(t('bulk.someFailed', { n: failed.length, why: failed[0].error }));
  }
  return t('bulk.doneUsers', { n: deleted, m: plan.removeRole.length });
}

/* Journey simulator */
const STEPS: Record<Exclude<Preview, 'off'>, [string, string][]> = {
  guest: [['#/', 'home'], ['#/news', 'news'], ['#/tournaments', 'trophy'], ['#/shop', 'shop'], ['#/training', 'coach'], ['#/login', 'user']],
  player: [['#/tournaments', 'trophy'], ['#/training', 'calendar'], ['#/shop', 'cart'], ['#/me', 'user'], ['#/me', 'star']],
  organizer: [['#/new', 'plus'], ['#/tournaments', 'users'], ['#/tournaments', 'grid'], ['#/tournaments', 'users'], ['#/tournaments', 'image'], ['#/tournaments', 'trophy']],
  assistant: [['#/tournaments', 'trophy'], ['#/tournaments', 'edit'], ['#/tournaments', 'shield']],
  seller: [['#/shop/manage', 'box'], ['#/shop/new', 'plus'], ['#/admin/approvals', 'check'], ['#/shop/manage', 'bell']],
  trainer: [['#/training/manage', 'calendar'], ['#/training/manage', 'map'], ['#/training/manage', 'clock'], ['#/training/manage', 'users']],
  hall: [['#/desk/hall', 'table'], ['#/desk/hall', 'clock'], ['#/halls', 'calendar'], ['#/desk/hall', 'wallet']],
};

function simView(): string {
  const now = preview.as;
  return `<div class="card">${hint('sim.hint')}
    <div class="sim-grid">${PREVIEWS.map((r) => `<div class="sim-card ${now === r ? 'on' : ''}">
      <div class="row"><span class="role-ic">${icon(STEPS[r as Exclude<Preview, 'off'>][0][1], 24)}</span><div><b>${t(`sim.role.${r}` as MessageKey)}</b><br><small class="muted">${t(`sim.about.${r}` as MessageKey)}</small></div></div>
      <ol class="steps-list">${STEPS[r as Exclude<Preview, 'off'>].map(([href, ic], i) => `<li><a href="${href}" data-act="pv-go" data-v="${r}" data-href="${href}">${icon(ic, 16)} ${t(`sim.${r}.${i + 1}` as MessageKey)}</a></li>`).join('')}</ol>
      <button class="btn ${now === r ? 'soft' : 'gold'} block" data-act="pv-go" data-v="${r}" data-href="${STEPS[r as Exclude<Preview, 'off'>][0][0]}">${icon('eye', 18)} ${t(now === r ? 'sim.continue' : 'sim.start')}</button>
    </div>`).join('')}</div>
    ${now !== 'off' ? `<button class="btn ghost" data-act="pv-set" data-v="off">${icon('x', 16)} ${t('sim.exit')}</button>` : ''}</div>`;
}

export async function onClick(act: string, el: HTMLElement): Promise<void> {
  switch (act) {
    case 'pv-set':
      preview.as = el.dataset.v as Preview;
      toast(el.dataset.v === 'off' ? t('sim.ended') : `${t('sim.viewingAs')} ${t(`sim.role.${el.dataset.v}` as MessageKey)}`);
      render(); return;
    case 'pv-go': {
      preview.as = el.dataset.v as Preview;
      const href = el.dataset.href ?? '#/';
      if (location.hash === href) render(); else location.hash = href;
      return;
    }
    case 'adm-role':
      try { await content.decideRoleRequest(el.dataset.id!, el.dataset.v === 'yes'); toast(t('admin.saved')); } catch (e) { toast(authErr(e)); }
      reset(); render(); return;
    case 'adm-prod':
      try { await content.setProductFlags(el.dataset.id!, { [el.dataset.f!]: el.dataset.v === '1' }); toast(t('admin.saved')); } catch (e) { toast(authErr(e)); }
      reset(); render(); return;
    case 'adm-prod-del':
      if (el.dataset.armed !== '1') { el.dataset.armed = '1'; el.innerHTML = `${icon('trash', 14)} ${t('news.deleteConfirm')}`; return; }
      try { await content.deleteProduct(el.dataset.id!); toast(t('shop.deleted')); } catch (e) { toast(authErr(e)); }
      reset(); render(); return;
    case 'adm-bulk-ask':
      if (!bulk.kind) return;
      bulk.confirm = el.dataset.v === 'all' ? bulkItems(bulk.kind).map((x) => x.id) : [...bulk.selected];
      render();
      document.getElementById('bulkWord')?.focus();
      return;
    case 'adm-bulk-cancel':
      bulk.confirm = null; render(); return;
    case 'adm-bulk-go': {
      const word = (document.getElementById('bulkWord') as HTMLInputElement | null)?.value ?? '';
      if (!bulk.kind || !bulk.confirm?.length || bulk.running || !confirmed(word)) return;
      bulk.running = true;
      (el as HTMLButtonElement).disabled = true;
      try { toast(await runBulk(bulk.kind, bulk.confirm)); } catch (e) { toast(bulkError(e)); }
      bulk.running = false; bulk.confirm = null; bulk.selected.clear();
      render();
      await afterBulk().catch(() => undefined);
      reset(); render(); return;
    }
    case 'adm-post-pub': {
      const p = posts?.find((x) => x.id === el.dataset.id);
      if (!p) return;
      try { await content.savePost({ id: p.id, title: p.title, published: el.dataset.v === '1' }); toast(t('admin.saved')); } catch (e) { toast(authErr(e)); }
      reset(); render(); return;
    }
  }
}

