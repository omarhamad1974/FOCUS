/**
 * Sports shops: a seller opens a shop page (logo, cover, city, address, hours,
 * phone, WhatsApp) and can give Pingo players a promotion: a discount that is
 * applied by itself to orders placed in Pingo (database trigger, migration
 * 0018) and/or a code to use in the shop. The code and the player's
 * "Pingo pass" show only to signed-in players.
 */
import { dateFmt, t } from '../i18n/ar';
import * as content from '../data/content';
import type { Shop, ShopFields } from '../data/content';
import { authErr, hint, isAdmin, isSeller, loading, n, render, session } from '../app/ctx';
import { cover, empty, placeholder, skeleton } from '../ui/art';
import { icon } from '../ui/icons';
import { followButton } from './alerts';
import { avatarOf, esc, toast, zone } from '../ui/util';
import { nameKey } from '../domain/tournament';
import * as shop from './shop';

let shops: Shop[] | null = null;
let busy = false;
let query = '';
let city = '';
let onlyPromo = false;
let logoDraft: string | null | undefined;
let coverDraft: string | null | undefined;
let form: Partial<Record<string, string>> = {};

export function load(force = false): void {
  if (busy || (shops && !force)) return;
  busy = true;
  content.listShops()
    .then((s) => { shops = s; })
    .catch(() => { shops = []; })
    .finally(() => { busy = false; render(); });
}

export function reset(): void { shops = null; }

/* ------------------------------------------------------------- helpers */

/** Today in Cairo as yyyy-mm-dd (promotions end at the end of their day there). */
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());

const isOpen = (s: Shop) => s.active && !s.hidden;
export const promoLive = (s: Shop) => isOpen(s) && !!(s.promo_title || s.promo_pct || s.promo_code) && (!s.promo_until || s.promo_until >= today());

export const shopOf = (ownerId: string): Shop | undefined => shops?.find((s) => s.owner_id === ownerId);

/** Pingo discount in percent on this seller's products today (0 if none). Loads the shops on first use. */
export function discountFor(sellerId: string): number {
  if (!shops) { load(); return 0; }
  const s = shopOf(sellerId);
  return s && promoLive(s) ? s.promo_pct ?? 0 : 0;
}

export const discounted = (price: number, pct: number) => Math.round(price * (100 - pct)) / 100;

