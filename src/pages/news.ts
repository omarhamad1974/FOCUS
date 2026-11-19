/** News: a simple blog for table tennis news, lessons and tips. */
import { dateFmt, t, type MessageKey } from '../i18n/ar';
import * as content from '../data/content';
import type { Post, PostCategory } from '../data/content';
import { authErr, canWriteNews, checked, hint, isAdmin, loading, render, session, val } from '../app/ctx';
import { cover, empty, skeleton } from '../ui/art';
import { icon } from '../ui/icons';
import { avatar, esc, toast } from '../ui/util';

export const CAT_ICON: Record<PostCategory, string> = {
  news: 'news', learn: 'book', tips: 'bolt', events: 'calendar', gear: 'racket', other: 'spark',
};

let posts: Post[] | null = null;
let busy = false;
let filter: PostCategory | 'all' = 'all';
let coverDraft: string | null | undefined;

export function load(force = false): void {
  if (busy || (posts && !force)) return;
  busy = true;
  content.listPosts()
    .then(async (p) => { posts = p; await content.people(p.map((x) => x.author_id)); })
    .catch((e) => { posts = []; toast(authErr(e)); })
    .finally(() => { busy = false; render(); });
}

export const latest = (count: number): Post[] | null => posts && posts.filter((p) => p.published).slice(0, count);

const catLabel = (c: PostCategory) => t(`news.cat.${c}` as MessageKey);
const when = (iso: string) => dateFmt.format(new Date(iso));
const canEdit = (p: Post) => isAdmin() || p.author_id === session.profile?.id;

export function postCard(p: Post, big = false): string {
  return `<a class="card post ${big ? 'big' : ''} rise" href="#/news/${p.id}">
    ${cover(p.cover_url, p.id, CAT_ICON[p.category], esc(p.title))}
    <div class="post-body">
      <div class="row small"><span class="badge blue">${icon(CAT_ICON[p.category], 14)} ${catLabel(p.category)}</span>
        ${p.published ? '' : `<span class="badge gold">${t('news.draft')}</span>`}<span class="muted">${when(p.created_at)}</span></div>
      <h3 dir="auto">${esc(p.title)}</h3>
      ${p.summary ? `<p class="muted clamp" dir="auto">${esc(p.summary)}</p>` : ''}
    </div>
  </a>`;
}

function listPage(): string {
  if (!posts) { load(); return pageHead() + skeleton(4); }
  const shown = posts.filter((p) => filter === 'all' || p.category === filter);
  const [first, ...rest] = shown;
  return `${pageHead()}
  <div class="chips-row">${(['all', ...content.POST_CATEGORIES] as const).map((c) => `<button class="pill ${filter === c ? 'on' : ''}" data-act="news-filter" data-v="${c}">
    ${c === 'all' ? icon('grid', 16) : icon(CAT_ICON[c], 16)} ${c === 'all' ? t('news.all') : catLabel(c)}</button>`).join('')}</div>
  ${first ? `${postCard(first, true)}<div class="grid">${rest.map((p) => postCard(p)).join('')}</div>`
    : empty('news', t('news.empty'), canWriteNews() ? `<a class="btn" href="#/news/new">${icon('plus')} ${t('news.write')}</a>` : '')}`;
}

function pageHead(): string {
  return `<section class="banner b-news">
    <div><h1>${icon('news', 28)} ${t('news.title')}</h1><p>${t('news.tagline')}</p></div>
    ${canWriteNews() ? `<a class="btn gold" href="#/news/new">${icon('edit')} ${t('news.write')}</a>` : ''}
  </section>`;
}

