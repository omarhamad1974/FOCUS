/** Pingo Academy: lessons about the rules, training, tips and tricks. Articles are admin-written posts. */
import { dateFmt, t, type MessageKey } from '../i18n/ar';
import * as content from '../data/content';
import type { Post, PostCategory, PostLevel } from '../data/content';
import { canWriteNews, hint, isAdmin, loading, render } from '../app/ctx';
import { academyArt, academyHero, empty, skeleton } from '../ui/art';
import { icon } from '../ui/icons';
import { avatarOf, esc, toast, zone } from '../ui/util';
import * as news from './news';

type Cat = PostCategory | 'all';
let cat: Cat = 'all';
let level: PostLevel | 'all' = 'all';
let query = '';

/* ------------------------------------------------- lessons the visitor finished (this browser) */

const DONE_KEY = 'pingo.academy.done';
function doneSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}
function setDone(id: string, on: boolean): void {
  const s = doneSet();
  if (on) s.add(id); else s.delete(id);
  try { localStorage.setItem(DONE_KEY, JSON.stringify([...s])); } catch { /* private mode: progress is not kept */ }
}

/* ------------------------------------------------------------------ pieces */

const lessons = (): Post[] | null => {
  const all = news.all();
  return all && all.filter((p) => content.isAcademy(p.category) && (p.published || isAdmin()));
};

/** The newest published lessons, for the home page (null while loading). */
export function latest(count: number): Post[] | null {
  const all = news.all();
  if (!all) { news.load(); return null; }
  return all.filter((p) => p.published && content.isAcademy(p.category)).slice(0, count);
}

const cover = (p: Post) => p.cover_url
  ? `<div class="ph photo"><img src="${p.cover_url}" alt="${esc(p.title)}" loading="lazy" decoding="async"></div>`
  : academyArt(p.category, p.id);

/** Level as one to three filled bars plus its name. */
export function levelBadge(l: PostLevel | null | undefined): string {
  if (!l) return '';
  const n = content.POST_LEVELS.indexOf(l) + 1;
  return `<span class="lvl lvl-${l}" title="${esc(t('acad.fLevel'))}"><i class="${n >= 1 ? 'on' : ''}"></i><i class="${n >= 2 ? 'on' : ''}"></i><i class="${n >= 3 ? 'on' : ''}"></i>${t(`acad.level.${l}` as MessageKey)}</span>`;
}

const catBadge = (c: PostCategory) => `<span class="badge acad-c acad-${c}">${icon(news.CAT_ICON[c], 14)} ${news.catLabel(c)}</span>`;
const minutes = (p: Post) => `<span class="muted small">${icon('clock', 14)} ${t('acad.minutes', { n: news.readMinutes(p) })}</span>`;

export function lessonCard(p: Post, done = doneSet()): string {
  return `<a class="card post lesson rise ${done.has(p.id) ? 'done' : ''}" href="#/learn/${p.id}">
    ${cover(p)}${done.has(p.id) ? `<span class="done-tag">${icon('check', 14)} ${t('acad.doneTag')}</span>` : ''}
    <div class="post-body">
      <div class="row small">${catBadge(p.category)}${levelBadge(p.level)}${p.published ? '' : `<span class="badge gold">${t('news.draft')}</span>`}</div>
      <h3 dir="auto">${esc(p.title)}</h3>
      ${p.summary ? `<p class="muted clamp" dir="auto">${esc(p.summary)}</p>` : ''}
      ${minutes(p)}
    </div>
  </a>`;
}

function matches(p: Post): boolean {
  if (cat !== 'all' && p.category !== cat) return false;
  if (level !== 'all' && p.level !== level) return false;
  if (!query) return true;
  const q = query.toLowerCase();
  return `${p.title} ${p.summary ?? ''} ${p.body}`.toLowerCase().includes(q);
}

function results(list: Post[]): string {
  const shown = list.filter(matches);
  const done = doneSet();
  if (!shown.length) return empty('grad', t(list.length ? 'acad.noMatch' : 'acad.empty'),
    canWriteNews() && !list.length ? `<a class="btn" href="#/learn/new">${icon('plus')} ${t('acad.write')}</a>` : '');
  return `<div class="grid">${shown.map((p) => lessonCard(p, done)).join('')}</div>`;
}

