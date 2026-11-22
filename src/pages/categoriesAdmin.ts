/**
 * Admin tab «التصنيفات»: add, rename, reorder and delete the categories of the news,
 * the Pingo Academy and the shop. Sellers and article writers pick from these lists.
 */
import { t, type MessageKey } from '../i18n/ar';
import * as cats from '../data/categories';
import type { CatSection, Category } from '../data/categories';
import type { Post, Product } from '../data/content';
import { authErr, hint, n, render } from '../app/ctx';
import { icon } from '../ui/icons';
import { esc, toast } from '../ui/util';

const SECTION_ICON: Record<CatSection, string> = { news: 'news', academy: 'grad', shop: 'shop' };

const state: {
  section: CatSection;
  /** Category being edited, or null. */
  editing: string | null;
  /** Icons chosen in the edit form and in the add form. */
  editIcon: string;
  newIcon: string;
  /** Category waiting for delete confirmation. */
  deleting: string | null;
  busy: boolean;
} = { section: 'news', editing: null, editIcon: 'tag', newIcon: 'tag', deleting: null, busy: false };

let counts = new Map<string, number>();

function countItems(section: CatSection, posts: Post[], products: Product[]): void {
  counts = new Map();
  const items = section === 'shop' ? products.map((p) => p.category) : posts.map((p) => p.category);
  for (const c of items) counts.set(c, (counts.get(c) ?? 0) + 1);
}

const countOf = (c: Category) => counts.get(c.slug) ?? 0;

function iconPicker(current: string, target: 'new' | 'edit'): string {
  return `<div class="cat-icons" role="radiogroup" aria-label="${esc(t('cat.fIcon'))}">${cats.ICONS.map((ic) => `<button type="button" class="cat-ic ${ic === current ? 'on' : ''}"
    data-act="adm-cat-icon" data-for="${target}" data-v="${ic}" role="radio" aria-checked="${ic === current}" aria-label="${ic}">${icon(ic, 20)}</button>`).join('')}</div>`;
}

function form(c: Category | null): string {
  const id = c ? 'catEdit' : 'catNew';
  return `<div class="cat-form ${c ? 'editing' : ''}">
    <label class="field"><span>${t('cat.fName')}</span><input class="input" id="${id}Name" value="${esc(c?.name ?? '')}" dir="auto" maxlength="40" placeholder="${esc(t(`cat.ph.${state.section}` as MessageKey))}"></label>
    ${state.section === 'academy' ? `<label class="field"><span>${t('cat.fBlurb')}</span><input class="input" id="${id}Blurb" value="${esc(c?.blurb ?? '')}" dir="auto" maxlength="120" placeholder="${esc(t('cat.blurbPh'))}"></label>` : ''}
    <div class="field"><span class="lbl">${t('cat.fIcon')}</span>${c ? iconPicker(state.editIcon, 'edit') : iconPicker(state.newIcon, 'new')}</div>
    <div class="row">${c
      ? `<button class="btn green small" data-act="adm-cat-save" data-id="${c.id}">${icon('check', 16)} ${t('common.save')}</button>
         <button class="btn ghost small" data-act="adm-cat-cancel">${t('common.cancel')}</button>`
      : `<button class="btn gold" data-act="adm-cat-add">${icon('plus', 16)} ${t('cat.add')}</button>`}</div></div>`;
}

