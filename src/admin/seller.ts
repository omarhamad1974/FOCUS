/**
 * Seller's tool: products, incoming orders, delivery status and payments,
 * apart from the public shop. The simulation lets demo customers order the
 * seller's products (randomly or picked by photo).
 */
import { t, type MessageKey } from '../i18n/ar';
import * as content from '../data/content';
import type { OrderStatus, Product } from '../data/content';
import { authErr, money, n, render, session } from '../app/ctx';
import { totals } from '../domain/payments';
import { empty } from '../ui/art';
import { icon } from '../ui/icons';
import { avatar, esc, toast } from '../ui/util';
import * as api from './api';
import { countChips, ensureSim, payBox, paidTick, personLine, playerGrid, statTile, tip } from './ui';

const whenFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

let products: Product[] | null = null;
let orders: api.PaidOrder[] | null = null;
let buyers = new Map<string, { full_name: string; phone: string | null }>();
let loadingNow = false;
let orderCount = 3;
let picking = false;
const picked = new Set<string>();
let busy = false;
let filter: 'open' | 'all' | 'unpaid' = 'open';

export function reset(): void { products = null; orders = null; }

function load(): void {
  const me = session.profile?.id;
  if (loadingNow || !me) return;
  loadingNow = true;
  Promise.all([content.listProducts(), api.sellerOrders(me), content.myBuyers().catch(() => new Map())])
    .then(async ([p, o, b]) => {
      products = p.filter((x) => x.seller_id === me);
      orders = o; buyers = b;
      await content.people(o.map((x) => x.buyer_id)).catch(() => undefined);
    })
    .catch((e) => { products = []; orders = []; toast(authErr(e)); })
    .finally(() => { loadingNow = false; render(); });
}

const NEXT: Record<OrderStatus, OrderStatus[]> = { pending: ['confirmed', 'cancelled'], confirmed: ['delivered', 'cancelled'], delivered: [], cancelled: [] };
const STATUS_ICON: Record<OrderStatus, string> = { pending: '⏳', confirmed: '📦', delivered: '✅', cancelled: '✖️' };

/** Demo products so a new seller can try the cycle (they still need the admin's approval to show in the shop). */
const DEMO: { name: string; category: content.ProductCategory; price: number; stock: number; image: string }[] = [
  { name: 'مضرب تدريب كربون', category: 'rackets', price: 1450, stock: 12, image: 'demo/p-racket-pro.jpg' },
  { name: 'كرات تدريب ★★★ (6 كرات)', category: 'balls', price: 180, stock: 40, image: 'demo/p-balls.jpg' },
  { name: 'كاوتش سرعة عالية', category: 'rubbers', price: 950, stock: 15, image: 'demo/p-rubber.jpg' },
  { name: 'تيشيرت بينجو رياضي', category: 'clothing', price: 350, stock: 25, image: 'demo/p-tshirt.jpg' },
];