/** wa.me wants the number in international form; Egyptian 01x numbers get the 20 prefix. */
export function waLink(num: string, text = ''): string {
  let d = num.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `20${d.slice(1)}`;
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

const logo = (s: Shop, size = 64) => s.logo_url
  ? `<img class="shop-logo" src="${esc(s.logo_url)}" alt="" width="${size}" height="${size}" loading="lazy">`
  : `<span class="shop-logo ph-logo" style="width:${size}px;height:${size}px">${icon('shop', Math.round(size / 2))}</span>`;

const shopCover = (s: Shop) => s.cover_url
  ? `<div class="ph photo"><img src="${esc(s.cover_url)}" alt="" loading="lazy" decoding="async"></div>`
  : placeholder(s.owner_id, 'shop');

function promoRibbon(s: Shop): string {
  if (!promoLive(s)) return '';
  return `<span class="shop-promo-tag">${icon('tag', 14)} ${s.promo_pct ? t('shops.promoOffLong', { n: s.promo_pct }) : esc(s.promo_title ?? t('shops.promo'))}</span>`;
}

export function shopCard(s: Shop): string {
  return `<a class="card shop-card rise ${s.featured ? 'featured' : ''}" href="#/shops/${s.owner_id}">
    ${s.featured ? `<span class="ribbon">${icon('star', 12)} ${t('shops.featured')}</span>` : ''}
    <div class="shop-card-cover">${shopCover(s)}${promoRibbon(s)}</div>
    <div class="shop-card-body">
      ${logo(s, 56)}
      <div class="grow">
        <h3 dir="auto" class="clamp1">${esc(s.name)}</h3>
        ${s.tagline ? `<p class="small muted clamp1" dir="auto">${esc(s.tagline)}</p>` : ''}
        ${s.city ? `<span class="small muted">${icon('pin', 13)} <span dir="auto">${esc(s.city)}</span></span>` : ''}
        ${!isOpen(s) ? `<span class="badge ${s.hidden ? 'red' : ''}">${t(s.hidden ? 'shops.hiddenBadge' : 'shops.closedBadge')}</span>` : ''}
      </div>
    </div>
  </a>`;
}

/** "Products | Sports shops" switch at the top of the shop section. */
export function tabs(on: 'products' | 'shops'): string {
  return `<nav class="shop-tabs" aria-label="${esc(t('nav.shop'))}">
    <a href="#/shop" ${on === 'products' ? 'aria-current="page"' : ''}>${icon('box', 18)} ${t('shops.tabProducts')}</a>
    <a href="#/shops" ${on === 'shops' ? 'aria-current="page"' : ''}>${icon('shop', 18)} ${t('shops.tabShops')}</a>
  </nav>`;
}

/** Shops with a live promotion first, for the home page. */
export function withPromos(count: number): Shop[] | null {
  if (!shops) return null;
  return shops.filter(isOpen).sort((a, b) => Number(promoLive(b)) - Number(promoLive(a)) || Number(b.featured) - Number(a.featured)).slice(0, count);
}

/* --------------------------------------------------------------- pages */

function banner(): string {
  const mine = session.profile && shops?.some((s) => s.owner_id === session.profile!.id);
  return `<section class="banner b-shop b-shops">
    <div><h1>${icon('shop', 28)} ${t('shops.title')}</h1><p>${t('shops.tagline')}</p></div>
    ${isSeller() ? `<a class="btn gold" href="#/shops/edit">${icon(mine ? 'edit' : 'plus')} ${t(mine ? 'shops.edit' : 'shops.open')}</a>` : ''}
  </section>`;
}

function listPage(): string {
  if (!shops) { load(); return banner() + tabs('shops') + skeleton(4); }
  const q = nameKey(query);
  const open = shops.filter((s) => isOpen(s) || isAdmin());
  const cities = [...new Set(open.map((s) => s.city?.trim()).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'ar'));
  const shown = open.filter((s) => (!city || s.city?.trim() === city) && (!onlyPromo || promoLive(s))
    && (!q || nameKey(`${s.name} ${s.tagline ?? ''} ${s.city ?? ''}`).includes(q)))
    .sort((a, b) => Number(b.featured) - Number(a.featured) || Number(promoLive(b)) - Number(promoLive(a)));
  return `${banner()}${tabs('shops')}
  <div class="searchbar">${icon('search', 18)}<input class="input" id="shpQ" data-act="shp-q" placeholder="${esc(t('shops.search'))}" value="${esc(query)}" dir="auto"></div>
  <div class="chips-row">
    <button class="pill ${onlyPromo ? 'on' : ''}" data-act="shp-promo">${icon('tag', 16)} ${t('shops.onlyPromo')}</button>
    <button class="pill ${!city ? 'on' : ''}" data-act="shp-city" data-v="">${icon('grid', 16)} ${t('shops.allCities')}</button>
    ${cities.map((c) => `<button class="pill ${city === c ? 'on' : ''}" data-act="shp-city" data-v="${esc(c)}">${icon('pin', 16)} <span dir="auto">${esc(c)}</span></button>`).join('')}
  </div>
  ${shown.length ? `<div class="grid shops">${shown.map(shopCard).join('')}</div>` : empty('shop', t('shops.empty'))}`;
}

function promoCard(s: Shop): string {
  if (!promoLive(s)) return '';
  const me = session.profile;
  const code = s.promo_code ?? '';
  const head = `<div class="promo-head">
      ${s.promo_pct ? `<span class="promo-pct"><b>${n(s.promo_pct)}%</b><small>${t('shops.off')}</small></span>` : `<span class="promo-pct">${icon('tag', 34)}</span>`}
      <div><span class="badge gold">${icon('star', 12)} ${t('shops.promo')}</span>
        <h2 dir="auto">${esc(s.promo_title || t('shops.promoOffLong', { n: s.promo_pct ?? 0 }))}</h2>
        ${s.promo_until ? `<span class="small">${icon('clock', 13)} ${t('shops.promoUntil', { d: dateFmt.format(new Date(`${s.promo_until}T12:00:00`)) })}</span>` : ''}</div>
    </div>
    ${s.promo_details ? `<p dir="auto" class="promo-details">${esc(s.promo_details).replace(/\n/g, '<br>')}</p>` : ''}
    ${s.promo_pct ? `<p class="small promo-auto">${icon('check', 14)} ${t('shops.promoAuto')}</p>` : ''}`;
  if (!me) {
    return `<section class="card promo-card rise">${head}
      <div class="promo-locked">${icon('shield', 20)} <span>${t('shops.promoLogin')}</span>
        <a class="btn gold small" href="#/login" data-return="${esc(location.hash)}">${t('shops.promoLoginBtn')}</a></div></section>`;
  }
  const wa = s.whatsapp ? waLink(s.whatsapp, t('shops.waHello', { name: me.full_name, code: code ? ` (${code})` : '' })) : '';
  return `<section class="card promo-card rise">${head}
    <div class="pingo-pass">
      <div class="pass-top"><img src="${import.meta.env.BASE_URL}brand/logo.png" alt="" width="48" height="32"><b>${t('shops.pass')}</b></div>
      <div class="pass-body">${avatarOf(me)}<div><b dir="auto">${esc(me.full_name)}</b><br><small dir="auto">${esc(s.name)}</small></div></div>
      ${code ? `<div class="pass-code"><small>${t('shops.promoCode')}</small><b dir="ltr">${esc(code)}</b>
        <button type="button" class="btn soft small" data-act="shp-copy" data-code="${esc(code)}">${icon('book', 14)} ${t('shops.copy')}</button></div>` : ''}
      <p class="small">${t('shops.passHint')}</p>
      ${wa ? `<a class="btn green small" href="${esc(wa)}" target="_blank" rel="noopener">${icon('whatsapp', 16)} ${t('shops.whatsapp')}</a>` : ''}
    </div></section>`;
}

function shopPage(id: string): string {
  if (!shops) { load(); return loading(); }
  const s = shopOf(id);
  const own = session.profile?.id === id;
  if (!s || (!isOpen(s) && !own && !isAdmin())) return empty('shop', t('shops.notFound'), `<a class="btn" href="#/shops">${t('shops.back')}</a>`);
  const prods = shop.productsOf(id);
  const contact = [
    s.whatsapp ? `<a class="btn green" href="${esc(waLink(s.whatsapp))}" target="_blank" rel="noopener">${icon('whatsapp', 18)} ${t('shops.whatsapp')}</a>` : '',
    s.phone ? `<a class="btn soft" href="tel:${esc(s.phone)}">${icon('phone', 18)} ${t('shops.call')}</a>` : '',
    s.map_url ? `<a class="btn soft" href="${esc(s.map_url)}" target="_blank" rel="noopener">${icon('map', 18)} ${t('shops.map')}</a>` : '',
    own ? '' : followButton(s.owner_id, 'btn gold'),
  ].join('');
  return `<a class="backlink" href="#/shops">${icon('back', 18)} ${t('shops.back')}</a>
  <section class="shop-hero rise">
    <div class="shop-hero-cover">${shopCover(s)}</div>
    <div class="shop-hero-body">
      ${logo(s, 92)}
      <div class="grow">
        <h1 dir="auto">${esc(s.name)} ${s.featured ? `<span class="badge gold">${icon('star', 12)} ${t('shops.featured')}</span>` : ''}
          ${!isOpen(s) ? `<span class="badge ${s.hidden ? 'red' : ''}">${t(s.hidden ? 'shops.hiddenBadge' : 'shops.closedBadge')}</span>` : ''}</h1>
        ${s.tagline ? `<p dir="auto" class="muted">${esc(s.tagline)}</p>` : ''}
        ${s.city ? `<span class="small muted">${icon('pin', 14)} <span dir="auto">${esc(s.city)}</span></span>` : ''}
      </div>
    </div>
    ${contact ? `<div class="row shop-contact">${contact}</div>` : ''}
  </section>
  ${own ? `<div class="row"><a class="btn soft small" href="#/shops/edit">${icon('edit', 16)} ${t('shops.edit')}</a>${s.hidden ? `<span class="hint">${t('shops.deskHidden')}</span>` : ''}</div>` : ''}
  ${isAdmin() ? `<div class="row admin-row">${icon('shield', 18)}
    <button class="btn small ${s.hidden ? 'green' : 'ghost'}" data-act="shp-flag" data-id="${s.owner_id}" data-f="hidden" data-v="${s.hidden ? '0' : '1'}">${t(s.hidden ? 'shops.adminShow' : 'shops.adminHide')}</button>
    <button class="btn small soft" data-act="shp-flag" data-id="${s.owner_id}" data-f="featured" data-v="${s.featured ? '0' : '1'}">${icon('star', 14)} ${t(s.featured ? 'shops.adminUnfeature' : 'shops.adminFeature')}</button></div>` : ''}
  ${promoCard(s)}
  ${s.address || s.hours || s.about ? `<div class="card shop-info">
    ${s.address ? `<p>${icon('pin', 18)} <b>${t('shops.address')}:</b> <span dir="auto">${esc(s.address)}</span></p>` : ''}
    ${s.hours ? `<p>${icon('clock', 18)} <b>${t('shops.hours')}:</b> <span dir="auto">${esc(s.hours)}</span></p>` : ''}
    ${s.about ? `<h3>${icon('book', 18)} ${t('shops.about')}</h3><p dir="auto">${esc(s.about).replace(/\n/g, '<br>')}</p>` : ''}
  </div>` : ''}
  ${zone('red', `<div class="sec-head"><h2>${icon('box', 22)} ${t('shops.products')}</h2></div>
  ${prods === null ? skeleton(3) : prods.length ? `<div class="grid products">${prods.map(shop.productCard).join('')}</div>` : `<p class="muted">${t('shops.noProducts')}</p>`}`)}`;
}

/* -------------------------------------------------------------- editor */

const FIELDS: [keyof ShopFields, string][] = [
  ['name', 'sfName'], ['tagline', 'sfTagline'], ['city', 'sfCity'], ['address', 'sfAddress'], ['map_url', 'sfMap'], ['hours', 'sfHours'],
  ['phone', 'sfPhone'], ['whatsapp', 'sfWa'], ['about', 'sfAbout'],
  ['promo_title', 'sfPTitle'], ['promo_pct', 'sfPPct'], ['promo_code', 'sfPCode'], ['promo_until', 'sfPUntil'], ['promo_details', 'sfPDetails'],
];

function keepForm(): void {
  for (const [, id] of FIELDS) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) form[id] = el.value;
  }
  const a = document.getElementById('sfActive') as HTMLInputElement | null;
  if (a) form.sfActive = a.checked ? '1' : '0';
}