function deleteBox(c: Category, list: Category[]): string {
  const used = countOf(c);
  const others = list.filter((x) => x.id !== c.id);
  return `<div class="cat-del" role="alertdialog" aria-labelledby="catDelQ">
    <p id="catDelQ"><b>${t('cat.delSure', { name: esc(c.name) })}</b></p>
    ${used ? `<label class="field"><span>${t('cat.moveTo', { n: used })}</span>
      <select class="input" id="catMoveTo">${others.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>`
      : `<p class="muted small">${t('cat.delEmpty')}</p>`}
    <div class="row"><button class="btn red small" data-act="adm-cat-del-go" data-id="${c.id}" ${state.busy ? 'disabled' : ''}>${icon('trash', 14)} ${t('cat.delBtn')}</button>
      <button class="btn ghost small" data-act="adm-cat-cancel">${t('common.cancel')}</button></div></div>`;
}

function row(c: Category, i: number, list: Category[]): string {
  if (state.editing === c.id) return `<li class="cat-row open">${form(c)}</li>`;
  const used = countOf(c);
  return `<li class="cat-row" draggable="true" data-cat-id="${c.id}">
    <span class="cat-grip" aria-hidden="true">⋮⋮</span>
    <span class="cat-badge">${icon(c.icon, 22)}</span>
    <span class="cat-main"><b dir="auto">${esc(c.name)}</b>
      <small class="muted" dir="auto">${t(state.section === 'shop' ? 'cat.nProducts' : 'cat.nArticles', { n: n(used) })}${c.blurb ? ` · ${esc(c.blurb)}` : ''}</small></span>
    <span class="cat-actions">
      <button class="btn ghost small icon-only" data-act="adm-cat-move" data-id="${c.id}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="${esc(t('cat.up'))}" title="${esc(t('cat.up'))}">▲</button>
      <button class="btn ghost small icon-only" data-act="adm-cat-move" data-id="${c.id}" data-d="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="${esc(t('cat.down'))}" title="${esc(t('cat.down'))}">▼</button>
      <button class="btn soft small" data-act="adm-cat-edit" data-id="${c.id}">${icon('edit', 14)} ${t('cat.rename')}</button>
      <button class="btn ghost small" data-act="adm-cat-del" data-id="${c.id}" ${list.length <= 1 ? `disabled title="${esc(t('cat.keepOne'))}"` : ''} aria-label="${esc(t('cat.delBtn'))}">${icon('trash', 14)}</button>
    </span>
    ${state.deleting === c.id ? deleteBox(c, list) : ''}</li>`;
}

export function view(posts: Post[], products: Product[]): string {
  const list = cats.list(state.section);
  countItems(state.section, posts, products);
  const tabs = `<div class="chips-row cat-sections">${cats.SECTIONS.map((s) => `<button class="pill ${s === state.section ? 'on' : ''}" data-act="adm-cat-section" data-v="${s}" aria-pressed="${s === state.section}">
    ${icon(SECTION_ICON[s], 16)} ${t(`cat.sec.${s}` as MessageKey)} <b>${n(cats.list(s).length)}</b></button>`).join('')}</div>`;
  const notReady = !cats.isLive() ? `<p class="badge gold cat-wait">${icon('bell', 14)} ${t('cat.notReady')}</p>` : '';
  return `<div class="card"><h2>${icon('tag', 22)} ${t('adm.tab.categories')}</h2>${hint('cat.hint')}${tabs}${notReady}
    <p class="muted small">${t(`cat.secHint.${state.section}` as MessageKey)}</p>
    <ol class="cat-list" data-cat-section="${state.section}">${list.map((c, i) => row(c, i, list)).join('')}</ol>
    <p class="muted small">${icon('help', 14)} ${t('cat.dragHint')}</p></div>
  <div class="card"><h3>${icon('plus', 20)} ${t(`cat.addTitle.${state.section}` as MessageKey)}</h3>${form(null)}</div>`;
}

const inputVal = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';

async function run(fn: () => Promise<void>, done: MessageKey): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  try { await fn(); toast(`✅ ${t(done)}`); state.editing = null; state.deleting = null; state.busy = false; render(); }
  catch (e) { toast(errText(e)); state.busy = false; keep(render); }
}

function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/last category/i.test(m)) return t('cat.keepOne');
  if (/pick a category/i.test(m)) return t('cat.needMove');
  if (/duplicate|unique/i.test(m)) return t('cat.dup');
  return authErr(e);
}

/** Keeps the add-form name while the icon picker re-renders. */
function keep(fn: () => void): void {
  const ids = ['catNewName', 'catNewBlurb', 'catEditName', 'catEditBlurb'];
  const vals = ids.map((id) => (document.getElementById(id) as HTMLInputElement | null)?.value);
  fn();
  ids.forEach((id, i) => { const f = document.getElementById(id) as HTMLInputElement | null; if (f && vals[i] !== undefined) f.value = vals[i]!; });
}