export function page(): string {
  if (!products || !orders) { load(); return `<div class="card center muted"><span class="spin"></span> ${t('reg.loading')}</div>`; }
  if (picking) ensureSim();
  const live = orders.filter((o) => o.status !== 'cancelled');
  const open = orders.filter((o) => o.status === 'pending' || o.status === 'confirmed');
  const tt = totals(live.map((o) => ({ amount: o.total, paid: o.paid })));
  const sellable = products.filter((p) => p.active && p.stock > 0);
  const shown = filter === 'open' ? open : filter === 'unpaid' ? live.filter((o) => !o.paid) : orders;
  const base = import.meta.env.BASE_URL;
  return `<section class="banner b-shop slim"><div><h1>${icon('shop', 26)} ${t('desk.sh.title')}</h1><p>${t('desk.sh.hint')}</p></div>
    <a class="btn gold" href="#/shop/new">${icon('plus')} ${t('shop.add')}</a></section>
  <div class="stats dash-stats">
    ${statTile('box', n(products.length), 'desk.sh.statProducts')}
    ${statTile('bell', n(open.length), 'desk.sh.statOpen', open.length > 0)}
    ${statTile('money', money(tt.collected), 'desk.pay.collected')}
    ${statTile('cart', money(tt.due), 'desk.pay.due', tt.due > 0)}
  </div>
  <div class="card sim-card dk-sim">
    <div class="row between"><h2>🎮 ${t('desk.sh.simTitle')}</h2><span class="badge gold">${t('desk.sim.badge')}</span></div>
    ${tip('desk.sh.simHint')}
    ${!sellable.length ? `<div class="dk-next"><p class="small">${t('desk.sh.noStock')}</p>
      <button class="btn soft small" data-act="dk-sh-demo" ${busy ? 'disabled' : ''}>🛍️ ${t('desk.sh.addDemo')}</button></div>` : ''}
    <div class="row" style="gap:8px">
      ${countChips('dk-sh-count', [1, 3, 5, 10], orderCount)}
      <button class="btn green small" data-act="dk-sh-order" ${busy || !sellable.length ? 'disabled' : ''}>🎲 ${t('desk.sh.orderRandom', { n: orderCount })}</button>
      <button class="btn soft small" data-act="dk-pick-toggle" aria-pressed="${picking}">🖼️ ${t('desk.sim.pickByPhoto')}</button>
      <button class="btn ghost small" data-act="dk-sh-clear" ${busy ? 'disabled' : ''}>🧹 ${t('desk.sim.clear')}</button>
    </div>
    ${picking ? `<div class="dk-picker">${tip('desk.sh.pickHint')}${playerGrid(picked, new Set())}
      <div class="row"><button class="btn green small" data-act="dk-sh-order-picked" ${busy || !picked.size || !sellable.length ? 'disabled' : ''}>✅ ${t('desk.sh.orderPicked', { n: picked.size })}</button>
      <button class="btn ghost small" data-act="dk-pick-clear">${t('desk.sim.clearPick')}</button></div></div>` : ''}
  </div>
  <div class="card dk-pay">
    <h2>💰 ${t('desk.sh.payTitle')}</h2>
    ${tip('desk.sh.payHint')}
    ${payBox(tt, 'desk.pay.orders')}
  </div>
  <div class="card">
    <div class="row between"><h2>🧾 ${t('desk.sh.orders')}</h2>
      <div class="choice">${(['open', 'unpaid', 'all'] as const).map((f) => `<button data-act="dk-sh-filter" data-v="${f}" aria-pressed="${filter === f}">${t(`desk.sh.f.${f}` as MessageKey)}</button>`).join('')}</div></div>
    ${shown.length ? shown.map((o) => {
      const who = content.person(o.buyer_id);
      const b = buyers.get(o.id);
      const ph = o.phone ?? b?.phone;
      return personLine(avatar(who?.full_name ?? b?.full_name ?? '?', who?.avatar_url, who?.gender), who?.full_name ?? b?.full_name ?? '?',
        `${icon('box', 13)} <span dir="auto">${esc(o.product_name)}</span> × ${n(o.qty)} · ${whenFmt.format(new Date(o.created_at))}${ph ? ` · ${icon('phone', 13)} <span dir="ltr">${esc(ph)}</span>` : ''}`,
        `<span class="badge ${o.status === 'delivered' ? 'green' : o.status === 'cancelled' ? 'red' : o.status === 'confirmed' ? 'blue' : 'gold'}">${STATUS_ICON[o.status]} ${t(`shop.status.${o.status}` as MessageKey)}</span>
         <b class="dk-price">${money(o.total)}</b>
         ${o.status !== 'cancelled' ? paidTick('order', o.id, o.paid) : ''}
         ${NEXT[o.status].map((s) => `<button class="btn small ${s === 'cancelled' ? 'ghost' : 'green'}" data-act="dk-sh-status" data-id="${o.id}" data-s="${s}" title="${esc(t(`desk.sh.to.${s}` as MessageKey))}">${s === 'cancelled' ? icon('x', 14) : `${STATUS_ICON[s]} ${t(`desk.sh.to.${s}` as MessageKey)}`}</button>`).join('')}`,
        `${o.paid ? 'paid' : ''} ${o.status === 'cancelled' ? 'off' : ''}`);
    }).join('') : empty('cart', t('desk.sh.noOrders'))}
  </div>
  <div class="card"><div class="row between"><h2>📦 ${t('desk.sh.products')}</h2><a class="btn soft small" href="#/shop/manage">${t('desk.sh.manageAll')}</a></div>
    ${products.length ? `<div class="dk-prods">${products.map((p) => `<a class="dk-prod" href="#/shop/p/${p.id}/edit">
      <img src="${esc(p.image_url ?? `${base}brand/logo.png`)}" alt="" loading="lazy">
      <span><b dir="auto">${esc(p.name)}</b><small>${money(p.price)} · ${t('desk.sh.stock', { n: p.stock })}</small>
      <span class="badge ${p.approved ? 'green' : 'gold'}">${p.approved ? t('desk.sh.approved') : t('desk.sh.awaiting')}</span></span></a>`).join('')}</div>`
      : `<p class="muted">${t('desk.sh.noProducts')}</p>`}
  </div>`;
}