const DEMO: Record<string, string> = {
  sfName: 'بينج ستور الرياضي', sfTagline: 'مضارب وكاوتش وكرات للمحترفين والمبتدئين', sfCity: 'القاهرة',
  sfAddress: '12 شارع مكرم عبيد، مدينة نصر', sfMap: 'https://maps.google.com/?q=30.0561,31.3300', sfHours: 'يومياً من 11 صباحاً إلى 11 مساءً',
  sfPhone: '01001234567', sfWa: '01001234567',
  sfAbout: 'متجر متخصص في أدوات تنس الطاولة منذ 2015. نركّب الكاوتش على المضرب مجاناً ونساعدك في اختيار المضرب المناسب لمستواك.',
  sfPTitle: 'خصم لأبطال بينجو', sfPPct: '15', sfPCode: 'PINGO15', sfPUntil: '',
  sfPDetails: 'خصم 15% على كل المضارب والكاوتش للاعبي بينجو. اعرض بطاقة لاعب بينجو في المتجر أو اطلب من التطبيق.',
};

function editorPage(): string {
  const me = session.profile;
  if (!me) { location.hash = '#/login'; return ''; }
  if (!isSeller()) return shop.becomePrompt('seller');
  if (!shops) { load(); return loading(); }
  const s = shopOf(me.id);
  if (logoDraft === undefined) logoDraft = s?.logo_url ?? null;
  if (coverDraft === undefined) coverDraft = s?.cover_url ?? null;
  const v = (key: keyof ShopFields, id: string) => esc(form[id] ?? String(s?.[key] ?? ''));
  const input = (key: keyof ShopFields, id: string, label: string, extra = '') =>
    `<label class="field"><span>${label}</span><input class="input" id="${id}" value="${v(key, id)}" ${extra}></label>`;
  const active = form.sfActive !== undefined ? form.sfActive === '1' : s?.active !== false;
  const pick = (act: string, url: string | null, label: string, round = false) => `<div class="field"><span class="lbl">${label}</span>
    <div class="picker ${round ? 'logo-pick' : ''}">${round ? (url ? `<img class="shop-logo" src="${esc(url)}" alt="" width="80" height="80">` : `<span class="shop-logo ph-logo" style="width:80px;height:80px">${icon('shop', 36)}</span>`) : cover(url, me.id, 'shop')}
      <div class="picker-actions">
        <label class="btn soft small">${icon('image', 16)} ${t(url ? 'media.change' : 'media.choose')}<input type="file" accept="image/*" class="hidden" data-act="${act}"></label>
        ${url ? `<button type="button" class="btn ghost small" data-act="${act}-clear">${icon('x', 16)} ${t('media.remove')}</button>` : ''}
      </div></div></div>`;
  return `<a class="backlink" href="${s ? `#/shops/${me.id}` : '#/desk/seller'}">${icon('back', 18)} ${t('common.cancel')}</a>
  <form class="card shop-editor" data-form="shp-save" novalidate>
    <div class="row between"><h2>${icon('shop', 22)} ${t('shops.editorTitle')}</h2>
      <button type="button" class="btn soft small" data-act="shp-demo">🎲 ${t('shops.fillDemo')}</button></div>
    ${hint('shops.editorHint')}
    ${input('name', 'sfName', t('shops.fName'), 'dir="auto" maxlength="80"')}
    ${input('tagline', 'sfTagline', t('shops.fTagline'), `dir="auto" maxlength="120" placeholder="${esc(t('shops.fTaglinePh'))}"`)}
    <div class="row pickers">${pick('shp-logo', logoDraft, t('shops.fLogo'), true)}${pick('shp-cover', coverDraft, t('shops.fCover'))}</div>
    <p class="muted small">${t('media.hint')}</p>
    <div class="row">
      <div style="flex:1;min-width:140px">${input('city', 'sfCity', t('shops.fCity'), 'dir="auto" maxlength="60"')}</div>
      <div style="flex:2;min-width:200px">${input('address', 'sfAddress', t('shops.fAddress'), 'dir="auto" maxlength="200"')}</div>
    </div>
    ${input('map_url', 'sfMap', t('shops.fMap'), 'dir="ltr" inputmode="url" placeholder="https://maps.google.com/…"')}
    <p class="muted small">${t('shops.fMapHint')}</p>
    ${input('hours', 'sfHours', t('shops.fHours'), `dir="auto" maxlength="120" placeholder="${esc(t('shops.fHoursPh'))}"`)}
    <div class="row">
      <div style="flex:1;min-width:150px">${input('phone', 'sfPhone', t('shops.fPhone'), 'dir="ltr" type="tel" maxlength="30"')}</div>
      <div style="flex:1;min-width:150px">${input('whatsapp', 'sfWa', `${icon('whatsapp', 14)} ${t('shops.fWhatsapp')}`, 'dir="ltr" type="tel" maxlength="30"')}</div>
    </div>
    <p class="muted small">${t('shops.fWhatsappHint')}</p>
    <label class="field"><span>${t('shops.fAbout')}</span><textarea class="input" id="sfAbout" dir="auto" maxlength="1200" style="min-height:100px">${v('about', 'sfAbout')}</textarea></label>
    <fieldset class="promo-fields">
      <legend>${icon('tag', 18)} ${t('shops.promoSection')}</legend>
      ${hint('shops.promoSectionHint')}
      ${input('promo_title', 'sfPTitle', t('shops.fPromoTitle'), `dir="auto" maxlength="80" placeholder="${esc(t('shops.fPromoTitlePh'))}"`)}
      <div class="row">
        <div style="flex:1;min-width:100px">${input('promo_pct', 'sfPPct', t('shops.fPromoPct'), 'dir="ltr" inputmode="numeric" maxlength="2"')}</div>
        <div style="flex:1;min-width:120px">${input('promo_code', 'sfPCode', t('shops.fPromoCode'), 'dir="ltr" maxlength="30" style="text-transform:uppercase"')}</div>
        <div style="flex:1;min-width:150px">${input('promo_until', 'sfPUntil', t('shops.fPromoUntil'), 'type="date" dir="ltr"')}</div>
      </div>
      <label class="field"><span>${t('shops.fPromoDetails')}</span><textarea class="input" id="sfPDetails" dir="auto" maxlength="600">${v('promo_details', 'sfPDetails')}</textarea></label>
    </fieldset>
    <label class="check"><input type="checkbox" id="sfActive" ${active ? 'checked' : ''}> ${t('shops.fActive')}</label>
    <button class="btn green block" type="submit">${icon('check')} ${t('common.save')}</button>
  </form>`;
}

/** Card at the top of the seller's desk: open or edit the shop page, promotion status. */
export function deskCard(): string {
  const me = session.profile;
  if (!me) return '';
  if (!shops) { load(); return ''; }
  const s = shopOf(me.id);
  if (!s) {
    return `<div class="card shop-desk"><div class="row between"><h2>${icon('shop', 22)} ${t('shops.deskTitle')}</h2>
      <a class="btn gold small" href="#/shops/edit">${icon('plus', 16)} ${t('shops.open')}</a></div>
      <p class="muted small">${t('shops.deskNone')}</p></div>`;
  }
  const ended = !!s.promo_until && s.promo_until < today();
  const promo = promoLive(s) ? `<span class="badge green">${icon('tag', 12)} ${t('shops.deskPromoOn')}${s.promo_pct ? ` · ${t('shops.promoOff', { n: s.promo_pct })}` : ''}</span>`
    : `<span class="badge ${ended ? 'red' : ''}">${t(ended ? 'shops.deskPromoEnded' : 'shops.deskPromoOff')}</span>`;
  return `<div class="card shop-desk"><div class="row between">
    <div class="row" style="gap:10px;align-items:center">${logo(s, 48)}<div><h2 dir="auto" style="margin:0">${esc(s.name)}</h2>
      <div class="row" style="gap:6px">${promo}${!isOpen(s) ? `<span class="badge ${s.hidden ? 'red' : ''}">${t(s.hidden ? 'shops.hiddenBadge' : 'shops.closedBadge')}</span>` : ''}</div></div></div>
    <div class="row"><a class="btn soft small" href="#/shops/${s.owner_id}">${icon('eye', 16)} ${t('shops.view')}</a>
      <a class="btn gold small" href="#/shops/edit">${icon('edit', 16)} ${t('shops.edit')}</a></div></div>
    ${s.hidden ? `<p class="hint">${t('shops.deskHidden')}</p>` : ''}</div>`;
}

/* ------------------------------------------------------------- routing */

export function route(parts: string[]): string | null {
  if (parts[0] !== 'shops') return null;
  if (parts[1] === 'edit') return editorPage();
  logoDraft = undefined; coverDraft = undefined; form = {};
  if (parts[1]) return shopPage(parts[1]);
  return listPage();
}

export async function onClick(act: string, el: HTMLElement): Promise<boolean> {
  switch (act) {
    case 'shp-city': city = el.dataset.v ?? ''; render(); return true;
    case 'shp-promo': onlyPromo = !onlyPromo; render(); return true;
    case 'shp-copy':
      try { await navigator.clipboard.writeText(el.dataset.code ?? ''); toast(`📋 ${t('shops.copied')}`); } catch { toast(el.dataset.code ?? ''); }
      return true;
    case 'shp-demo':
      keepForm();
      form = { ...form, ...DEMO };
      if (!logoDraft) logoDraft = `${import.meta.env.BASE_URL}brand/icon-192.png`;
      if (!coverDraft) coverDraft = 'demo/p-table.jpg';
      render(); return true;
    case 'shp-logo-clear': keepForm(); logoDraft = null; render(); return true;
    case 'shp-cover-clear': keepForm(); coverDraft = null; render(); return true;
    case 'shp-flag': {
      try {
        await content.setShopFlags(el.dataset.id!, { [el.dataset.f!]: el.dataset.v === '1' });
        toast(t('shops.adminSaved'));
        load(true);
      } catch (e) { toast(authErr(e)); }
      return true;
    }
  }
  return false;
}

export function onInput(el: HTMLInputElement): boolean {
  if (el.dataset.act !== 'shp-q') return false;
  query = el.value;
  const pos = el.selectionStart;
  render();
  const again = document.getElementById('shpQ') as HTMLInputElement | null;
  again?.focus();
  if (again && pos !== null) again.setSelectionRange(pos, pos);
  return true;
}

export async function onChange(el: HTMLInputElement): Promise<boolean> {
  const act = el.dataset.act;
  if ((act !== 'shp-logo' && act !== 'shp-cover') || !el.files?.[0]) return false;
  keepForm();
  toast(t('media.uploading'));
  try {
    const url = act === 'shp-logo' ? await content.uploadImage(await squareBlob(el.files[0]), 480) : await content.uploadImage(el.files[0]);
    if (act === 'shp-logo') logoDraft = url; else coverDraft = url;
    toast(t('media.uploaded'));
  } catch (e) { toast(authErr(e)); }
  render();
  return true;
}

async function squareBlob(file: File): Promise<Blob> {
  try { return content.dataUrlToBlob(await content.squareDataUrl(file, 480)); } catch { return file; }
}

export async function onSubmit(kind: string): Promise<boolean> {
  if (kind !== 'shp-save') return false;
  keepForm();
  const get = (id: string) => (form[id] ?? '').trim();
  const name = get('sfName');
  if (name.length < 2) { toast(t('shops.needName')); return true; }
  const pctText = get('sfPPct');
  const pct = pctText ? Number(pctText) : null;
  if (pct !== null && !(Number.isInteger(pct) && pct >= 1 && pct <= 90)) { toast(t('shops.badPct')); return true; }
  const map = get('sfMap');
  if (map && !/^https?:\/\//i.test(map)) { toast(t('shops.badMap')); return true; }
  const opt = (id: string) => get(id) || null;
  const fields: ShopFields = {
    name, tagline: opt('sfTagline'), about: opt('sfAbout'), logo_url: logoDraft ?? null, cover_url: coverDraft ?? null,
    city: opt('sfCity'), address: opt('sfAddress'), map_url: map || null, hours: opt('sfHours'), phone: opt('sfPhone'), whatsapp: opt('sfWa'),
    promo_title: opt('sfPTitle'), promo_details: opt('sfPDetails'), promo_pct: pct, promo_code: get('sfPCode').toUpperCase() || null,
    promo_until: opt('sfPUntil'), active: form.sfActive !== '0',
  };
  try {
    const saved = await content.saveShop(fields, !!shopOf(session.profile!.id));
    shops = [saved, ...(shops ?? []).filter((x) => x.owner_id !== saved.owner_id)];
    logoDraft = undefined; coverDraft = undefined; form = {};
    toast(`✅ ${t('shops.saved')}`);
    location.hash = `#/shops/${saved.owner_id}`;
  } catch (e) { toast(authErr(e)); }
  return true;
}

export const shopName = (sellerId: string) => shopOf(sellerId)?.name;
