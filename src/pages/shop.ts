/** Shop: sellers list gear; players send order requests and pay on delivery or pickup. */
import { dateTimeFmt, t, type MessageKey } from '../i18n/ar';
import * as content from '../data/content';
import type { Order, OrderStatus, Product, ProductCategory } from '../data/content';
import { authErr, checked, hint, isAdmin, isSeller, loading, money, n, needLogin, render, session, val } from '../app/ctx';
import { cover, empty, skeleton } from '../ui/art';
import { icon } from '../ui/icons';
import { avatar, esc, toast } from '../ui/util';
import { nameKey } from '../domain/tournament';
import { imagePicker } from './news';

export const CAT_ICON: Record<ProductCategory, string> = {
  rackets: 'racket', rubbers: 'grid', balls: 'ball', tables: 'table', clothing: 'user', shoes: 'bolt', bags: 'shop', accessories: 'tag', other: 'box',
};

let products: Product[] | null = null;
let busy = false;
let filter: ProductCategory | 'all' = 'all';
let query = '';
let qty = 1;
let imageDraft: string | null | undefined;

let sales: Order[] | null = null;
let buyers = new Map<string, { full_name: string; phone: string | null }>();
let mine: Order[] | null = null;

export function load(force = false): void {
  if (busy || (products && !force)) return;
  busy = true;
  content.listProducts()
    .then(async (p) => { products = p; await content.people(p.map((x) => x.seller_id)); })
    .catch((e) => { products = []; toast(authErr(e)); })
    .finally(() => { busy = false; render(); });
}

export const featured = (count: number): Product[] | null => products && products.filter((p) => p.active && p.stock > 0).slice(0, count);

const catLabel = (c: ProductCategory) => t(`shop.cat.${c}` as MessageKey);
const statusLabel = (s: OrderStatus) => t(`shop.status.${s}` as MessageKey);
const STATUS_BADGE: Record<OrderStatus, string> = { pending: 'gold', confirmed: 'blue', delivered: 'green', cancelled: '' };

export function productCard(p: Product): string {
  const out = p.stock <= 0;
  return `<a class="card product rise ${out ? 'out' : ''}" href="#/shop/p/${p.id}">
    ${cover(p.image_url, p.id, CAT_ICON[p.category], esc(p.name))}
    <div class="product-body">
      <span class="muted small">${icon(CAT_ICON[p.category], 14)} ${catLabel(p.category)}</span>
      <h3 dir="auto" class="clamp1">${esc(p.name)}</h3>
      <div class="row between"><b class="price">${money(p.price)}</b>
        ${out ? `<span class="badge red">${t('shop.soldOut')}</span>` : p.active ? '' : `<span class="badge">${t('shop.hidden')}</span>`}</div>
    </div>
  </a>`;
}

function banner(): string {
  return `<section class="banner b-shop">
    <div><h1>${icon('shop', 28)} ${t('shop.title')}</h1><p>${t('shop.tagline')}</p></div>
    ${isSeller() ? `<a class="btn gold" href="#/shop/manage">${icon('box')} ${t('shop.manage')}</a>` : ''}
  </section>`;
}

function listPage(): string {
  if (!products) { load(); return banner() + skeleton(6); }
  const q = nameKey(query);
  const shown = products.filter((p) => p.active && (filter === 'all' || p.category === filter) && (!q || nameKey(p.name).includes(q)));
  return `${banner()}
  <div class="searchbar">${icon('search', 18)}<input class="input" id="shopQ" data-act="shop-q" placeholder="${esc(t('shop.search'))}" value="${esc(query)}" dir="auto"></div>
  <div class="chips-row">${(['all', ...content.PRODUCT_CATEGORIES] as const).map((c) => `<button class="pill ${filter === c ? 'on' : ''}" data-act="shop-filter" data-v="${c}">
    ${icon(c === 'all' ? 'grid' : CAT_ICON[c], 16)} ${c === 'all' ? t('news.all') : catLabel(c)}</button>`).join('')}</div>
  ${hint('shop.payHint')}
  ${shown.length ? `<div class="grid products">${shown.map(productCard).join('')}</div>` : empty('shop', t('shop.empty'))}`;
}