export async function onClick(act: string, el: HTMLElement): Promise<boolean> {
  switch (act) {
    case 'dk-sh-count': orderCount = Number(el.dataset.v) || 3; render(); return true;
    case 'dk-sh-filter': filter = el.dataset.v as typeof filter; render(); return true;
    case 'dk-pick-toggle': picking = !picking; render(); return true;
    case 'dk-pick': if (picked.has(el.dataset.id!)) picked.delete(el.dataset.id!); else picked.add(el.dataset.id!); render(); return true;
    case 'dk-pick-clear': picked.clear(); render(); return true;
    case 'dk-sh-demo':
      busy = true; render();
      try {
        for (const d of DEMO) await content.saveProduct({ name: d.name, description: t('desk.sh.demoDesc'), category: d.category, price: d.price, stock: d.stock, image_url: d.image, active: true });
        toast(`🛍️ ${t('desk.sh.demoAdded', { n: DEMO.length })}`);
      } catch (e) { toast(authErr(e)); }
      busy = false; reset(); render(); return true;
    case 'dk-sh-order': case 'dk-sh-order-picked': {
      const who = act === 'dk-sh-order-picked' ? [...picked] : null;
      busy = true; render();
      try {
        const k = await api.simOrder(who ? who.length : orderCount, who);
        toast(`🎮 ${t('desk.sh.ordered', { n: k })}`);
        picked.clear();
      } catch (e) { toast(authErr(e)); }
      busy = false; reset(); render(); return true;
    }
    case 'dk-sh-clear':
      busy = true; render();
      try { toast(`🧹 ${t('desk.sim.cleared', { n: await api.simClear('seller') })}`); } catch (e) { toast(authErr(e)); }
      busy = false; reset(); render(); return true;
    case 'dk-sh-status':
      try { await content.setOrderStatus(el.dataset.id!, el.dataset.s as OrderStatus); toast(t('shop.statusSaved')); } catch (e) { toast(authErr(e)); }
      reset(); render(); return true;
  }
  return false;
}

export async function onChange(el: HTMLInputElement): Promise<boolean> {
  if (el.dataset.act !== 'dk-paid' || el.dataset.kind !== 'order') return false;
  const o = orders?.find((x) => x.id === el.dataset.id);
  try {
    await api.setOrderPaid(el.dataset.id!, el.checked);
    if (o) o.paid = el.checked;
  } catch (e) { toast(authErr(e)); el.checked = !el.checked; }
  render();
  return true;
}