/* ------------------------------------------------------------------ pages */

function head(list: Post[] | null): string {
  const pub = list?.filter((p) => p.published) ?? [];
  const mins = pub.reduce((s, p) => s + news.readMinutes(p), 0);
  const done = pub.filter((p) => doneSet().has(p.id)).length;
  return `<section class="banner b-acad">
    <div><h1>${icon('grad', 30)} ${t('acad.title')}</h1><p>${t('acad.tagline')}</p>
      ${list ? `<div class="acad-stats"><span>${icon('book', 16)} ${t('acad.statLessons', { n: pub.length })}</span>
        <span>${icon('clock', 16)} ${t('acad.statMinutes', { n: mins })}</span>
        <span>${icon('check', 16)} ${t('acad.statDone', { n: done, of: pub.length })}</span></div>` : ''}
      ${canWriteNews() ? `<a class="btn gold" href="#/learn/new">${icon('edit')} ${t('acad.write')}</a>` : ''}</div>
    ${academyHero()}
  </section>
  ${news.sectionSwitch('learn')}`;
}

function listPage(): string {
  const list = lessons();
  if (!list) { news.load(); return head(null) + skeleton(4); }
  const pub = list.filter((p) => p.published);
  const count = (c: PostCategory) => pub.filter((p) => p.category === c).length;
  // Learning path: beginner lessons, oldest first, so a new player knows where to start.
  const path = pub.filter((p) => p.level === 'beginner').reverse().slice(0, 6);
  const done = doneSet();
  const tile = (c: Cat) => {
    const ic = c === 'all' ? 'grid' : news.CAT_ICON[c];
    return `<button class="acad-tile acad-${c} ${cat === c ? 'on' : ''}" data-act="learn-cat" data-v="${c}" aria-pressed="${cat === c}">
      <span class="at-ic">${icon(ic, 26)}</span><b>${c === 'all' ? t('acad.allLessons') : news.catLabel(c)}</b>
      <small>${t(`acad.catText.${c}` as MessageKey)}</small><span class="at-n">${c === 'all' ? pub.length : count(c)}</span></button>`;
  };
  return `${head(list)}
  ${hint('acad.hint')}
  <div class="acad-tiles">${(['all', ...content.ACADEMY_CATEGORIES] as Cat[]).map(tile).join('')}</div>
  ${path.length && cat === 'all' && level === 'all' && !query ? `<section class="card acad-path rise">
    <div class="sec-head"><h2>${icon('pin', 22)} ${t('acad.pathTitle')}</h2><span class="muted small">${t('acad.pathText')}</span></div>
    <ol class="path-steps">${path.map((p, i) => `<li class="${done.has(p.id) ? 'done' : ''}"><a href="#/learn/${p.id}">
      <span class="ps-n">${done.has(p.id) ? icon('check', 18) : i + 1}</span><span dir="auto">${esc(p.title)}</span></a></li>`).join('')}</ol>
  </section>` : ''}
  <section class="zone z-blue">
  <h2 class="sec">${icon('book', 22)} ${t('acad.allLessons')}</h2>
  <div class="acad-tools">
    <label class="acad-search">${icon('search', 18)}<input class="input" type="search" data-act="learn-q" value="${esc(query)}" placeholder="${esc(t('acad.search'))}" aria-label="${esc(t('acad.search'))}"></label>
    <div class="chips-row">${(['all', ...content.POST_LEVELS] as const).map((l) => `<button class="pill ${level === l ? 'on' : ''}" data-act="learn-level" data-v="${l}">
      ${l === 'all' ? t('acad.allLevels') : levelBadge(l)}</button>`).join('')}</div>
  </div>
  <div id="acad-results">${results(list)}</div>
  </section>`;
}