function productPage(id: string): string {
  if (!products) { load(); return loading(); }
  const p = products.find((x) => x.id === id);
  if (!p) return empty('shop', t('shop.notFound'), `<a class="btn" href="#/shop">${t('shop.back')}</a>`);
  const seller = content.person(p.seller_id);
  const own = p.seller_id === session.profile?.id;
  const max = Math.max(0, Math.min(p.stock, 99));
  qty = Math.min(Math.max(1, qty), Math.max(1, max));
  const order = !session.profile ? needLogin('shop.loginToOrder')
    : own ? `<p class="muted">${t('shop.ownProduct')}</p>`
    : max === 0 ? `<div class="err">${t('shop.soldOut')}</div>`
    : `<form data-form="shop-order" data-id="${p.id}" novalidate>
      <div class="row between"><span class="lbl">${t('shop.qty')}</span>
        <div class="stepper"><button type="button" data-act="shop-qty" data-d="-1" aria-label="-">−</button><b>${n(qty)}</b><button type="button" data-act="shop-qty" data-d="1" data-max="${max}" aria-label="+">+</button></div></div>
      <div class="row between total"><span>${t('shop.total')}</span><b>${money(p.price * qty)}</b></div>
      <label class="field"><span>${t('auth.phone')}</span><input class="input" id="oPhone" type="tel" dir="ltr" value="${esc(session.profile.phone ?? '')}"></label>
      <label class="field"><span>${t('shop.note')}</span><input class="input" id="oNote" dir="auto" placeholder="${esc(t('shop.notePh'))}"></label>
      <button class="btn green block" type="submit">${icon('cart')} ${t('shop.order')}</button>
      ${hint('shop.payHint')}
    </form>`;
  return `<a class="backlink" href="#/shop">${icon('back', 18)} ${t('shop.back')}</a>
  <div class="product-page rise">
    <div class="card">${cover(p.image_url, p.id, CAT_ICON[p.category], esc(p.name))}</div>
    <div class="card">
      <span class="badge blue">${icon(CAT_ICON[p.category], 14)} ${catLabel(p.category)}</span>
      <h1 dir="auto" style="margin-block:8px">${esc(p.name)}</h1>
      <div class="price big">${money(p.price)}</div>
      <p class="muted small">${p.stock > 0 ? t('shop.inStock', { n: p.stock }) : t('shop.soldOut')}</p>
      ${p.description ? `<div class="prose"><p dir="auto">${esc(p.description).replace(/\n/g, '<br>')}</p></div>` : ''}
      ${seller ? `<div class="seller">${avatar(seller.full_name)}<div><span class="muted small">${t('shop.seller')}</span><br><b dir="auto">${esc(seller.full_name)}</b>${seller.club ? ` <span class="muted small" dir="auto">· ${esc(seller.club)}</span>` : ''}</div></div>` : ''}
      ${order}
      ${own || isAdmin() ? `<a class="btn soft small" href="#/shop/p/${p.id}/edit" style="margin-block-start:10px">${icon('edit', 16)} ${t('shop.editProduct')}</a>` : ''}
    </div>
  </div>`;
}

function loadSales(): void {
  sales = [];
  Promise.all([content.salesOrders(), content.myBuyers()])
    .then(([o, b]) => { sales = o; buyers = b; })
    .catch((e) => toast(authErr(e)))
    .finally(render);
}

function orderRow(o: Order, asSeller: boolean): string {
  const who = asSeller ? buyers.get(o.id) : undefined;
  const sellerName = asSeller ? '' : content.personName(o.seller_id);
  const next: OrderStatus[] = asSeller
    ? (o.status === 'pending' ? ['confirmed', 'cancelled'] : o.status === 'confirmed' ? ['delivered', 'cancelled'] : [])
    : (o.status === 'pending' ? ['cancelled'] : []);
  return `<div class="order">
    <div class="row between"><b dir="auto">${esc(o.product_name)} × ${n(o.qty)}</b><span class="badge ${STATUS_BADGE[o.status]}">${statusLabel(o.status)}</span></div>
    <div class="row small muted"><span>${money(o.total)}</span><span>${dateTimeFmt.format(new Date(o.created_at))}</span>
      ${who ? `<span dir="auto">${icon('user', 14)} ${esc(who.full_name)}</span>${who.phone ? `<a href="tel:${esc(who.phone)}" dir="ltr">${icon('phone', 14)} ${esc(who.phone)}</a>` : ''}` : ''}
      ${sellerName ? `<span dir="auto">${icon('shop', 14)} ${esc(sellerName)}</span>` : ''}</div>
    ${o.note ? `<p class="small" dir="auto">💬 ${esc(o.note)}</p>` : ''}
    ${next.length ? `<div class="row">${next.map((s) => `<button class="btn ${s === 'cancelled' ? 'ghost' : s === 'delivered' ? 'green' : ''} small" data-act="shop-status" data-id="${o.id}" data-s="${s}">${t(`shop.to.${s}` as MessageKey)}</button>`).join('')}</div>` : ''}
  </div>`;
}