/** Paragraphs from plain text; blank lines split paragraphs, links become clickable. */
function richText(s: string): string {
  return s.split(/\n{2,}/).map((para) => {
    const html = esc(para).replace(/\n/g, '<br>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" dir="ltr">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    return `<p dir="auto">${html}</p>`;
  }).join('');
}

function postPage(id: string): string {
  if (!posts) { load(); return loading(); }
  const p = posts.find((x) => x.id === id);
  if (!p) return empty('news', t('news.notFound'), `<a class="btn" href="#/news">${t('news.back')}</a>`);
  const author = content.person(p.author_id);
  const more = posts.filter((x) => x.id !== id && x.published && x.category === p.category).slice(0, 3);
  return `<a class="backlink" href="#/news">${icon('back', 18)} ${t('news.back')}</a>
  <article class="card article rise">
    ${cover(p.cover_url, p.id, CAT_ICON[p.category], esc(p.title))}
    <div class="row small" style="margin-block:12px 4px"><span class="badge blue">${icon(CAT_ICON[p.category], 14)} ${catLabel(p.category)}</span><span class="muted">${when(p.created_at)}</span></div>
    <h1 dir="auto">${esc(p.title)}</h1>
    ${author ? `<div class="row author">${avatar(author.full_name)}<b dir="auto">${esc(author.full_name)}</b></div>` : ''}
    ${p.summary ? `<p class="lead" dir="auto">${esc(p.summary)}</p>` : ''}
    <div class="prose">${richText(p.body)}</div>
    ${canEdit(p) ? `<div class="row" style="margin-block-start:16px">
      <a class="btn soft small" href="#/news/${p.id}/edit">${icon('edit', 16)} ${t('news.edit')}</a>
      <button class="btn ghost small" data-act="news-delete" data-id="${p.id}">${icon('trash', 16)} ${t('news.delete')}</button></div>` : ''}
  </article>
  ${more.length ? `<h2 class="sec">${t('news.more')}</h2><div class="grid">${more.map((x) => postCard(x)).join('')}</div>` : ''}`;
}

function editorPage(id?: string): string {
  if (!canWriteNews()) return empty('shield', t('news.onlyWriters'));
  if (!posts) { load(); return loading(); }
  const p = id ? posts.find((x) => x.id === id) : undefined;
  if (id && (!p || !canEdit(p))) return empty('news', t('news.notFound'));
  if (coverDraft === undefined) coverDraft = p?.cover_url ?? null;
  const cat = p?.category ?? 'news';
  return `<a class="backlink" href="${p ? `#/news/${p.id}` : '#/news'}">${icon('back', 18)} ${t('common.cancel')}</a>
  <form class="card" data-form="news-save" data-id="${p?.id ?? ''}" novalidate>
    <h2>${icon('edit', 22)} ${t(p ? 'news.edit' : 'news.write')}</h2>
    ${hint('news.editorHint')}
    <label class="field"><span>${t('news.fTitle')}</span><input class="input" id="nTitle" value="${esc(p?.title ?? '')}" dir="auto" maxlength="160" required></label>
    <label class="field"><span>${t('news.fCategory')}</span>
      <select class="input" id="nCat">${content.POST_CATEGORIES.map((c) => `<option value="${c}" ${c === cat ? 'selected' : ''}>${catLabel(c)}</option>`).join('')}</select></label>
    <label class="field"><span>${t('news.fSummary')}</span><input class="input" id="nSummary" value="${esc(p?.summary ?? '')}" dir="auto" maxlength="300"></label>
    ${imagePicker('news-cover', coverDraft, p?.id ?? 'new', CAT_ICON[cat])}
    <label class="field"><span>${t('news.fBody')}</span><textarea class="input" id="nBody" dir="auto">${esc(p?.body ?? '')}</textarea></label>
    <label class="check"><input type="checkbox" id="nPub" ${p?.published === false ? '' : 'checked'}> ${t('news.fPublished')}</label>
    <button class="btn green block" type="submit">${icon('check')} ${t('common.save')}</button>
  </form>`;
}

/** Shared image picker: preview + upload button. `act` is the change action name. */
export function imagePicker(act: string, url: string | null | undefined, seed: string, iconName: string): string {
  return `<div class="field"><span class="lbl">${t('media.photo')}</span>
    <div class="picker">${cover(url, seed, iconName)}
      <div class="picker-actions">
        <label class="btn soft small">${icon('image', 16)} ${t(url ? 'media.change' : 'media.choose')}<input type="file" accept="image/*" class="hidden" data-act="${act}"></label>
        ${url ? `<button type="button" class="btn ghost small" data-act="${act}-clear">${icon('x', 16)} ${t('media.remove')}</button>` : ''}
      </div></div>
    <p class="muted small">${t('media.hint')}</p></div>`;
}

export function route(parts: string[]): string | null {
  if (parts[0] !== 'news') return null;
  if (parts[1] === 'new') return editorPage();
  if (parts[1] && parts[2] === 'edit') return editorPage(parts[1]);
  coverDraft = undefined;
  if (parts[1]) return postPage(parts[1]);
  return listPage();
}

export async function onClick(act: string, el: HTMLElement): Promise<boolean> {
  switch (act) {
    case 'news-filter':
      filter = el.dataset.v as typeof filter; render(); return true;
    case 'news-cover-clear':
      coverDraft = null; render(); return true;
    case 'news-delete': {
      if (el.dataset.armed !== '1') { el.dataset.armed = '1'; el.innerHTML = `${icon('trash', 16)} ${t('news.deleteConfirm')}`; return true; }
      try { await content.deletePost(el.dataset.id!); posts = posts?.filter((p) => p.id !== el.dataset.id) ?? null; toast(t('news.deleted')); location.hash = '#/news'; }
      catch (e) { toast(authErr(e)); }
      return true;
    }
  }
  return false;
}

export async function onChange(el: HTMLInputElement): Promise<boolean> {
  if (el.dataset.act !== 'news-cover' || !el.files?.[0]) return false;
  toast(t('media.uploading'));
  try { coverDraft = await content.uploadImage(el.files[0]); toast(t('media.uploaded')); } catch (e) { toast(authErr(e)); }
  keepForm(); render(); restoreForm();
  return true;
}

/* Keep typed text when the editor re-renders after an upload. */
let saved: Record<string, string> = {};
function keepForm(): void { saved = { nTitle: val('nTitle'), nSummary: val('nSummary'), nBody: (document.getElementById('nBody') as HTMLTextAreaElement | null)?.value ?? '', nCat: val('nCat') }; }
function restoreForm(): void {
  for (const [id, v] of Object.entries(saved)) { const f = document.getElementById(id) as HTMLInputElement | null; if (f) f.value = v; }
  saved = {};
}

export async function onSubmit(kind: string, form: HTMLFormElement): Promise<boolean> {
  if (kind !== 'news-save') return false;
  const title = val('nTitle');
  if (!title) { toast(t('news.needTitle')); return true; }
  try {
    const p = await content.savePost({
      id: form.dataset.id || undefined, title, summary: val('nSummary') || null,
      body: (document.getElementById('nBody') as HTMLTextAreaElement).value, category: val('nCat') as PostCategory,
      cover_url: coverDraft ?? null, published: checked('nPub'),
    });
    posts = [p, ...(posts ?? []).filter((x) => x.id !== p.id)].sort((a, b) => b.created_at.localeCompare(a.created_at));
    await content.people([p.author_id]);
    coverDraft = undefined;
    toast(`✅ ${t('news.saved')}`);
    location.hash = `#/news/${p.id}`;
  } catch (e) { toast(authErr(e)); }
  return true;
}

export function reset(): void { posts = null; }
