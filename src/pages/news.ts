/** News: a simple blog for table tennis news, lessons and tips. */
import { dateFmt, t, type MessageKey } from '../i18n/ar';
import * as content from '../data/content';
import * as cats from '../data/categories';
import type { Post, PostCategory, PostLevel } from '../data/content';
import { authErr, canWriteNews, checked, hint, isAdmin, loading, render, session, val } from '../app/ctx';
import { cover, empty, skeleton } from '../ui/art';
import { icon } from '../ui/icons';
import { avatarOf, esc, toast, zone } from '../ui/util';

/** Icon and name of an article category (from the admin's category list). */
export const catIcon = (c: PostCategory): string => cats.postIcon(c);
export const catLabel = (c: PostCategory): string => esc(cats.postLabel(c));

/** Where an article lives: academy lessons open under #/learn, everything else under #/news. */
export const postHref = (p: Post): string => `#/${content.isAcademy(p.category) ? 'learn' : 'news'}/${p.id}`;

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

/** Newest published news (academy lessons are left out: they have their own section). */
export const latest = (count: number): Post[] | null => posts && posts.filter((p) => p.published && !content.isAcademy(p.category)).slice(0, count);
/** All loaded articles, for the academy (null while loading). */
export const all = (): Post[] | null => posts;

const when = (iso: string) => dateFmt.format(new Date(iso));
const canEdit = (p: Post) => isAdmin() || p.author_id === session.profile?.id;

export function postCard(p: Post, big = false): string {
  return `<a class="card post ${big ? 'big' : ''} rise" href="${postHref(p)}">
    ${cover(p.cover_url, p.id, catIcon(p.category), esc(p.title))}
    <div class="post-body">
      <div class="row small"><span class="badge blue">${icon(catIcon(p.category), 14)} ${catLabel(p.category)}</span>
        ${p.published ? '' : `<span class="badge gold">${t('news.draft')}</span>`}<span class="muted">${when(p.created_at)}</span></div>
      <h3 dir="auto">${esc(p.title)}</h3>
      ${p.summary ? `<p class="muted clamp" dir="auto">${esc(p.summary)}</p>` : ''}
    </div>
  </a>`;
}

function listPage(): string {
  if (!posts) { load(); return pageHead() + skeleton(4); }
  const shown = posts.filter((p) => !content.isAcademy(p.category) && (filter === 'all' || p.category === filter));
  const [first, ...rest] = shown;
  return `${pageHead()}
  <div class="chips-row">${['all', ...cats.list('news').map((x) => x.slug)].map((c) => `<button class="pill ${filter === c ? 'on' : ''}" data-act="news-filter" data-v="${c}">
    ${c === 'all' ? icon('grid', 16) : icon(catIcon(c), 16)} ${c === 'all' ? t('news.all') : catLabel(c)}</button>`).join('')}</div>
  ${first ? `${postCard(first, true)}<div class="grid">${rest.map((p) => postCard(p)).join('')}</div>`
    : empty('news', t('news.empty'), canWriteNews() ? `<a class="btn" href="#/news/new">${icon('plus')} ${t('news.write')}</a>` : '')}`;
}

function pageHead(): string {
  return `<section class="banner b-news">
    <div><h1>${icon('news', 28)} ${t('news.title')}</h1><p>${t('news.tagline')}</p></div>
    ${canWriteNews() ? `<a class="btn gold" href="#/news/new">${icon('edit')} ${t('news.write')}</a>` : ''}
  </section>
  ${sectionSwitch('news')}`;
}

/** Two tabs that switch between the news and the academy. */
export function sectionSwitch(on: 'news' | 'learn'): string {
  return `<nav class="seg-switch" aria-label="${esc(t('acad.switchLabel'))}">
    <a href="#/news" ${on === 'news' ? 'aria-current="page"' : ''}>${icon('news', 18)} ${t('nav.news')}</a>
    <a href="#/learn" ${on === 'learn' ? 'aria-current="page"' : ''}>${icon('grad', 18)} ${t('acad.title')}</a></nav>`;
}