function managePage(): string {
  if (!session.profile) return needLogin('shop.loginToSell');
  if (!isSeller()) return becomePrompt('seller');
  if (!products) { load(); return loading(); }
  if (sales === null) { loadSales(); return loading(); }
  const myProducts = products.filter((p) => p.seller_id === session.profile!.id);
  const pending = sales.filter((o) => o.status === 'pending').length;
  const income = sales.filter((o) => o.status === 'delivered').reduce((s, o) => s + o.total, 0);
  return `<a class="backlink" href="#/shop">${icon('back', 18)} ${t('shop.back')}</a>
  <section class="banner b-shop slim"><div><h1>${icon('box', 26)} ${t('shop.manage')}</h1><p>${t('shop.manageHint')}</p></div>
    <a class="btn gold" href="#/shop/new">${icon('plus')} ${t('shop.add')}</a></section>
  <div class="stats">
    <div class="stat">${icon('box', 22)}<b>${n(myProducts.length)}</b><small>${t('shop.statProducts')}</small></div>
    <div class="stat ${pending ? 'hot' : ''}">${icon('bell', 22)}<b>${n(pending)}</b><small>${t('shop.statPending')}</small></div>
    <div class="stat">${icon('money', 22)}<b>${money(income)}</b><small>${t('shop.statIncome')}</small></div>
  </div>
  <div class="card"><h2>${icon('bell', 22)} ${t('shop.incoming')}</h2>
    ${sales.length ? sales.map((o) => orderRow(o, true)).join('') : `<p class="muted">${t('shop.noOrders')}</p>`}</div>
  <div class="card"><h2>${icon('tag', 22)} ${t('shop.myProducts')}</h2>
    ${myProducts.length ? `<div class="grid products">${myProducts.map(productCard).join('')}</div>` : `<p class="muted">${t('shop.noProducts')}</p>`}</div>`;
}