export async function onClick(act: string, el: HTMLElement): Promise<boolean> {
  const list = cats.list(state.section);
  switch (act) {
    case 'adm-cat-section':
      state.section = el.dataset.v as CatSection; state.editing = null; state.deleting = null; state.newIcon = 'tag'; render(); return true;
    case 'adm-cat-icon':
      if (el.dataset.for === 'edit') state.editIcon = el.dataset.v!; else state.newIcon = el.dataset.v!;
      keep(render); return true;
    case 'adm-cat-edit': {
      const c = list.find((x) => x.id === el.dataset.id);
      state.editing = c?.id ?? null; state.deleting = null; state.editIcon = c?.icon ?? 'tag'; render();
      (document.getElementById('catEditName') as HTMLInputElement | null)?.focus();
      return true;
    }
    case 'adm-cat-cancel':
      state.editing = null; state.deleting = null; render(); return true;
    case 'adm-cat-save':
    case 'adm-cat-add': {
      const pre = act === 'adm-cat-add' ? 'catNew' : 'catEdit';
      const name = inputVal(`${pre}Name`);
      if (!name) { toast(t('cat.needName')); return true; }
      const id = act === 'adm-cat-save' ? el.dataset.id : undefined;
      if (list.some((x) => x.id !== id && x.name.trim() === name)) { toast(t('cat.dup')); return true; }
      const blurb = state.section === 'academy' ? inputVal(`${pre}Blurb`) || null : null;
      await run(() => cats.save({ id, section: state.section, name, icon: id ? state.editIcon : state.newIcon, blurb }), id ? 'cat.saved' : 'cat.added');
      if (!id) { state.newIcon = 'tag'; render(); }
      return true;
    }
    case 'adm-cat-move': {
      const i = list.findIndex((x) => x.id === el.dataset.id);
      const j = i + Number(el.dataset.d);
      if (i < 0 || j < 0 || j >= list.length) return true;
      const ids = list.map((x) => x.id);
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await run(() => cats.reorder(state.section, ids), 'cat.ordered');
      return true;
    }
    case 'adm-cat-del':
      state.deleting = el.dataset.id!; state.editing = null; render(); return true;
    case 'adm-cat-del-go': {
      const move = (document.getElementById('catMoveTo') as HTMLSelectElement | null)?.value || null;
      await run(() => cats.remove(el.dataset.id!, move), 'cat.deleted');
      return true;
    }
  }
  return false;
}

/* Drag and drop on a computer (phones use the ▲ ▼ buttons). */
let dragId: string | null = null;
document.addEventListener('dragstart', (e) => {
  const li = (e.target as HTMLElement).closest?.<HTMLElement>('[data-cat-id]');
  if (!li) return;
  dragId = li.dataset.catId!;
  li.classList.add('dragging');
  e.dataTransfer?.setData('text/plain', dragId);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', (e) => {
  if (!dragId) return;
  const li = (e.target as HTMLElement).closest?.<HTMLElement>('[data-cat-id]');
  if (!li || li.dataset.catId === dragId) return;
  e.preventDefault();
  const from = document.querySelector<HTMLElement>(`[data-cat-id="${dragId}"]`);
  if (!from) return;
  const box = li.getBoundingClientRect();
  li.parentElement!.insertBefore(from, e.clientY > box.top + box.height / 2 ? li.nextSibling : li);
});
document.addEventListener('dragend', () => {
  if (!dragId) return;
  const ol = document.querySelector<HTMLElement>('.cat-list');
  document.querySelector('.cat-row.dragging')?.classList.remove('dragging');
  dragId = null;
  if (!ol) return;
  const ids = [...ol.querySelectorAll<HTMLElement>('[data-cat-id]')].map((x) => x.dataset.catId!);
  const before = cats.list(state.section).map((x) => x.id);
  if (ids.join() !== before.join()) void run(() => cats.reorder(state.section, ids), 'cat.ordered');
});