function lessonPage(id: string): string {
  const list = lessons();
  if (!list) { news.load(); return loading(); }
  const p = list.find((x) => x.id === id);
  if (!p) return empty('grad', t('news.notFound'), `<a class="btn" href="#/learn">${t('acad.back')}</a>`);
  const author = content.person(p.author_id);
  const same = list.filter((x) => x.published && x.category === p.category).reverse();
  const at = same.findIndex((x) => x.id === p.id);
  const prev = at > 0 ? same[at - 1] : undefined;
  const next = at >= 0 && at < same.length - 1 ? same[at + 1] : undefined;
  const more = list.filter((x) => x.id !== id && x.published && x.category !== p.category).slice(0, 3);
  const done = doneSet().has(p.id);
  const step = (x: Post | undefined, kind: 'prev' | 'next') => x ? `<a class="card step-link ${kind}" href="#/learn/${x.id}">
      <small class="muted">${t(kind === 'prev' ? 'acad.prev' : 'acad.next')}</small><b dir="auto">${esc(x.title)}</b></a>` : '<span></span>';
  return `<div class="read-progress" aria-hidden="true"></div>
  <a class="backlink" href="#/learn">${icon('back', 18)} ${t('acad.back')}</a>
  <article class="card article lesson-page rise">
    ${cover(p)}
    <div class="row small" style="margin-block:12px 4px">${catBadge(p.category)}${levelBadge(p.level)}${minutes(p)}
      <span class="muted">${dateFmt.format(new Date(p.created_at))}</span></div>
    <h1 dir="auto">${esc(p.title)}</h1>
    ${author ? `<div class="row author">${avatarOf(author)}<b dir="auto">${esc(author.full_name)}</b></div>` : ''}
    ${p.summary ? `<p class="lead" dir="auto">${esc(p.summary)}</p>` : ''}
    <div class="prose">${news.richText(p.body)}</div>
    <div class="lesson-done ${done ? 'on' : ''}">
      ${done ? `<span>${icon('check', 20)} ${t('acad.doneMsg')}</span><button class="btn ghost small" data-act="learn-done" data-id="${p.id}" data-v="0">${t('acad.undo')}</button>`
        : `<span>${t('acad.doneAsk')}</span><button class="btn green" data-act="learn-done" data-id="${p.id}" data-v="1">${icon('check')} ${t('acad.doneBtn')}</button>`}
    </div>
    ${canWriteNews() ? `<div class="row" style="margin-block-start:16px">
      <a class="btn soft small" href="#/learn/${p.id}/edit">${icon('edit', 16)} ${t('news.edit')}</a>
      <button class="btn ghost small" data-act="news-delete" data-id="${p.id}">${icon('trash', 16)} ${t('news.delete')}</button></div>` : ''}
  </article>
  ${prev || next ? `<div class="step-links">${step(prev, 'prev')}${step(next, 'next')}</div>` : ''}
  ${more.length ? zone('blue', `<h2 class="sec">${icon('grad', 22)} ${t('acad.more')}</h2><div class="grid">${more.map((x) => lessonCard(x)).join('')}</div>`) : ''}`;
}

export function route(parts: string[]): string | null {
  if (parts[0] !== 'learn') return null;
  if (parts[1] === 'new') return news.editorPage(undefined, true);
  if (parts[1] && parts[2] === 'edit') return news.editorPage(parts[1], true);
  if (parts[1]) return lessonPage(parts[1]);
  return listPage();
}

export function onClick(act: string, el: HTMLElement): boolean {
  switch (act) {
    case 'learn-cat': cat = el.dataset.v as Cat; render(); return true;
    case 'learn-level': level = el.dataset.v as typeof level; render(); return true;
    case 'learn-done': {
      const on = el.dataset.v === '1';
      setDone(el.dataset.id!, on);
      if (on) toast(`🎉 ${t('acad.doneToast')}`);
      render(); return true;
    }
  }
  return false;
}

/** Search box: refresh the results only, so the field keeps focus while typing. */
export function onInput(el: HTMLInputElement): boolean {
  if (el.dataset.act !== 'learn-q') return false;
  query = el.value.trim();
  const box = document.getElementById('acad-results');
  const list = lessons();
  if (box && list) box.innerHTML = results(list);
  return true;
}