function editorPage(id?: string): string {
  if (!session.profile) return needLogin('shop.loginToSell');
  if (!isSeller()) return becomePrompt('seller');
  if (!products) { load(); return loading(); }
  const p = id ? products.find((x) => x.id === id) : undefined;
  if (id && (!p || !(p.seller_id === session.profile.id || isAdmin()))) return empty('shop', t('shop.notFound'));
  if (imageDraft === undefined) imageDraft = p?.image_url ?? null;
  const cat = p?.category ?? 'rackets';
  return `<a class="backlink" href="${p ? `#/shop/p/${p.id}` : '#/shop/manage'}">${icon('back', 18)} ${t('common.cancel')}</a>
  <form class="card" data-form="shop-save" data-id="${p?.id ?? ''}" novalidate>
    <h2>${icon(p ? 'edit' : 'plus', 22)} ${t(p ? 'shop.editProduct' : 'shop.add')}</h2>
    <label class="field"><span>${t('shop.fName')}</span><input class="input" id="pdName" value="${esc(p?.name ?? '')}" dir="auto" maxlength="120"></label>
    <div class="row">
      <label class="field" style="flex:2"><span>${t('shop.fCategory')}</span><select class="input" id="pdCat">${content.PRODUCT_CATEGORIES.map((c) => `<option value="${c}" ${c === cat ? 'selected' : ''}>${catLabel(c)}</option>`).join('')}</select></label>
      <label class="field" style="flex:1"><span>${t('shop.fPrice')}</span><input class="input" id="pdPrice" inputmode="decimal" dir="ltr" value="${p ? p.price : ''}"></label>
      <label class="field" style="flex:1"><span>${t('shop.fStock')}</span><input class="input" id="pdStock" inputmode="numeric" dir="ltr" value="${p ? p.stock : 1}"></label>
    </div>
    ${imagePicker('shop-image', imageDraft, p?.id ?? 'new', CAT_ICON[cat])}
    <label class="field"><span>${t('shop.fDesc')}</span><textarea class="input" id="pdDesc" dir="auto" style="min-height:120px">${esc(p?.description ?? '')}</textarea></label>
    <label class="check"><input type="checkbox" id="pdActive" ${p?.active === false ? '' : 'checked'}> ${t('shop.fActive')}</label>
    <button class="btn green block" type="submit">${icon('check')} ${t('common.save')}</button>
    ${p ? `<button type="button" class="btn ghost block" data-act="shop-delete" data-id="${p.id}">${icon('trash', 16)} ${t('shop.delete')}</button>` : ''}
  </form>`;
}

/** Shown to someone without a role: explain it and offer to request it. */
export function becomePrompt(role: content.ExtraRole): string {
  return empty(role === 'seller' ? 'shop' : role === 'trainer' ? 'coach' : 'trophy', t(`roles.need.${role}` as MessageKey),
    `<a class="btn gold" href="#/me">${icon('star')} ${t('roles.request')}</a>`);
}

/** Buyer's orders, for the account page. */
export function myOrdersCard(): string {
  if (mine === null) {
    mine = [];
    content.myOrders().then(async (o) => { mine = o; await content.people(o.map((x) => x.seller_id)); }).catch(() => undefined).finally(render);
    return '';
  }
  if (!mine.length) return '';
  return `<div class="card"><h3>${icon('cart', 20)} ${t('shop.myOrders')}</h3>${mine.map((o) => orderRow(o, false)).join('')}</div>`;
}

export function reset(): void { products = null; sales = null; mine = null; }

export function route(parts: string[]): string | null {
  if (parts[0] !== 'shop') return null;
  if (parts[1] === 'manage') { imageDraft = undefined; return managePage(); }
  if (parts[1] === 'new') return editorPage();
  if (parts[1] === 'p' && parts[3] === 'edit') return editorPage(parts[2]);
  imageDraft = undefined;
  if (parts[1] === 'p' && parts[2]) return productPage(parts[2]);
  qty = 1;
  return listPage();
}

export async function onClick(act: string, el: HTMLElement): Promise<boolean> {
  switch (act) {
    case 'shop-filter': filter = el.dataset.v as typeof filter; render(); return true;
    case 'shop-qty': qty = Math.max(1, Math.min(Number(el.dataset.max ?? 99), qty + Number(el.dataset.d))); render(); return true;
    case 'shop-image-clear': imageDraft = null; keepForm(); render(); restoreForm(); return true;
    case 'shop-status': {
      try {
        await content.setOrderStatus(el.dataset.id!, el.dataset.s as OrderStatus);
        toast(t('shop.statusSaved'));
        sales = null; mine = null; products = null;
      } catch (e) { toast(authErr(e)); }
      render(); return true;
    }
    case 'shop-delete': {
      if (el.dataset.armed !== '1') { el.dataset.armed = '1'; el.innerHTML = `${icon('trash', 16)} ${t('news.deleteConfirm')}`; return true; }
      try { await content.deleteProduct(el.dataset.id!); products = products?.filter((p) => p.id !== el.dataset.id) ?? null; toast(t('shop.deleted')); location.hash = '#/shop/manage'; }
      catch (e) { toast(authErr(e)); }
      return true;
    }
  }
  return false;
}

export function onInput(el: HTMLInputElement): boolean {
  if (el.dataset.act !== 'shop-q') return false;
  query = el.value;
  const pos = el.selectionStart;
  render();
  const again = document.getElementById('shopQ') as HTMLInputElement | null;
  again?.focus();
  if (again && pos !== null) again.setSelectionRange(pos, pos);
  return true;
}

let saved: Record<string, string> = {};
function keepForm(): void { for (const id of ['pdName', 'pdCat', 'pdPrice', 'pdStock', 'pdDesc']) saved[id] = (document.getElementById(id) as HTMLInputElement | null)?.value ?? ''; }
function restoreForm(): void {
  for (const [id, v] of Object.entries(saved)) { const f = document.getElementById(id) as HTMLInputElement | null; if (f) f.value = v; }
  saved = {};
}

export async function onChange(el: HTMLInputElement): Promise<boolean> {
  if (el.dataset.act !== 'shop-image' || !el.files?.[0]) return false;
  toast(t('media.uploading'));
  try { imageDraft = await content.uploadImage(el.files[0]); toast(t('media.uploaded')); } catch (e) { toast(authErr(e)); }
  keepForm(); render(); restoreForm();
  return true;
}

export async function onSubmit(kind: string, form: HTMLFormElement): Promise<boolean> {
  if (kind === 'shop-order') {
    try {
      await content.placeOrder(form.dataset.id!, qty, val('oPhone'), val('oNote'));
      toast(`✅ ${t('shop.ordered')}`);
      products = null; mine = null; qty = 1;
      location.hash = '#/me';
    } catch (e) { toast(authErr(e)); }
    return true;
  }
  if (kind !== 'shop-save') return false;
  const name = val('pdName');
  const price = Number(val('pdPrice').replace(',', '.'));
  const stock = Math.floor(Number(val('pdStock')));
  if (!name || !(price >= 0) || val('pdPrice') === '' || !(stock >= 0)) { toast(t('shop.needFields')); return true; }
  try {
    const p = await content.saveProduct({
      id: form.dataset.id || undefined, name, price, stock, category: val('pdCat') as ProductCategory,
      description: (document.getElementById('pdDesc') as HTMLTextAreaElement).value.trim() || null,
      image_url: imageDraft ?? null, active: checked('pdActive'),
    });
    products = [{ ...p, price: Number(p.price) }, ...(products ?? []).filter((x) => x.id !== p.id)];
    await content.people([p.seller_id]);
    imageDraft = undefined;
    toast(`✅ ${t('shop.saved')}`);
    location.hash = `#/shop/p/${p.id}`;
  } catch (e) { toast(authErr(e)); }
  return true;
}