/** Bold text and clickable links inside one line (already escaped). */
function inline(s: string): string {
  return esc(s)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" dir="ltr">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

/**
 * Article text from plain text. Blank lines split blocks. A block that starts with "## " is a heading,
 * lines that start with "- " make a list, "1. " a numbered list, and "> " a highlighted tip box.
 */
export function richText(s: string): string {
  return s.replace(/\r/g, '').split(/\n{2,}/).map((block) => {
    const lines = block.split('\n').filter((l) => l.trim());
    if (!lines.length) return '';
    if (lines.length === 1 && /^##\s/.test(lines[0])) return `<h2 dir="auto">${inline(lines[0].replace(/^##\s+/, ''))}</h2>`;
    if (lines.every((l) => /^[-•]\s/.test(l))) return `<ul dir="auto">${lines.map((l) => `<li>${inline(l.replace(/^[-•]\s+/, ''))}</li>`).join('')}</ul>`;
    if (lines.every((l) => /^\d+[.)]\s/.test(l))) return `<ol dir="auto">${lines.map((l) => `<li>${inline(l.replace(/^\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
    if (/^>\s?/.test(lines[0])) return `<aside class="tipbox" dir="auto">${icon('bulb', 22)}<p>${lines.map((l) => inline(l.replace(/^>\s?/, ''))).join('<br>')}</p></aside>`;
    return `<p dir="auto">${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}

/** About 150 Arabic words a minute; at least one minute. */
export const readMinutes = (p: Post): number => Math.max(1, Math.ceil(`${p.summary ?? ''} ${p.body}`.split(/\s+/).filter(Boolean).length / 150));

function postPage(id: string): string {
  if (!posts) { load(); return loading(); }
  const p = posts.find((x) => x.id === id);
  if (!p) return empty('news', t('news.notFound'), `<a class="btn" href="#/news">${t('news.back')}</a>`);
  if (content.isAcademy(p.category)) { location.replace(postHref(p)); return loading(); }
  const author = content.person(p.author_id);
  const more = posts.filter((x) => x.id !== id && x.published && x.category === p.category).slice(0, 3);
  return `<a class="backlink" href="#/news">${icon('back', 18)} ${t('news.back')}</a>
  <article class="card article rise">
    ${cover(p.cover_url, p.id, catIcon(p.category), esc(p.title))}
    <div class="row small" style="margin-block:12px 4px"><span class="badge blue">${icon(catIcon(p.category), 14)} ${catLabel(p.category)}</span><span class="muted">${when(p.created_at)}</span></div>
    <h1 dir="auto">${esc(p.title)}</h1>
    ${author ? `<div class="row author">${avatarOf(author)}<b dir="auto">${esc(author.full_name)}</b></div>` : ''}
    ${p.summary ? `<p class="lead" dir="auto">${esc(p.summary)}</p>` : ''}
    <div class="prose">${richText(p.body)}</div>
    ${canEdit(p) ? `<div class="row" style="margin-block-start:16px">
      <a class="btn soft small" href="#/news/${p.id}/edit">${icon('edit', 16)} ${t('news.edit')}</a>
      <button class="btn ghost small" data-act="news-delete" data-id="${p.id}">${icon('trash', 16)} ${t('news.delete')}</button></div>` : ''}
  </article>
  ${more.length ? zone('blue', `<h2 class="sec">${icon('news', 22)} ${t('news.more')}</h2><div class="grid">${more.map((x) => postCard(x)).join('')}</div>`) : ''}`;
}

/** Article editor; `academy` starts a new article as a lesson (rules category) and returns to #/learn. */
export function editorPage(id?: string, academy = false): string {
  if (!canWriteNews()) return empty('shield', t('news.onlyAdmin'));
  if (!posts) { load(); return loading(); }
  const p = id ? posts.find((x) => x.id === id) : undefined;
  if (id && (!p || !canEdit(p))) return empty('news', t('news.notFound'));
  if (coverDraft === undefined) coverDraft = p?.cover_url ?? null;
  const cat = p?.category ?? cats.list(academy ? 'academy' : 'news')[0]?.slug ?? 'news';
  const lvl = p?.level ?? '';
  const group = (label: string, list: cats.Category[]) => `<optgroup label="${esc(label)}">${list.map((c) => `<option value="${esc(c.slug)}" ${c.slug === cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`;
  return `<a class="backlink" href="${p ? postHref(p) : academy ? '#/learn' : '#/news'}">${icon('back', 18)} ${t('common.cancel')}</a>
  <form class="card" data-form="news-save" data-id="${p?.id ?? ''}" novalidate>
    <h2>${icon('edit', 22)} ${t(p ? 'news.edit' : 'news.write')}</h2>
    ${hint('news.editorHint')}
    <label class="field"><span>${t('news.fTitle')}</span><input class="input" id="nTitle" value="${esc(p?.title ?? '')}" dir="auto" maxlength="160" required></label>
    <label class="field"><span>${t('news.fCategory')}</span>
      <select class="input" id="nCat">${group(t('nav.news'), cats.list('news'))}${group(t('acad.title'), cats.list('academy'))}</select>
      ${isAdmin() ? `<small class="muted">${t('cat.manageHint')} <a href="#/admin/categories">${t('cat.manageLink')}</a></small>` : ''}</label>
    <label class="field"><span>${t('acad.fLevel')}</span>
      <select class="input" id="nLevel"><option value="">${t('acad.levelNone')}</option>${content.POST_LEVELS.map((l) => `<option value="${l}" ${l === lvl ? 'selected' : ''}>${t(`acad.level.${l}` as MessageKey)}</option>`).join('')}</select>
      <small class="muted">${t('acad.fLevelHint')}</small></label>
    <label class="field"><span>${t('news.fSummary')}</span><input class="input" id="nSummary" value="${esc(p?.summary ?? '')}" dir="auto" maxlength="300"></label>
    ${imagePicker('news-cover', coverDraft, p?.id ?? 'new', catIcon(cat))}
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
      try {
        const was = posts?.find((p) => p.id === el.dataset.id);
        await content.deletePost(el.dataset.id!); posts = posts?.filter((p) => p.id !== el.dataset.id) ?? null; toast(t('news.deleted'));
        location.hash = was && content.isAcademy(was.category) ? '#/learn' : '#/news';
      }
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
function keepForm(): void { saved = { nTitle: val('nTitle'), nSummary: val('nSummary'), nBody: (document.getElementById('nBody') as HTMLTextAreaElement | null)?.value ?? '', nCat: val('nCat'), nLevel: val('nLevel') }; }
function restoreForm(): void {
  for (const [id, v] of Object.entries(saved)) { const f = document.getElementById(id) as HTMLInputElement | null; if (f) f.value = v; }
  saved = {};
}

export async function onSubmit(kind: string, form: HTMLFormElement): Promise<boolean> {
  if (kind !== 'news-save') return false;
  const title = val('nTitle');
  if (!title) { toast(t('news.needTitle')); return true; }
  const category = val('nCat') as PostCategory;
  const level = (val('nLevel') || null) as PostLevel | null;
  const old = posts?.find((x) => x.id === form.dataset.id);
  try {
    const p = await content.savePost({
      id: form.dataset.id || undefined, title, summary: val('nSummary') || null,
      body: (document.getElementById('nBody') as HTMLTextAreaElement).value, category,
      cover_url: coverDraft ?? null, published: checked('nPub'),
      // The level only matters for academy lessons; leave the field out otherwise.
      ...(content.isAcademy(category) || old?.level ? { level: content.isAcademy(category) ? level : null } : {}),
    });
    posts = [p, ...(posts ?? []).filter((x) => x.id !== p.id)].sort((a, b) => b.created_at.localeCompare(a.created_at));
    await content.people([p.author_id]);
    coverDraft = undefined;
    toast(`✅ ${t('news.saved')}`);
    location.hash = postHref(p);
  } catch (e) { toast(authErr(e)); }
  return true;
}

export function reset(): void { posts = null; }
