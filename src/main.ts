import './ui/styles.css';
import { dateFmt, dateTimeFmt, days, numberFmt, t, timeFmt, type MessageKey } from './i18n/ar';
import { load, parseBackup, save, type AppData } from './domain/storage';
import {
  createTournament, duplicateTournament, groupName, groupMatches, groupStandings, groupsComplete, movePlayer,
  playerName, progress, saveResult, snakeGroups, startGroups, startKnockout, uid,
} from './domain/tournament';
import { canEditKo, isBye, placements, roundName } from './domain/bracket';
import { GAME_POINTS, gamesToWin, possibleResults, summarize, type MatchCheck } from './domain/scoring';
import { sampleNames, sampleTournament, type SampleLevel } from './domain/sample';
import * as sim from './domain/simulate';
import type { BestOf, Bracket, Game, GamesResult, Group, Match, StageFormats, Tournament } from './domain/types';
import { avatar, avatarOf, confetti, esc, groupColor, toast } from './ui/util';
import { championCelebration } from './ui/champion';
import { online, SUPPORT_WHATSAPP } from './config';
import { DEFAULT_PASSWORD, loginEmail, normalizeMobile } from './domain/mobile';
import * as remote from './data/remote';
import { addExtraPlayer, addPlayerToSetup, closeRegistration, extraCandidates, groupsOf, isExtra, qualifyingRows, recordsPoints, removeExtraPlayer, reshuffleGroups, exactDirectoryMatch, groupOf, numberTables, registrationOf, removePlayerFromSetup, searchDirectory, setGroupTable, TABLE_MAX } from './domain/tournament';
import { assisting, canOrganize, isAdmin, isAssistantFor, isSeller, isTrainer, preview, previewProfile, PREVIEWS, rendering, session, setRender, type Preview } from './app/ctx';
import { accountOf, daysUntil, homeTournaments, matchesLocation, matchesTime, PUBLIC_STATUSES, publicStatus, sortForListing, TIME_FILTERS, topTwo, tournamentLocations, type PublicStatus, type TimeFilter } from './domain/tournament';
import * as admin from './pages/admin';
import * as content from './data/content';
import * as news from './pages/news';
import * as shop from './pages/shop';
import * as training from './pages/training';
import * as faq from './pages/faq';
import * as claim from './pages/claim';
import * as desk from './admin';
import { icon } from './ui/icons';
import { cover, empty, heroArt } from './ui/art';
import { carLogo, fadeSwipe, fadeTo } from './ui/carouselFade';

/* ------------------------------------------------------------------ state */

type View = 'player' | 'organizer';

const prefs = {
  get view(): View {
    try { return (localStorage.getItem('pingo.view') as View) || 'organizer'; } catch { return 'organizer'; }
  },
  set view(v: View) {
    try { localStorage.setItem('pingo.view', v); } catch { /* ignore */ }
  },
  get hints(): boolean {
    try { return localStorage.getItem('pingo.hints') !== 'off'; } catch { return true; }
  },
  set hints(on: boolean) {
    try { localStorage.setItem('pingo.hints', on ? 'on' : 'off'); } catch { /* ignore */ }
  },
};

let data: AppData = load();

const isOrg = () => canOrganize() && prefs.view === 'organizer';

/** JSON of each tournament as last saved on the server, to upload only changes. */
const synced = new Map<string, string>();

function persist(): void {
  if (!online()) {
    if (!save(data)) toast(t('common.storageFull'));
    return;
  }
  for (const tm of data.tournaments) {
    const mine = isAdmin() || !tm.organizerId || tm.organizerId === session.profile?.id;
    const helper = !mine && assisting.has(tm.id);
    if (!mine && !helper) continue;
    const { organizerId: _o, ...rest } = tm;
    const json = JSON.stringify(rest);
    if (synced.get(tm.id) === json) continue;
    synced.set(tm.id, json);
    if (!tm.organizerId && session.profile) tm.organizerId = session.profile.id;
    (helper ? remote.assistantSaveTournament(tm) : remote.saveTournament(tm)).catch(() => {
      synced.delete(tm.id);
      toast(t('sync.failed'));
    });
  }
}

async function refreshFromServer(): Promise<void> {
  if (!online()) return;
  try {
    session.profile = await remote.myProfile();
    data = { version: 1, tournaments: await remote.listTournaments() };
    synced.clear();
    for (const tm of data.tournaments) {
      const { organizerId: _o, ...rest } = tm;
      synced.set(tm.id, JSON.stringify(rest));
    }
    myRegs = session.profile ? await remote.myRegistrations() : [];
    myRoleReqs = null;
    await content.people(data.tournaments.map((x) => x.organizerId ?? '')).catch(() => undefined);
    news.reset(); shop.reset(); training.reset(); admin.reset(); desk.reset();
    assisting.clear();
    if (session.profile) {
      for (const id of await content.myAssignments().catch(() => [] as string[])) assisting.add(id);
      await uploadPendingPhoto();
    }
  } catch {
    toast(t('auth.err.network'));
  }
  session.loading = false;
}

const PHOTO_KEY = 'pingo.pendingPhoto';

/** A photo chosen at sign-up is kept in the browser until the account can upload it. */
async function uploadPendingPhoto(): Promise<void> {
  let data: string | null = null;
  try { data = localStorage.getItem(PHOTO_KEY); } catch { /* ignore */ }
  if (!data || !session.profile || session.profile.avatar_url) return;
  try {
    const url = await content.uploadImage(content.dataUrlToBlob(data), 480);
    await remote.updateProfile(session.profile.id, { avatar_url: url });
    session.profile.avatar_url = url;
    localStorage.removeItem(PHOTO_KEY);
  } catch { /* try again next time */ }
}

let myRegs: remote.Registration[] = [];
let myRoleReqs: content.RoleRequest[] | null = null;
const ONLINE_ACTS = new Set(['auth-tab', 'forgot', 'logout', 'join', 'withdraw', 'decide', 'reg-open', 'reg-close', 'copy-link',
  'dir-pick', 'dir-new', 'rm-player', 'link-open', 'link-save', 'confirm-user', 'me-photo-rm']);

function findT(id: string): Tournament | undefined {
  return data.tournaments.find((x) => x.id === id);
}

const app = document.getElementById('app')!;

/* ---------------------------------------------------------------- helpers */

const n = (x: number) => numberFmt.format(x);
const hint = (key: MessageKey) => `<p class="hint">${esc(t(key))}</p>`;

/** "طاولة 3" for a number, the organizer's own label otherwise. */
function tableText(table?: string): string {
  if (!table) return '';
  return /^\d+$/.test(table) ? t('table.n', { n: table }) : table;
}
const tableBadge = (g?: Group) => g?.table
  ? `<span class="badge table-badge" title="${esc(t('table.title'))}">🏓 <span dir="auto">${esc(tableText(g.table))}</span></span>` : '';
const bo = (b: BestOf) => t('format.bestOf', { n: b });

/** Player avatar: their profile photo when the account has one. */
function pAvatar(tm: Tournament, pid: string | null): string {
  const pl = tm.players.find((x) => x.id === pid);
  return avatar(playerName(tm, pid), pl ? content.photoOf(accountOf(pl)) : null, pl ? content.genderOf(accountOf(pl)) : null);
}

/** Cartoon celebration with the champion's photo (or drawn face) for a finished tournament's card. */
function champCelebration(tm: Tournament, pid: string | null): string {
  const pl = tm.players.find((x) => x.id === pid);
  const acc = pl ? accountOf(pl) : undefined;
  return championCelebration(tm.id, content.photoOf(acc), content.genderOf(acc));
}

/** Load photos for a tournament's players once. */
const photosLoaded = new Set<string>();
function loadPhotos(tm: Tournament): void {
  if (!online() || photosLoaded.has(tm.id)) return;
  photosLoaded.add(tm.id);
  const ids = tm.players.map(accountOf).filter((x): x is string => !!x);
  if (ids.length) content.people(ids).then(() => route()).catch(() => undefined);
}

/** May this user enter results in this tournament (organizer view, or assistant)? */
const canScore = (tm: Tournament) => isOrg() || isAssistantFor(tm.id);

function stageIndex(tm: Tournament): number {
  if (tm.stage === 'setup') return 0;
  if (tm.stage === 'groups') return 1;
  const main = tm.brackets.find((b) => b.kind === 'main');
  return main && placements(main, tm.matches).some((p) => p.place === 1) ? 3 : 2;
}

function stagePath(tm: Tournament): string {
  const now = stageIndex(tm);
  const icons = ['🧩', '👥', '⚔️', '🏆'];
  const labels: MessageKey[] = ['stage.setup', 'stage.groups', 'stage.knockout', 'stage.champion'];
  const parts: string[] = [];
  icons.forEach((ic, i) => {
    if (i) parts.push(`<span class="line ${i <= now ? 'done' : ''}"></span>`);
    const cls = i < now || (i === 3 && now === 3) ? 'done' : i === now ? 'now' : '';
    parts.push(`<span class="node ${cls}" aria-hidden="true">${ic}</span>`);
  });
  return `<div class="path">${parts.join('')}</div>
    <div class="path-labels">${labels.map((l, i) => `<span${i === now ? ' style="font-weight:900;color:#fff"' : ''}>${t(l)}</span>`).join('')}</div>`;
}

function xp(done: number, total: number): string {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<div class="xp" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`;
}

/**
 * Two numbers laid out in the page direction, so the first player's number
 * sits on the first player's side (the right side in Arabic).
 */
function pair(x: number | string, y: number | string, sep = '-'): string {
  return `<span class="pair"><b>${x}</b><i>${sep}</i><b>${y}</b></span>`;
}

function gamesList(games: Game[]): string {
  return `<span class="games">${games.map((g) => pair(g.a, g.b)).join('<i>·</i>')}</span>`;
}

function scoreText(m: Match): string {
  const s = summarize(m);
  return pair(s.gamesA, s.gamesB);
}

/** A tournament the signed-in organizer created, or helps with as score assistant. */
function isMine(tm: Tournament): boolean {
  const me = session.profile?.id;
  return !!me && (tm.organizerId === me || assisting.has(tm.id));
}

/* ------------------------------------------------------------------ shell */

/**
 * One-click shortcuts to each role's own area, shown under the header on every
 * page for organizers, sellers and trainers. Someone with several roles sees each.
 */
function workspaceBar(): string {
  if (!online() || !session.profile) return '';
  const here = location.hash;
  const links: [string, string, MessageKey, MessageKey, boolean][] = [];
  if (canOrganize()) links.push(['#/desk/org', 'trophy', 'ws.myTournaments', 'ws.myTournamentsTip', here.startsWith('#/tournaments/mine')]);
  if (isSeller()) links.push(['#/desk/seller', 'shop', 'ws.myProducts', 'ws.myProductsTip', here.startsWith('#/shop/manage')]);
  if (isTrainer()) links.push(['#/desk/trainer', 'coach', 'ws.mySessions', 'ws.mySessionsTip', here.startsWith('#/training/manage')]);
  if (isAdmin()) links.push(['#/desk/admin', 'shield', 'ws.adminDesk', 'ws.adminDeskTip', false]);
  if (!links.length) return '';
  return `<nav class="wsbar" aria-label="${esc(t('ws.label'))}"><span class="ws-label">${icon('grid', 16)} <span class="ws-name">${t('ws.label')}</span></span>
    ${links.map(([href, ic, label, tip, on]) => `<a class="ws-btn" href="${href}" title="${esc(t(tip))}" ${on ? 'aria-current="page"' : ''}>${icon(ic, 18)}<span>${t(label)}</span></a>`).join('')}</nav>`;
}

type Section = 'home' | 'tournaments' | 'news' | 'shop' | 'training' | 'me';

function section(): Section {
  const p = location.hash.replace(/^#\/?/, '').split('/')[0];
  if (p === 'news' || p === 'shop' || p === 'training') return p;
  if (p === 'tournaments' || p === 't' || p === 'new' || p === 'org') return 'tournaments';
  if (p === 'me' || p === 'login' || p === 'admin' || p === 'players') return 'me';
  return 'home';
}

function navItems(): [Section, string, string, MessageKey][] {
  const items: [Section, string, string, MessageKey][] = [
    ['home', '#/', 'home', 'nav.home'],
    ['tournaments', '#/tournaments', 'trophy', 'nav.tournaments'],
  ];
  if (online()) {
    items.push(['news', '#/news', 'news', 'nav.news'], ['shop', '#/shop', 'shop', 'nav.shop'], ['training', '#/training', 'coach', 'nav.training']);
    items.push(['me', session.profile ? '#/me' : '#/login', 'user', session.profile ? 'nav.me' : 'auth.login']);
  }
  return items;
}

function shell(body: string): void {
  const v = prefs.view;
  const sec = section();
  document.body.classList.toggle('no-hints', !prefs.hints);
  document.body.dataset.section = sec;
  const nav = navItems();
  app.innerHTML = `
  <header class="top">
    <a class="brand" href="#/" aria-label="${esc(t('app.name'))}"><img src="${import.meta.env.BASE_URL}brand/logo.png" alt="${esc(t('app.name'))}" width="69" height="46"></a>
    <nav class="topnav" aria-label="${esc(t('nav.label'))}">${nav.filter(([k]) => k !== 'me').map(([k, href, ic, label]) =>
      `<a href="${href}" ${sec === k ? 'aria-current="page"' : ''}>${icon(ic, 18)}<span>${t(label)}</span></a>`).join('')}</nav>
    <span class="spacer"></span>
    ${canOrganize() && (sec === 'tournaments' || sec === 'home') ? `<div class="switch" role="group" aria-label="${esc(t('view.hint'))}" title="${esc(t('view.hint'))}">
      <button data-act="view" data-v="player" aria-pressed="${v === 'player'}">🎾 <span class="hide-xs">${t('view.player')}</span></button>
      <button data-act="view" data-v="organizer" aria-pressed="${v === 'organizer'}">🛠️ <span class="hide-xs">${t('view.organizer')}</span></button>
    </div>` : ''}
    ${online() ? (session.profile
      ? `<a class="acct" href="#/me" title="${esc(t('me.title'))}">${avatarOf(session.profile)}<span class="hide-sm">${esc(session.profile.full_name)}</span></a>`
      : `<a class="btn small" href="#/login">${t('auth.login')}</a>`) : ''}
    ${isAdmin() ? `<a class="helpbtn adminbtn" href="#/admin" title="${esc(t('adm.title'))}" aria-label="${esc(t('adm.title'))}">${icon('shield', 18)}</a>` : ''}
    <button class="helpbtn" data-act="hints" aria-pressed="${prefs.hints}" title="${t('common.help')}" aria-label="${t('common.help')}">؟</button>
  </header>
  ${session.profile?.must_change_password && rendering.preview === 'off' && !location.hash.startsWith('#/password') ? `<div class="pw-bar" role="status">🔑 <span>${t('pw.banner')}</span>
    <a class="btn small gold" href="#/password">${t('pw.bannerBtn')}</a></div>` : ''}
  ${rendering.preview !== 'off' ? `<div class="preview-bar" role="status">${icon('eye', 18)}
    <span>${t('sim.viewingAs')} <b>${t(`sim.role.${rendering.preview}` as MessageKey)}</b></span>
    <span class="pv-roles">${PREVIEWS.map((r) => `<button data-act="pv-set" data-v="${r}" ${r === rendering.preview ? 'aria-pressed="true"' : ''}>${t(`sim.role.${r}` as MessageKey)}</button>`).join('')}</span>
    <a class="btn small gold" href="#/admin/sim">${t('sim.steps')}</a>
    <button class="btn small soft" data-act="pv-set" data-v="off">${icon('x', 14)} ${t('sim.exit')}</button></div>` : ''}
  ${workspaceBar()}
  <main class="page">${body}</main>
  ${nav.length > 2 ? `<nav class="bottomnav" aria-label="${esc(t('nav.label'))}">${nav.map(([k, href, ic, label]) =>
    `<a href="${href}" ${sec === k ? 'aria-current="page"' : ''}>${icon(ic, 22)}<span>${t(label)}</span></a>`).join('')}</nav>` : ''}
  ${faq.supportButton()}`;
}

/* ------------------------------------------------------------------- home */

/** Wide news carousel: newest articles with their pictures, managed by the admin. */
function newsCarousel(posts: content.Post[]): string {
  if (!posts.length) {
    return `<section class="hero landing rise"><div class="hero-text">
      <span class="kicker">${icon('spark', 16)} ${t('home.kicker')}</span><h1>${t('home.heroTitle')}</h1><p>${t('home.heroText')}</p>
      <div class="row">${session.profile ? `<a class="btn gold" href="#/training">${icon('calendar')} ${t('home.ctaBook')}</a>`
        : `<a class="btn gold" href="#/login">${icon('user')} ${t('auth.signup')}</a>`}</div></div>${heroArt()}</section>`;
  }
  return `<section class="carousel rise" data-carousel data-fade aria-roledescription="carousel" aria-label="${esc(t('nav.news'))}">
    <div class="car-track">${posts.map((p, i) => `<a class="car-slide${i ? '' : ' on'}" href="#/news/${p.id}" aria-label="${esc(p.title)}" data-i="${i}" draggable="false"${i ? ' inert' : ''}>
      ${cover(p.cover_url, p.id, news.CAT_ICON[p.category], esc(p.title))}
      <div class="car-text"><span class="badge gold">${icon(news.CAT_ICON[p.category], 14)} ${t(`news.cat.${p.category}` as MessageKey)}</span>
        <h2 dir="auto">${esc(p.title)}</h2>${p.summary ? `<p dir="auto">${esc(p.summary)}</p>` : ''}
        <span class="car-more">${t('home.readMore')} ${icon('chevron', 16)}</span></div></a>`).join('')}</div>
    ${posts.length > 1 ? carLogo(import.meta.env.BASE_URL) : ''}
    ${carControls(posts.length)}
  </section>`;
}

/** Status badge for a tournament card. */
function statusBadge(st: PublicStatus, cls = 'tc-status'): string {
  const look: Record<PublicStatus, [string, string]> = {
    open: ['gold', '📝'], running: ['green', '⚡'], upcoming: ['blue', '⏳'], finished: ['', '🏆'],
  };
  const ic = look[st][1];
  return `<span class="badge ${cls} ${look[st][0]}">${ic} ${t(`tl.st.${st}` as MessageKey)}</span>`;
}

/** "Today", "in 3 days", "2 days ago". */
function whenText(tm: Tournament): string {
  const d = daysUntil(tm);
  if (d === null) return '';
  if (d === 0) return t('tl.today');
  if (d === 1) return t('tl.tomorrow');
  if (d === -1) return t('tl.yesterday');
  return d > 0 ? t('tl.inDays', { n: days(d) }) : t('tl.daysAgo', { n: days(-d) });
}

/** Join button, or where the visitor stands with this tournament. */
function cardAction(tm: Tournament, st: PublicStatus): string {
  if (st === 'finished') return `<a class="btn soft small" href="#/t/${tm.id}/knockout">${icon('trophy', 16)} ${t('tl.results')}</a>`;
  if (st !== 'open') return `<a class="btn soft small" href="#/t/${tm.id}">${icon('eye', 16)} ${t('tl.follow')}</a>`;
  if (!online()) return '';
  if (!session.profile) return `<a class="btn small tc-join" href="#/t/${tm.id}/register">${icon('ball', 16)} ${t('reg.join')}</a>`;
  const mine = myRegs.find((r) => r.tournament_id === tm.id && (r.status === 'pending' || r.status === 'approved'));
  if (mine) return `<span class="badge ${mine.status === 'approved' ? 'green' : 'gold'} tc-mine">${mine.status === 'approved' ? `${icon('check', 14)} ${t('tl.joined')}` : `⏳ ${t('tl.waiting')}`}</span>`;
  const reg = registrationOf(tm);
  if (reg.maxPlayers && tm.players.length >= reg.maxPlayers) return `<span class="badge">${t('tl.full')}</span>`;
  return `<button class="btn small tc-join" data-act="join" data-tid="${tm.id}" ${busy ? 'disabled' : ''}>${icon('ball', 16)} ${t('reg.join')}</button>`;
}

/** Rich tournament card: main photo, status, title, organizer, time, players and the join button. */
function tournamentCard(tm: Tournament): string {
  const st = publicStatus(tm);
  const org = tm.organizerId ? content.person(tm.organizerId) : undefined;
  const when = whenText(tm);
  const top = st === 'finished' ? topTwo(tm) : null;
  const p = progress(tm);
  const reg = registrationOf(tm);
  return `<article class="tcard st-${st} rise">
    <div class="tc-media">${cover(tm.cover ? esc(tm.cover) : null, tm.id, 'trophy', esc(tm.name))}
      ${statusBadge(st)}${when && (st === 'open' || st === 'upcoming') ? `<span class="tc-when">${icon('clock', 14)} ${when}</span>` : ''}
      ${top ? `${champCelebration(tm, top.first)}<div class="tc-champ"><span><small>🥇 ${t('stage.champion')}</small><b dir="auto">${esc(playerName(tm, top.first))}</b></span></div>` : ''}
    </div>
    <div class="tc-body">
      <h3 dir="auto"><a class="tc-link" href="#/t/${tm.id}">${esc(tm.name)}</a></h3>
      ${online() && tm.organizerId ? `<div class="tc-org">${avatarOf(org)}<span class="muted small">${t('tl.by')} <b dir="auto">${esc(org?.full_name || t('tl.organizer'))}</b></span></div>` : ''}
      <div class="tc-meta">
        ${tm.date ? `<span>${icon('calendar', 15)} ${dateFmt.format(new Date(tm.date))}${tm.time ? ` · ${esc(timeText(tm.time))}` : ''}</span>` : ''}
        ${tm.location ? `<span dir="auto">${icon('pin', 15)} ${esc(tm.location)}</span>` : ''}
        <span>${icon('users', 15)} ${n(tm.players.length)}${reg.maxPlayers && st === 'open' ? ` / ${n(reg.maxPlayers)}` : ''} ${t('t.players')}</span>
      </div>
      ${st === 'running' ? xp(p.done, p.total) : ''}
      ${top ? `<div class="tc-runner muted small">🥈 <span dir="auto">${esc(playerName(tm, top.second))}</span></div>` : ''}
      <div class="tc-foot">${cardAction(tm, st)}<a class="tc-more" href="#/t/${tm.id}" aria-hidden="true" tabindex="-1">${icon('chevron', 18)}</a></div>
    </div>
  </article>`;
}

/** "18:30" shown as "6:30 م". */
function timeText(hm: string): string {
  const [h, m] = hm.split(':').map(Number);
  if (Number.isNaN(h)) return hm;
  const d = new Date(2000, 0, 1, h, m || 0);
  return timeFmt.format(d);
}

/** Arrows and dots for a carousel of `count` slides. */
function carControls(count: number): string {
  if (count < 2) return '';
  return `<div class="car-dots">${Array.from({ length: count }, (_, i) => `<button data-act="car-go" data-i="${i}" aria-label="${i + 1}" ${i ? '' : 'aria-current="true"'}></button>`).join('')}</div>
    <button class="car-arrow prev" data-act="car-step" data-d="-1" aria-label="${esc(t('home.prev'))}">${icon('back', 20)}</button>
    <button class="car-arrow next" data-act="car-step" data-d="1" aria-label="${esc(t('home.next'))}">${icon('chevron', 20)}</button>`;
}

/** Tournament carousel: open and running tournaments, then the top two of those that ended in the last 30 days. */
function tournamentCarousel(): string {
  const { live, recent } = homeTournaments(data.tournaments);
  const list = [...sortForListing(live), ...recent];
  recent.forEach(loadPhotos);
  const head = `<div class="sec-head"><div><h2>${icon('trophy', 22)} ${t('nav.tournaments')}</h2>${hint('tl.homeHint')}</div>
    <a class="btn soft small" href="#/tournaments">${icon('grid', 16)} ${t('tl.showAll')} <span class="badge">${n(data.tournaments.length)}</span></a></div>`;
  if (!list.length) return head + empty('trophy', t('tl.noneNow'), `<a class="btn gold small" href="#/tournaments">${t('tl.showAll')}</a>`);
  return `${head}
    <section class="tcarousel" data-carousel aria-roledescription="carousel" aria-label="${esc(t('nav.tournaments'))}">
      <div class="car-track">${list.map((tm, i) => `<div class="car-cell" data-i="${i}">${tournamentCard(tm)}</div>`).join('')}</div>
      ${carControls(list.length)}
    </section>`;
}

/** Home: news carousel first, then tournaments, then the other sections. */
function homePage(): string {
  if (!online()) return tournamentsPage();
  if (session.loading) return `<div class="card center muted"><span class="spin"></span> ${t('sync.loading')}</div>`;
  const posts = news.latest(5);
  const prods = shop.featured(4);
  const free = training.openSlots(6);
  if (!posts) news.load();
  if (!prods) shop.load();
  if (!free) training.load();
  const feature = (href: string, ic: string, title: MessageKey, text: MessageKey, cls: string) =>
    `<a class="feature ${cls} rise" href="${href}"><span class="f-ic">${icon(ic, 30)}</span><b>${t(title)}</b><small>${t(text)}</small></a>`;
  const more = (href: string) => `<a class="more" href="${href}">${t('home.seeAll')} ${icon('chevron', 16)}</a>`;
  return `
  ${posts === null ? '<div class="sk-row car-sk"></div>' : newsCarousel(posts)}
  ${tournamentCarousel()}
  <div class="features">
    ${feature('#/tournaments', 'trophy', 'nav.tournaments', 'home.fTournaments', 'f1')}
    ${feature('#/training', 'coach', 'nav.training', 'home.fTraining', 'f2')}
    ${feature('#/shop', 'shop', 'nav.shop', 'home.fShop', 'f3')}
    ${feature('#/news', 'news', 'nav.news', 'home.fNews', 'f4')}
  </div>
  <a class="card faq-cta rise" href="#/faq"><span class="faq-ic">${icon('help', 26)}</span>
    <span><b>${t('faq.title')}</b><br><small class="muted">${t('faq.homeText')}</small></span>${icon('chevron', 18)}</a>
  <div class="sec-head"><h2>${icon('star', 22)} ${t('home.shopPicks')}</h2>${more('#/shop')}</div>
  ${prods === null ? '<div class="sk-row"></div>' : prods.length ? `<div class="grid products">${prods.map(shop.productCard).join('')}</div>` : `<p class="muted">${t('shop.empty')}</p>`}
  <div class="sec-head"><h2>${icon('calendar', 22)} ${t('home.nextSlots')}</h2>${more('#/training')}</div>
  ${free === null ? '<div class="sk-row"></div>' : free.length
    ? `<div class="slots strip">${free.map((x) => `<a class="slot" href="#/training/t/${x.trainer_id}"><span class="slot-time">${icon('clock', 16)} ${dateTimeFmt.format(new Date(x.starts_at))}</span>
        <span class="small" dir="auto">${icon('coach', 14)} ${esc(training.trainerName(x.trainer_id))}</span></a>`).join('')}</div>`
    : `<p class="muted">${t('tr.noSlots')}</p>`}`;
}

/* Carousels: arrows, dots and auto-advance every 6 seconds unless the visitor is touching them. */
const carTimers: number[] = [];

/** Distance to scroll so `cell` sits at the start edge of `track` (right edge in Arabic). */
function carOffset(track: HTMLElement, cell: HTMLElement): number {
  const tr = track.getBoundingClientRect(), cr = cell.getBoundingClientRect();
  return getComputedStyle(track).direction === 'rtl' ? cr.right - tr.right : cr.left - tr.left;
}

/** Index of the slide nearest the start edge. */
function carIndex(track: HTMLElement): number {
  let best = 0, dist = Infinity;
  Array.from(track.children).forEach((c, i) => {
    const d = Math.abs(carOffset(track, c as HTMLElement));
    if (d < dist) { dist = d; best = i; }
  });
  return best;
}

const carAtEnd = (track: HTMLElement) => Math.abs(track.scrollLeft) + track.clientWidth >= track.scrollWidth - 4;

function carGo(c: HTMLElement, i: number): void {
  const track = c.querySelector<HTMLElement>('.car-track');
  if (!track || !track.children.length) return;
  const slides = track.children.length;
  const k = ((i % slides) + slides) % slides;
  if (c.hasAttribute('data-fade')) {
    if (!fadeTo(c, k)) return;
  } else track.scrollBy({ left: carOffset(track, track.children[k] as HTMLElement), behavior: 'smooth' });
  c.querySelectorAll('.car-dots button').forEach((b, j) => b.toggleAttribute('aria-current', j === k));
  c.dataset.at = String(k);
}

function startCarousels(): void {
  while (carTimers.length) clearInterval(carTimers.pop());
  document.querySelectorAll<HTMLElement>('[data-carousel]').forEach((c) => {
    const track = c.querySelector<HTMLElement>('.car-track');
    if (!track) return;
    const fade = c.hasAttribute('data-fade');
    if (fade) fadeSwipe(c, (d) => carGo(c, Number(c.dataset.at ?? 0) + d));
    else track.addEventListener('scroll', () => {
      const k = carIndex(track);
      c.querySelectorAll('.car-dots button').forEach((b, j) => b.toggleAttribute('aria-current', j === k));
      c.dataset.at = String(k);
    }, { passive: true });
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let paused = false;
    c.addEventListener('pointerenter', () => (paused = true));
    c.addEventListener('pointerleave', () => (paused = false));
    c.addEventListener('focusin', () => (paused = true));
    c.addEventListener('focusout', () => (paused = false));
    carTimers.push(window.setInterval(() => {
      if (paused || !document.contains(c) || document.hidden) return;
      carGo(c, !fade && carAtEnd(track) ? 0 : Number(c.dataset.at ?? 0) + 1);
    }, 6000));
  });
}

type ListFilter = 'all' | 'mine' | PublicStatus;
const listFilters = { time: 'any' as TimeFilter, place: '' };

/** Places already used, offered as suggestions when typing a location. */
function placeList(): string {
  return `<datalist id="placeList">${tournamentLocations(data.tournaments).map((p) => `<option value="${esc(p)}">`).join('')}</datalist>`;
}

/** All tournaments, filtered by status (the filter is part of the link: #/tournaments/open). */
function tournamentsPage(filterArg?: string): string {
  const ts = data.tournaments;
  const players = ts.reduce((s, x) => s + x.players.length, 0);
  const done = ts.reduce((s, x) => s + Object.values(x.matches).filter((m) => summarize(m).winner && m.aId && m.bId).length, 0);
  const canMine = canOrganize() && !!session.profile;
  const filter: ListFilter = filterArg === 'mine' && canMine ? 'mine'
    : (PUBLIC_STATUSES as string[]).includes(filterArg ?? '') ? filterArg as PublicStatus : 'all';
  // The organizer shortcut lands here: open it in organizer view so the tools are ready.
  if (filter === 'mine' && prefs.view !== 'organizer') prefs.view = 'organizer';
  const places = tournamentLocations(ts);
  if (listFilters.place && !places.includes(listFilters.place)) listFilters.place = '';
  const inWindow = ts.filter((x) => matchesTime(x, listFilters.time) && matchesLocation(x, listFilters.place));
  const counts = new Map<ListFilter, number>([['all', inWindow.length]]);
  for (const x of inWindow) { const st = publicStatus(x); counts.set(st, (counts.get(st) ?? 0) + 1); }
  if (canMine) counts.set('mine', inWindow.filter(isMine).length);
  const shown = sortForListing(inWindow).filter((x) => filter === 'all' || (filter === 'mine' ? isMine(x) : publicStatus(x) === filter));
  const filtered = listFilters.time !== 'any' || !!listFilters.place;
  shown.filter((x) => publicStatus(x) === 'finished').forEach(loadPhotos);
  const chip = (k: ListFilter, ic: string) => `<a class="fchip" href="#/tournaments${k === 'all' ? '' : '/' + k}" ${k === filter ? 'aria-current="true"' : ''}>${ic} ${t(`tl.f.${k}` as MessageKey)} <b>${n(counts.get(k) ?? 0)}</b></a>`;

  const org = isOrg();
  if (session.loading) return `<div class="card center muted">⏳ ${t('sync.loading')}</div>`;
  return `
  <section class="hero">
    <h1>${icon('trophy', 26)} ${online() ? t('nav.tournaments') : t('app.name') + ' 🏓'}</h1>
    <p class="muted">${t('app.tagline')}</p>
    ${online() && !session.profile ? `<div class="row" style="margin-block-start:12px">
      <a class="btn gold" href="#/login">👤 ${t('auth.signup')}</a><span class="small">${t('auth.hint')}</span></div>` : ''}
    ${org ? `<div class="row" style="margin-block-start:12px">
      <a class="btn gold" href="#/new">➕ ${t('home.create')}</a>
      <button class="btn soft" data-act="sample-open">🎲 ${t('home.sample')}</button>
      ${online() && session.profile ? `<a class="btn soft" href="#/players">👥 ${t('dir.link')}</a><a class="btn soft" href="#/admin">🛡️ ${t('users.link')}</a>` : ''}
    </div>` : ''}
  </section>
  <div class="stats" style="margin-block:14px">
    <div class="stat"><b>${n(ts.length)}</b><small>${t('home.statTournaments')}</small></div>
    <div class="stat"><b>${n(players)}</b><small>${t('home.statPlayers')}</small></div>
    <div class="stat"><b>${n(done)}</b><small>${t('home.statMatches')}</small></div>
  </div>
  ${org ? samplePanel() : ''}
  <div class="sec-head"><h2>${icon('trophy', 22)} ${t(filter === 'mine' ? 'ws.myTournaments' : 'tl.allTitle')}</h2></div>
  <div class="fbar">
    <label class="fsel">${icon('calendar', 16)}
      <select data-act="tl-time" aria-label="${esc(t('tl.whenLabel'))}">${TIME_FILTERS.map((f) => `<option value="${f}" ${f === listFilters.time ? 'selected' : ''}>${t(`tl.when.${f}` as MessageKey)}</option>`).join('')}</select></label>
    <label class="fsel">${icon('pin', 16)}
      <select data-act="tl-place" aria-label="${esc(t('tl.location'))}" ${places.length ? '' : 'disabled'}><option value="">${t('tl.anyPlace')}</option>${places.map((p) => `<option ${p === listFilters.place ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
    ${filtered ? `<button class="btn ghost small" data-act="tl-clear">${icon('x', 14)} ${t('tl.clear')}</button>` : ''}
  </div>
  <nav class="fchips" aria-label="${esc(t('tl.filter'))}">${canMine ? chip('mine', '🛠️') : ''}${chip('all', '🏓')}${chip('open', '📝')}${chip('running', '⚡')}${chip('upcoming', '⏳')}${chip('finished', '🏆')}</nav>
  ${filter === 'mine' && !shown.length && !filtered ? empty('trophy', t('ws.noMine'), `<a class="btn gold small" href="#/new">➕ ${t('home.create')}</a>`)
    : !ts.length ? `<div class="card center muted">${t(org ? 'home.empty' : 'home.emptyPlayer')}</div>`
    : shown.length ? `<div class="grid tgrid">${shown.map(tournamentCard).join('')}</div>`
    : empty('search', t('tl.noneFilter'), filtered ? `<button class="btn soft small" data-act="tl-clear">${t('tl.clear')}</button>` : `<a class="btn soft small" href="#/tournaments">${t('tl.f.all')}</a>`)}
  ${org && !online() ? `<div class="card">
    <h3>💾 ${t('home.backup')}</h3>
    ${hint('home.backupHint')}
    <div class="row">
      <button class="btn soft small" data-act="export">⬇️ ${t('home.export')}</button>
      <label class="btn soft small">⬆️ ${t('home.import')}<input type="file" accept="application/json,.json" data-act="import" class="hidden"></label>
    </div>
  </div>` : ''}`;
}

let sampleOpen = false;
function samplePanel(): string {
  if (!sampleOpen) return '';
  const levels: SampleLevel[] = ['setup', 'groupsHalf', 'groupsDone', 'finished'];
  return `<div class="card" id="sample">
    <h3>🎲 ${t('home.sampleTitle')}</h3>
    ${hint('home.sampleHint')}
    <div class="row">
      <label class="field" style="flex:1"><span>${t('home.sample.players')}</span>
        <select class="input" id="sPlayers">${[8, 12, 16, 24, 32].map((x) => `<option ${x === 16 ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="field" style="flex:1"><span>${t('home.sample.groups')}</span>
        <select class="input" id="sGroups">${[2, 3, 4, 6, 8].map((x) => `<option ${x === 4 ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    </div>
    <label class="row" style="margin-block:8px"><input type="checkbox" id="sPoints"> ${t('home.sample.points')}</label>
    <div class="stack">${levels.map((l) => `<button class="btn soft block" data-act="sample" data-level="${l}">${t(`home.sample.${l}` as MessageKey)}</button>`).join('')}</div>
  </div>`;
}

/* ----------------------------------------------------------------- wizard */

interface Draft {
  step: number;
  name: string;
  date: string;
  time: string;
  location: string;
  players: string;
  groupCount: number;
  formats: StageFormats;
  consolation: { enabled: boolean; name: string };
  pointsPerGame: boolean;
  selfReg: boolean;
  autoAccept: boolean;
  maxPlayers: string;
  /** Names picked from the directory → their directory id. */
  dirIds: Record<string, string>;
  error: string;
}

const newDraft = (): Draft => ({
  step: 0,
  name: '',
  date: new Date().toISOString().slice(0, 10),
  time: '',
  location: '',
  players: '',
  groupCount: 4,
  formats: { group: 3, early: 3, semi: 5, final: 5 },
  consolation: { enabled: true, name: 'بطولة الترضية' },
  pointsPerGame: false,
  selfReg: online(),
  autoAccept: false,
  maxPlayers: '',
  dirIds: {},
  error: '',
});
let draft = newDraft();

const draftNames = () => draft.players.split('\n').map((s) => s.trim()).filter(Boolean);

function wizardPage(): string {
  const total = 4;
  const s = draft.step;
  const dots = Array.from({ length: total }, (_, i) => `<i class="${i <= s ? 'on' : ''}"></i>`).join('');
  let body = '';
  if (s === 0) {
    body = `
      <label class="field"><span>🏷️ ${t('wizard.name')}</span>
        <input class="input" id="wName" value="${esc(draft.name)}" placeholder="${esc(t('wizard.namePh'))}" autocomplete="off"></label>
      <label class="field"><span>📅 ${t('wizard.date')}</span>
        <input class="input" id="wDate" type="date" value="${esc(draft.date)}"></label>
      <label class="field"><span>⏰ ${t('tl.time')}</span>
        <input class="input" id="wTime" type="time" value="${esc(draft.time)}"></label>
      <label class="field"><span>📍 ${t('tl.location')}</span>
        <input class="input" id="wLoc" dir="auto" maxlength="80" value="${esc(draft.location)}" placeholder="${esc(t('tl.locationPh'))}" list="placeList"></label>
      ${placeList()}`;
  } else if (s === 1) {
    body = `
      <label class="field"><span>👥 ${t('wizard.players')} <span class="badge blue" id="wCount">${n(draftNames().length)} ${t('wizard.count')}</span></span>
        ${hint('wizard.playersHint')}
        <textarea class="input" id="wPlayers" placeholder="${esc(t('wizard.playersPh'))}" dir="auto">${esc(draft.players)}</textarea></label>
      <button class="btn soft small" data-act="w-fill">🎲 ${t('wizard.fillSample')}</button>
      ${online() ? dirPicker(new Set(Object.values(draft.dirIds)), 'dir.pick') : ''}
      ${online() ? `<div class="card" style="background:#f7f9fd">
        <label class="row"><input type="checkbox" id="wSelf" ${draft.selfReg ? 'checked' : ''}> <b>📝 ${t('reg.selfOn')}</b></label>
        ${hint('reg.selfHint')}
        <label class="row"><input type="checkbox" id="wAuto" ${draft.autoAccept ? 'checked' : ''}> ${t('reg.autoAccept')}</label>
        ${hint('reg.autoAcceptHint')}
        <label class="field"><span>${t('reg.maxPlayers')}</span>
          <input class="input" id="wMax" inputmode="numeric" value="${esc(draft.maxPlayers)}" style="max-width:160px"></label>
      </div>` : ''}`;
  } else if (s === 2) {
    const per = draftNames().length / draft.groupCount;
    body = `
      <h3>🧩 ${t('wizard.groups')}</h3>
      ${hint('wizard.groupsHint')}
      <div class="choice">${[1, 2, 3, 4, 6, 8].map((g) => `<button data-act="w-groups" data-v="${g}" aria-pressed="${draft.groupCount === g}">${g}</button>`).join('')}</div>
      <p class="muted small">≈ ${n(Math.round(per * 10) / 10)} ${t('wizard.perGroup')}</p>
      <div class="board" style="margin-block-start:10px">${snakeGroups(draftNames(), draft.groupCount).map((names, i) => `
        <div class="gcol"><h3><span class="gletter" style="background:${groupColor(i)}">${esc(groupName(i))}</span></h3>
        ${names.map((nm) => `<div class="chip ro">${avatar(nm)}${esc(nm)}</div>`).join('')}</div>`).join('')}</div>`;
  } else {
    const row = (k: keyof StageFormats) => `
      <div class="row between" style="margin-block:8px"><b>${t(`format.${k}` as MessageKey)}</b>
        <div class="choice">${([3, 5] as BestOf[]).map((b) => `<button data-act="w-format" data-k="${k}" data-v="${b}" aria-pressed="${draft.formats[k] === b}">${bo(b)}</button>`).join('')}</div>
      </div>`;
    body = `
      <h3>🎯 ${t('wizard.formats')}</h3>
      ${hint('wizard.formatsHint')}
      ${(['group', 'early', 'semi', 'final'] as const).map(row).join('')}
      <hr style="border:0;border-top:1px solid var(--line);margin-block:14px">
      <h3>✍️ ${t('scoring.title')}</h3>
      ${hint('scoring.hint')}
      ${scoringChoice(draft.pointsPerGame, 'w-scoring')}
      <hr style="border:0;border-top:1px solid var(--line);margin-block:14px">
      <h3>🥈 ${t('wizard.consolation')}</h3>
      ${hint('wizard.consolationHint')}
      <label class="row"><input type="checkbox" id="wCons" ${draft.consolation.enabled ? 'checked' : ''}> ${t('wizard.consolationOn')}</label>
      <label class="field"><span>${t('wizard.consolationName')}</span>
        <input class="input" id="wConsName" value="${esc(draft.consolation.name)}"></label>`;
  }
  return `
  <div class="card">
    <div class="row between"><h2>✨ ${t('wizard.title')}</h2><span class="muted small">${t('wizard.step')} ${n(s + 1)} ${t('wizard.of')} ${n(total)}</span></div>
    <div class="steps">${dots}</div>
    ${body}
    ${draft.error ? `<div class="err" role="alert">${esc(draft.error)}</div>` : ''}
    <div class="row between" style="margin-block-start:16px">
      ${s > 0 ? `<button class="btn soft" data-act="w-back">→ ${t('wizard.back')}</button>` : '<span></span>'}
      ${s < total - 1
        ? `<button class="btn" data-act="w-next">${t('wizard.next')} ←</button>`
        : `<button class="btn green" data-act="w-finish">🚀 ${t('wizard.finish')}</button>`}
    </div>
  </div>`;
}


function readDraft(): void {
  const v = (id: string) => (document.getElementById(id) as HTMLInputElement | null);
  if (v('wName')) draft.name = v('wName')!.value;
  if (v('wDate')) draft.date = v('wDate')!.value;
  if (v('wTime')) draft.time = v('wTime')!.value;
  if (v('wLoc')) draft.location = v('wLoc')!.value;
  if (v('wPlayers')) draft.players = (v('wPlayers') as unknown as HTMLTextAreaElement).value;
  if (v('wCons')) draft.consolation.enabled = v('wCons')!.checked;
  if (v('wConsName')) draft.consolation.name = v('wConsName')!.value;
  if (v('wSelf')) draft.selfReg = v('wSelf')!.checked;
  if (v('wAuto')) draft.autoAccept = v('wAuto')!.checked;
  if (v('wMax')) draft.maxPlayers = v('wMax')!.value.replace(/[^\d]/g, '');
}

function validateDraft(step: number): string {
  if (step === 0 && !draft.name.trim()) return t('wizard.errName');
  if (step >= 1) {
    const names = draftNames();
    if (names.length < 2 && !draft.selfReg) return t('wizard.errPlayers');
    if (new Set(names).size !== names.length) return t('wizard.errDup');
  }
  if (step >= 2 && !draft.selfReg && draftNames().length < draft.groupCount * 2) return t('wizard.errPlayers');
  return '';
}

/* ------------------------------------------------------------- tournament */

type Tab = 'register' | 'groups' | 'matches' | 'knockout' | 'media' | 'settings';

function tournamentPage(tm: Tournament, tab: Tab): string {
  const p = progress(tm);
  const tabs: [Tab, MessageKey][] = [['groups', 't.tab.groups'], ['matches', 't.tab.matches'], ['knockout', 't.tab.knockout']];
  if (online() && tm.stage === 'setup') tabs.unshift(['register', 'reg.tab']);
  if (online() && ((tm.media?.length ?? 0) > 0 || isOrg())) tabs.push(['media', 'media.tab']);
  if (isOrg()) tabs.push(['settings', 't.tab.settings']);
  loadPhotos(tm);
  let body = '';
  if (tab === 'register') body = registerView(tm);
  else if (tab === 'groups') body = tm.stage === 'setup' ? setupBoard(tm) : groupsView(tm);
  else if (tab === 'matches') body = matchesView(tm);
  else if (tab === 'knockout') body = knockoutView(tm);
  else if (tab === 'media') body = mediaView(tm);
  else body = settingsView(tm);
  if (isAssistantFor(tm.id) && !isOrg()) body = `<div class="hint">${t('assist.youAre')}</div>` + body;
  const org = tm.organizerId ? content.person(tm.organizerId) : undefined;
  return `
  <section class="hero ${tm.cover ? 't-hero' : ''}">
    ${tm.cover ? `<div class="t-hero-bg"><img src="${esc(tm.cover)}" alt="" decoding="async"></div>` : ''}
    <div class="row between" style="align-items:flex-start"><h1 dir="auto">${esc(tm.name)}</h1>${statusBadge(publicStatus(tm), 'hero-status')}</div>
    <p class="muted">${tm.date ? dateFmt.format(new Date(tm.date)) : ''}${tm.time ? ` · ${esc(timeText(tm.time))}` : ''}${tm.location ? ` · 📍 <span dir="auto">${esc(tm.location)}</span>` : ''} · ${n(tm.players.length)} ${t('t.players')}${org ? ` · ${t('tl.by')} <span dir="auto">${esc(org.full_name)}</span>` : ''}</p>
    ${tableMap(tm)}
    ${stagePath(tm)}
    <div class="row between small" style="margin-block-start:10px"><span>${t('t.progress')}</span><span>${n(p.done)} / ${n(p.total)}</span></div>
    ${xp(p.done, p.total)}
  </section>
  ${isOrg() ? simCard(tm) : ''}
  <nav class="tabs" style="margin-block:14px 4px">${tabs.map(([k, l]) => `<a href="#/t/${tm.id}/${k}" ${k === tab ? 'aria-current="page"' : ''}>${t(l)}</a>`).join('')}</nav>
  ${body}`;
}

/* Tables: the organizer may give each group a table, players see where to play */

/** The signed-in player's entry in this tournament, if they play in it. */
function myPlayerId(tm: Tournament): string | undefined {
  const me = session.profile?.id;
  return me ? tm.players.find((p) => p.profileId === me || p.accountId === me)?.id : undefined;
}

/** Hero strip: the player's own group and table first, then every group's table. */
function tableMap(tm: Tournament): string {
  if (tm.stage === 'knockout' || !tm.groups.some((g) => g.table)) return '';
  const pid = myPlayerId(tm);
  const mine = pid ? groupOf(tm, pid) : undefined;
  const fills = pid ? groupsOf(tm, pid).filter((g) => g !== mine && g.table) : [];
  const mineLine = (mine?.table ? `<div class="my-table">🎯 ${t('table.yourGroup')} <b>${esc(mine.name)}</b> · ${t('table.playAt')} <b dir="auto">${esc(tableText(mine.table))}</b></div>` : '')
    + fills.map((g) => `<div class="my-table">🧩 ${t('extra.youFill')} <b>${esc(g.name)}</b> · ${t('table.playAt')} <b dir="auto">${esc(tableText(g.table!))}</b></div>`).join('');
  const chips = tm.groups.map((g, i) => g.table ? `<span class="table-chip ${g === mine ? 'mine' : ''}">
      <span class="gletter" style="background:${groupColor(i)}">${esc(g.name)}</span><span dir="auto">🏓 ${esc(tableText(g.table))}</span></span>` : '').join('');
  return `${mineLine}<div class="table-map" aria-label="${esc(t('table.where'))}">${chips}</div>`;
}

/** Organizer editor: one box per group, editable at any stage. */
function tablesCard(tm: Tournament): string {
  const any = tm.groups.some((g) => g.table);
  return `<div class="card tables-card">
    <div class="row between"><h3>🏓 ${t('table.cardTitle')}</h3><span class="badge">${t('table.optional')}</span></div>
    ${hint('table.hint')}
    <div class="tables-grid">${tm.groups.map((g, i) => `
      <label class="table-field"><span class="gletter" style="background:${groupColor(i)}">${esc(g.name)}</span>
        <span class="small">${t('setup.group')} ${esc(g.name)}</span>
        <input class="input" data-table-gid="${g.id}" value="${esc(g.table ?? '')}" maxlength="${TABLE_MAX}" dir="auto" placeholder="${esc(String(i + 1))}" aria-label="${esc(t('table.title'))} · ${t('setup.group')} ${esc(g.name)}"></label>`).join('')}
    </div>
    <div class="row" style="margin-block-start:10px">
      <button class="btn small" data-act="tables-save">💾 ${t('common.save')}</button>
      <button class="btn soft small" data-act="tables-auto">🔢 ${t('table.auto')}</button>
      ${any ? `<button class="btn ghost small" data-act="tables-clear">✕ ${t('table.clear')}</button>` : ''}
    </div>
  </div>`;
}

/* Setup: drag-and-drop group board */
let selectedChip: string | null = null;
/** Group whose "fill with a player from another group" list is open. */
let extraPickFor: string | null = null;

function setupBoard(tm: Tournament): string {
  const org = isOrg();
  const seedOf = (id: string) => tm.players.findIndex((p) => p.id === id) + 1;
  const biggest = Math.max(...tm.groups.map((g) => g.playerIds.length));
  const homeName = (pid: string) => groupOf(tm, pid)?.name ?? '';
  const extraChip = (g: Group, pid: string) => `
        <div class="chip ro extra" data-extra-pid="${pid}">
          ${pAvatar(tm, pid)}<span class="extra-who"><span dir="auto">${esc(playerName(tm, pid))}</span>
          <span class="badge extra-badge" title="${esc(t('extra.badgeTitle'))}">🧩 ${t('extra.badge')} ${t('extra.from')} ${t('setup.group')} ${esc(homeName(pid))}</span></span>
          ${org ? `<button class="btn ghost small" data-act="rm-extra" data-pid="${pid}" data-gid="${g.id}" aria-label="${t('extra.remove')}" title="${t('extra.remove')}" style="min-height:28px;padding:2px 8px;margin-inline-start:auto">✕</button>` : ''}
        </div>`;
  const extraPicker = (g: Group) => {
    if (!org) return '';
    if (extraPickFor !== g.id) {
      const short = g.playerIds.length < biggest || g.playerIds.length % 2 === 1;
      return `<button class="btn ${short ? 'soft' : 'ghost'} small block extra-add" data-act="extra-open" data-gid="${g.id}">🧩 ${t('extra.add')}</button>`;
    }
    const cands = extraCandidates(tm, g.id);
    return `<div class="extra-pick">
      <p class="small muted">${t('extra.pickHint')}</p>
      ${cands.length ? cands.map((p) => `<button class="chip ro extra-cand" data-act="extra-add" data-pid="${p.id}" data-gid="${g.id}">
        ${pAvatar(tm, p.id)}<span dir="auto">${esc(p.name)}</span><span class="seed">${t('setup.group')} ${esc(homeName(p.id))}</span></button>`).join('')
        : `<p class="small muted">${t('extra.none')}</p>`}
      <button class="btn ghost small block" data-act="extra-open" data-gid="">${t('common.cancel')}</button>
    </div>`;
  };
  const cols = tm.groups.map((g, i) => `
    <div class="gcol ${selectedChip ? 'target' : ''}" data-gid="${g.id}" ${org ? `tabindex="0" data-act="drop-here"` : ''} aria-label="${t('setup.group')} ${esc(g.name)}">
      <h3><span class="gletter" style="background:${groupColor(i)}">${esc(g.name)}</span> ${t('setup.group')} ${esc(g.name)}
        ${tableBadge(g)}<span class="badge" style="margin-inline-start:auto">${n(g.playerIds.length)}</span></h3>
      ${g.playerIds.map((pid) => isExtra(g, pid) ? extraChip(g, pid) : `
        <div class="chip ${org ? '' : 'ro'} ${selectedChip === pid ? 'sel' : ''}" data-pid="${pid}" ${org ? `tabindex="0" role="button" data-act="chip"` : ''}>
          ${org ? '<span class="grip" aria-hidden="true">⋮⋮</span>' : ''}${pAvatar(tm, pid)}<span dir="auto">${esc(playerName(tm, pid))}</span>
          <span class="seed">#${n(seedOf(pid))}</span>
          ${org && online() ? `<button class="btn ghost small" data-act="rm-player" data-pid="${pid}" aria-label="${t('dir.remove')}" title="${t('dir.remove')}" style="min-height:28px;padding:2px 8px">✕</button>` : ''}
        </div>`).join('')}
      ${extraPicker(g)}
    </div>`).join('');
  const waiting = sim.waitingPlayers(tm);
  const waitCol = waiting.length || (org && simOpen.has(tm.id)) ? `
    <div class="gcol waitcol ${selectedChip ? 'target' : ''}" data-gid="${WAITING}" ${org ? `tabindex="0" data-act="drop-here"` : ''} aria-label="${esc(t('tsim.waiting'))}">
      <h3><span class="gletter wait-letter">⏳</span> ${t('tsim.waiting')}<span class="badge ${waiting.length ? 'gold' : ''}" style="margin-inline-start:auto">${n(waiting.length)}</span></h3>
      ${waiting.length ? '' : `<p class="small muted">${t('tsim.waitingEmpty')}</p>`}
      ${waiting.map((pid) => `
        <div class="chip ${org ? '' : 'ro'} ${selectedChip === pid ? 'sel' : ''}" data-pid="${pid}" ${org ? `tabindex="0" role="button" data-act="chip"` : ''}>
          ${org ? '<span class="grip" aria-hidden="true">⋮⋮</span>' : ''}${pAvatar(tm, pid)}<span dir="auto">${esc(playerName(tm, pid))}</span>
          ${org ? `<button class="btn ghost small" data-act="rm-player" data-pid="${pid}" aria-label="${t('dir.remove')}" title="${t('dir.remove')}" style="min-height:28px;padding:2px 8px;margin-inline-start:auto">✕</button>` : ''}
        </div>`).join('')}
      ${org && waiting.length ? `<button class="btn green small block" data-act="sim-distribute" style="margin-block-start:8px">🎲 ${t('tsim.distribute')}</button>` : ''}
    </div>` : '';
  return `
  <div class="card">
    <div class="row between"><h2>🧩 ${t('setup.title')}</h2>
      ${org ? `<button class="btn soft small" data-act="reshuffle">🔀 ${t('setup.reshuffle')}</button>` : ''}</div>
    ${org ? hint('setup.hint') : ''}
    ${org ? hint('extra.hint') : ''}
    ${org && waiting.length ? hint('tsim.waitingHint') : ''}
    <div class="board" id="board">${waitCol}${cols}</div>
  </div>
  ${org ? tablesCard(tm) : ''}
  ${org && online() ? dirPicker(new Set(tm.players.map((p) => p.directoryId).filter((x): x is string => !!x)), 'dir.addToTournament') : ''}
  ${org ? `<div class="card">
    ${hint('setup.startHint')}
    <button class="btn green block" data-act="start-groups">▶️ ${t('setup.start')}</button>
  </div>` : ''}`;
}

/* Step-by-step simulation with random players and results (organizer) */
const WAITING = 'waiting';
/** Tournaments whose simulation panel is open. */
const simOpen = new Set<string>();
let simCount = 16;

/** Place a player in a group, or back on the waiting list. */
function placePlayer(tm: Tournament, pid: string, gid: string, index?: number): void {
  if (gid === WAITING) sim.moveToWaiting(tm, pid);
  else movePlayer(tm, pid, gid, index);
}

function simCard(tm: Tournament): string {
  const done = sim.finished(tm);
  if (!simOpen.has(tm.id)) {
    if (done) return '';
    return `<button class="btn soft block sim-open" data-act="sim-toggle">🎮 ${t('tsim.open')}</button>`;
  }
  const waiting = sim.waitingPlayers(tm).length;
  const placed = tm.players.length - waiting;
  const setup = tm.stage === 'setup';
  const gi = tm.stage === 'groups' ? sim.groupRoundInfo(tm) : null;
  const koNext = sim.nextKoRound(tm);
  const ready = sim.groupsReady(tm);
  // Which step is active: 0 players, 1 by hand, 2 at random, 3 start groups, 4 group rounds, 5 knockout, 6 done.
  const active = done ? 6 : tm.stage === 'knockout' ? 5 : tm.stage === 'groups' ? (ready ? 5 : 4)
    : tm.players.length < tm.groups.length * 2 ? 0 : waiting ? 1 : 3;
  const step = (i: number, title: MessageKey, body: string) => {
    // Moving by hand and distributing at random are open together while players wait.
    const state = i < active ? 'done' : i === active || (active === 1 && i === 2) ? 'now' : 'later';
    return `<li class="sim-step ${state}"><span class="sim-dot">${state === 'done' ? '✓' : n(i + 1)}</span>
      <div class="sim-body"><b>${t(title)}</b>${state === 'later' ? '' : body}</div></li>`;
  };
  const top = topTwo(tm);
  const groupsUrl = `#/t/${tm.id}/groups`;
  const steps = [
    step(0, 'tsim.s.players', setup ? `
      <p class="small muted">${t('tsim.s.playersHint')}</p>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <div class="choice sim-counts">${[8, 12, 16, 24, 32].map((c) => `<button data-act="sim-count" data-v="${c}" aria-pressed="${simCount === c}">${n(c)}</button>`).join('')}</div>
        <button class="btn green small" data-act="sim-add">🎲 ${t('tsim.add', { n: simCount })}</button>
      </div>` : ''),
    step(1, 'tsim.s.manual', setup ? `<p class="small muted">${t('tsim.s.manualHint')}</p>
      ${location.hash.startsWith(groupsUrl) ? '' : `<a class="btn soft small" href="${groupsUrl}">🧩 ${t('tsim.toBoard')}</a>`}` : ''),
    step(2, 'tsim.s.random', setup ? `<p class="small muted">${t('tsim.s.randomHint')}</p>
      <button class="btn green small" data-act="sim-distribute" ${waiting ? '' : 'disabled'}>🎲 ${t('tsim.distribute')} ${waiting ? `(${n(waiting)})` : ''}</button>` : ''),
    step(3, 'tsim.s.start', setup ? `<p class="small muted">${t('tsim.s.startHint', { n: placed, g: tm.groups.length })}</p>
      <button class="btn green small" data-act="sim-start-groups" ${waiting || placed < 2 ? 'disabled' : ''}>▶️ ${t('setup.start')}</button>` : ''),
    step(4, 'tsim.s.groups', gi && gi.next !== null ? `<p class="small muted">${t('tsim.s.groupsHint')}</p>
      ${xp(gi.next, gi.total)}
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button class="btn green small" data-act="sim-group-round">🏓 ${t('tsim.playRound', { r: gi.next + 1, of: gi.total })}</button>
        <button class="btn soft small" data-act="sim-group-all">⏩ ${t('tsim.playAllGroups')}</button>
      </div>` : ''),
    step(5, 'tsim.s.ko', tm.stage === 'groups' && ready ? `<p class="small muted">${t('tsim.s.koStartHint')}</p>
      <button class="btn green small" data-act="sim-start-ko">⚔️ ${t('ko.start')}</button>`
      : koNext ? `<p class="small muted">${t('tsim.s.koHint')}</p>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button class="btn green small" data-act="sim-ko-round">🏓 ${t('tsim.playKo', { r: t(`ko.round.${koNext}` as MessageKey) })}</button>
        <button class="btn soft small" data-act="sim-ko-all">⏩ ${t('tsim.playAllKo')}</button>
      </div>` : ''),
  ];
  return `<div class="card sim-card">
    <div class="row between"><h2>🎮 ${t('tsim.title')}</h2>
      <button class="btn ghost small" data-act="sim-toggle" aria-label="${t('tsim.close')}" title="${t('tsim.close')}">✕</button></div>
    ${hint('tsim.hint')}
    <ol class="sim-steps">${steps.join('')}</ol>
    ${done && top ? `<div class="sim-done">🏆 ${t('tsim.champion')} <b dir="auto">${esc(playerName(tm, top.first))}</b>
      <a class="btn soft small" href="#/t/${tm.id}/knockout">${t('tsim.seeBracket')}</a></div>` : ''}
  </div>`;
}

/** Run one simulation action. Returns true when handled. */
function simAction(act: string, el: HTMLElement, tm: Tournament): boolean {
  const go = (tab: Tab) => {
    const want = `#/t/${tm.id}/${tab}`;
    if (location.hash !== want) location.hash = want; else route();
  };
  switch (act) {
    case 'sim-toggle':
      if (simOpen.has(tm.id)) simOpen.delete(tm.id); else simOpen.add(tm.id);
      route();
      return true;
    case 'sim-count':
      simCount = Number(el.dataset.v) || 16;
      route();
      return true;
    case 'sim-add': {
      const added = sim.addRandomPlayers(tm, simCount);
      persist();
      toast(`🎲 ${t('tsim.added', { n: added.length })}`);
      go('groups');
      return true;
    }
    case 'sim-distribute': {
      const moved = sim.distributeWaiting(tm);
      selectedChip = null;
      persist();
      toast(`🎲 ${t('tsim.distributed', { n: moved })}`);
      go('groups');
      return true;
    }
    case 'sim-start-groups':
      try { startGroups(tm); } catch (e) {
        toast(t((e as Error).message === 'waiting' ? 'tsim.errWaiting' : 'setup.errSmall'));
        return true;
      }
      persist();
      go('matches');
      return true;
    case 'sim-group-round': case 'sim-group-all': {
      let r = sim.simGroupRound(tm);
      if (act === 'sim-group-all') while (r !== null) r = sim.simGroupRound(tm);
      persist();
      if (sim.groupsReady(tm)) { toast(`✅ ${t('tsim.groupsDone')}`); go('groups'); } else go('matches');
      return true;
    }
    case 'sim-start-ko':
      sim.settleTies(tm);
      try { startKnockout(tm); } catch { toast(t('ko.notReady')); return true; }
      persist();
      go('knockout');
      return true;
    case 'sim-ko-round': case 'sim-ko-all': {
      let r = sim.simKoRound(tm);
      if (act === 'sim-ko-all') while (r) r = sim.simKoRound(tm);
      persist();
      if (sim.finished(tm)) { confetti(); toast(`🏆 ${t('tsim.finished')}`); }
      go('knockout');
      return true;
    }
  }
  return false;
}

function standingsTable(tm: Tournament, gi: number): string {
  const g = tm.groups[gi];
  const s = groupStandings(tm, g);
  const pts = recordsPoints(tm);
  // Filling players count in the table but cannot qualify from it: the next player takes their place.
  const qRank = new Map(qualifyingRows(tm, g).map((r) => [r.playerId, r.rank]));
  const rows = s.rows.map((r) => {
    const q = qRank.get(r.playerId);
    const extra = q === undefined;
    const cls = extra ? 'x' : q <= 2 ? 'q' : q <= 4 && tm.consolation.enabled ? 'c' : '';
    const pct = r.played ? Math.round((r.wins / r.played) * 100) : 0;
    const tb = r.tiebreak !== 'none' ? `<span class="badge ${r.tiebreak === 'unresolved' ? 'red' : 'blue'}" style="font-size:10px">${t(`tiebreak.${r.tiebreak}` as MessageKey)}</span>` : '';
    return `<tr class="${cls}">
      <td><span class="rank r${r.rank}">${n(r.rank)}</span></td>
      <td class="name"><div class="row" style="gap:6px;flex-wrap:nowrap">${pAvatar(tm, r.playerId)}<span dir="auto">${esc(playerName(tm, r.playerId))}</span> ${tb}${extra ? `<span class="badge extra-badge" style="font-size:10px" title="${esc(t('extra.badgeTitle'))}">🧩 ${t('extra.badge')}</span>` : ''}</div>
        <div class="winbar" title="${t('stats.winRate')} ${pct}%"><span style="width:${pct}%"></span></div></td>
      <td>${n(r.played)}</td><td>${n(r.wins)}</td><td>${n(r.losses)}</td>
      <td class="hide-sm">${pair(n(r.gamesWon), n(r.gamesLost), ':')}</td>
      ${pts ? `<td class="hide-sm">${pair(n(r.pointsWon), n(r.pointsLost), ':')}</td>` : ''}
      <td><b>${n(r.points)}</b></td>
    </tr>`;
  }).join('');
  const ties = s.unresolved.length ? tieResolver(tm, gi, s.unresolved) : '';
  return `
  <div class="card">
    <h3 class="row" style="gap:6px"><span class="gletter" style="background:${groupColor(gi)};display:inline-grid">${esc(g.name)}</span>${t('setup.group')} ${esc(g.name)} ${tableBadge(g)}</h3>
    <div class="table-wrap"><table class="standings">
      <thead><tr><th>${t('standings.rank')}</th><th class="name">${t('standings.player')}</th><th>${t('standings.played')}</th><th>${t('standings.won')}</th><th>${t('standings.lost')}</th>
      <th class="hide-sm">${t('standings.games')}</th>${pts ? `<th class="hide-sm">${t('standings.points')}</th>` : ''}<th>${t('standings.pts')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${ties}
  </div>`;
}

/** Organizer orders players the rules could not separate. */
const tieDrafts = new Map<string, string[]>();
function tieResolver(tm: Tournament, gi: number, groups: string[][]): string {
  const g = tm.groups[gi];
  if (!isOrg()) return `<div class="err">⏳ ${t('tie.waiting')}</div>`;
  return groups.map((ids, k) => {
    const key = `${g.id}:${k}`;
    const order = tieDrafts.get(key) ?? ids;
    tieDrafts.set(key, order);
    return `<div class="card" style="border-color:var(--warn);background:#fffaf0">
      <h3>⚖️ ${t('tie.title')}</h3>
      ${hint('tie.hint')}
      ${order.map((pid, i) => `<div class="chip ro">
        <span class="rank">${n(i + 1)}</span>${pAvatar(tm, pid)}<span dir="auto">${esc(playerName(tm, pid))}</span>
        <span style="margin-inline-start:auto" class="row">
          <button class="btn soft small" data-act="tie-move" data-key="${key}" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="↑">▲</button>
          <button class="btn soft small" data-act="tie-move" data-key="${key}" data-i="${i}" data-d="1" ${i === order.length - 1 ? 'disabled' : ''} aria-label="↓">▼</button>
        </span></div>`).join('')}
      <button class="btn gold block" data-act="tie-save" data-key="${key}" data-gid="${g.id}" style="margin-block-start:8px">✅ ${t('tie.save')}</button>
    </div>`;
  }).join('');
}

function groupsView(tm: Tournament): string {
  const legend = `<div class="legend"><span><i style="background:var(--ok)"></i>${t('standings.qualified')}</span>
    ${tm.consolation.enabled ? `<span><i style="background:var(--warn)"></i>${t('standings.consolation')} · ${esc(tm.consolation.name)}</span>` : ''}
    ${tm.groups.some((g) => g.extraIds?.length) ? `<span>🧩 ${t('extra.legend')}</span>` : ''}</div>`;
  const ready = groupsComplete(tm);
  const startKo = isOrg() && tm.stage === 'groups' ? `<div class="card">
    ${hint('ko.startHint')}
    <button class="btn green block" data-act="start-ko" ${ready ? '' : 'disabled'}>⚔️ ${t('ko.start')}</button>
    ${ready ? '' : `<p class="muted small center">${t('ko.notReady')}</p>`}
  </div>` : '';
  return `${isOrg() ? tablesCard(tm) : ''}${hint(recordsPoints(tm) ? 'standings.hint' : 'standings.hintGames')}${legend}
    ${tm.groups.map((_, i) => standingsTable(tm, i)).join('')}
    ${startKo}
    ${statsCard(tm)}`;
}

function statsCard(tm: Tournament): string {
  const wins = new Map<string, { w: number; p: number; gw: number }>();
  for (const m of Object.values(tm.matches)) {
    const s = summarize(m);
    if (!s.winner || !m.aId || !m.bId) continue;
    for (const [id, won, gw] of [[m.aId, s.winner === 'a', s.gamesA], [m.bId, s.winner === 'b', s.gamesB]] as const) {
      const e = wins.get(id) ?? { w: 0, p: 0, gw: 0 };
      e.p++; if (won) e.w++; e.gw += gw;
      wins.set(id, e);
    }
  }
  const top = [...wins.entries()].sort((a, b) => b[1].w - a[1].w || b[1].gw - a[1].gw).slice(0, 6);
  if (!top.length) return '';
  const max = Math.max(...top.map(([, e]) => e.w), 1);
  return `<div class="card"><h3>📊 ${t('stats.topPlayers')}</h3>
    ${top.map(([id, e]) => `<div class="hbar"><span dir="auto">${esc(playerName(tm, id))}</span>
      <span class="bar"><span style="width:${(e.w / max) * 100}%"></span></span><b>${n(e.w)}/${n(e.p)}</b></div>`).join('')}
  </div>`;
}

let matchFilter: 'all' | 'pending' | 'done' = 'all';

function matchCard(tm: Tournament, m: Match, label = ''): string {
  const s = summarize(m);
  const done = !!s.winner;
  const a = playerName(tm, m.aId), b = playerName(tm, m.bId);
  const table = m.stage === 'group' ? tableText(tm.groups.find((g) => g.id === m.groupId)?.table) : '';
  const meta = [label, table ? `🏓 ${table}` : '', bo(m.bestOf), m.walkover ? `🚩 ${t('matches.walkover')}` : '', m.history.length ? `✏️ ${n(m.history.length)}` : '']
    .filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('');
  return `<a class="match" href="#/t/${tm.id}/m/${m.id}">
    <span class="p ${s.winner === 'a' ? 'win' : ''}" dir="auto">${esc(a)}</span>
    <span class="sc ${done ? '' : 'pending'}">${done ? scoreText(m) : (canScore(tm) ? t('matches.enter') : t('matches.pending'))}</span>
    <span class="p b ${s.winner === 'b' ? 'win' : ''}" dir="auto">${esc(b)}</span>
    <span class="meta">${meta}${done && !m.walkover ? gamesList(m.games) : ''}</span>
  </a>`;
}

function matchesView(tm: Tournament): string {
  if (tm.stage === 'setup') return `<div class="card center muted">${t('matches.empty')}</div>`;
  const filters: [typeof matchFilter, MessageKey][] = [['all', 'matches.filterAll'], ['pending', 'matches.pending'], ['done', 'matches.done']];
  const keep = (m: Match) => matchFilter === 'all' || (matchFilter === 'done') === !!summarize(m).winner;
  const sections = tm.groups.map((g, i) => {
    const ms = groupMatches(tm, g.id).filter(keep);
    if (!ms.length) return '';
    const all = groupMatches(tm, g.id);
    const d = all.filter((m) => summarize(m).winner).length;
    const pct = Math.round((d / all.length) * 100);
    return `<div class="card">
      <div class="row between"><h3 class="row" style="gap:6px"><span class="gletter" style="background:${groupColor(i)};display:inline-grid">${esc(g.name)}</span>${t('setup.group')} ${esc(g.name)} ${tableBadge(g)}</h3>
        <span class="ring" style="--p:${pct}" data-label="${n(d)}/${n(all.length)}"></span></div>
      ${ms.map((m) => matchCard(tm, m)).join('')}
    </div>`;
  }).join('');
  return `<div class="choice" style="margin-block:8px">${filters.map(([k, l]) => `<button data-act="filter" data-v="${k}" aria-pressed="${matchFilter === k}">${t(l)}</button>`).join('')}</div>
    ${sections || `<div class="card center muted">${t('matches.empty')}</div>`}`;
}

function bracketView(tm: Tournament, b: Bracket): string {
  const total = b.rounds.length;
  const slot = (m: Match, side: 'a' | 'b') => {
    const id = side === 'a' ? m.aId : m.bId;
    const s = summarize(m);
    const win = s.winner === side;
    const bye = isBye(m, b);
    const sc = s.winner ? (side === 'a' ? s.gamesA : s.gamesB) : '';
    const label = id ? esc(playerName(tm, id)) : bye ? t('ko.bye') : t('ko.tbd');
    return `<div class="slot ${win ? 'win' : ''} ${id ? '' : 'empty'}"><span dir="auto">${label}</span><b>${sc}</b></div>`;
  };
  const card = (m: Match) => {
    const playable = m.aId && m.bId;
    const inner = `${slot(m, 'a')}${slot(m, 'b')}`;
    return playable ? `<a class="bmatch" href="#/t/${tm.id}/m/${m.id}">${inner}</a>` : `<div class="bmatch">${inner}</div>`;
  };
  const cols = b.rounds.map((ids, r) => `<div class="bround"><h4>${t(`ko.round.${roundName(r, total)}` as MessageKey)}</h4>
    ${ids.map((id) => card(tm.matches[id])).join('')}</div>`).join('');
  const third = b.thirdPlaceId ? `<div style="max-width:240px;margin-block-start:8px"><h4 class="muted small">🥉 ${t('ko.round.third')}</h4>${card(tm.matches[b.thirdPlaceId])}</div>` : '';
  const places = placements(b, tm.matches);
  const who = (p: number) => places.find((x) => x.place === p);
  const step = (p: 1 | 2 | 3) => {
    const x = who(p);
    const medal = ['🥇', '🥈', '🥉'][p - 1];
    return `<div class="step p${p}"><span class="medal">${medal}</span>${x ? `<div class="podium-photo">${pAvatar(tm, x.playerId)}</div>` : ''}<div class="nm" dir="auto">${x ? esc(playerName(tm, x.playerId)) : '…'}</div><div class="block">${n(p)}</div></div>`;
  };
  const podium = places.length ? `<h3 style="margin-block-start:14px">🏆 ${t('ko.podium')}</h3>
    <div class="podium">${step(2)}${step(1)}${step(3)}</div>
    ${who(4) ? `<p class="center muted">${t('place.4')}: <b dir="auto">${esc(playerName(tm, who(4)!.playerId))}</b></p>` : ''}` : '';
  return `<div class="card">
    <h2>${b.kind === 'main' ? '🏆 ' + t('ko.main') : '🥈 ' + esc(b.name)}</h2>
    ${hint('ko.hint')}
    <div class="bracket">${cols}</div>
    ${third}
    ${podium}
  </div>`;
}

function knockoutView(tm: Tournament): string {
  if (tm.stage !== 'knockout') return `<div class="card center muted">⏳ ${t('ko.notStarted')}</div>`;
  return tm.brackets.map((b) => bracketView(tm, b)).join('');
}

let deleteArmed = false;
/** Main photo of the tournament: shown on cards, in the home carousel and at the top of the tournament page. */
function coverCard(tm: Tournament): string {
  return `<div class="card cover-card"><h3>${icon('image', 20)} ${t('tl.cover')}</h3>${hint('tl.coverHint')}
    <div class="cover-edit">${cover(tm.cover ? esc(tm.cover) : null, tm.id, 'trophy', esc(tm.name))}</div>
    <div class="row">
      <label class="btn gold">${icon('image', 18)} ${t(tm.cover ? 'media.change' : 'tl.coverUpload')}<input type="file" accept="image/*" class="hidden" data-act="t-cover" data-tid="${tm.id}"></label>
      ${tm.cover ? `<button class="btn ghost" data-act="t-cover-del" data-tid="${tm.id}">${icon('trash', 16)} ${t('media.remove')}</button>` : ''}
    </div></div>`;
}

/** Organizer's choice: match result only (default) or points of every game. */
function scoringChoice(points: boolean, act: string): string {
  const opt = (v: boolean, icon: string, title: MessageKey, sub: MessageKey) =>
    `<button class="modeopt" data-act="${act}" data-v="${v ? 1 : 0}" aria-pressed="${points === v}">
      <span class="ic">${icon}</span><span><b>${t(title)}</b><small>${t(sub)}</small></span></button>`;
  return `<div class="modes">${opt(false, '⚡', 'scoring.result', 'scoring.resultSub')}${opt(true, '🔢', 'scoring.points', 'scoring.pointsSub')}</div>`;
}

function settingsView(tm: Tournament): string {
  if (!isOrg()) return '';
  const locked = tm.stage !== 'setup';
  const row = (k: keyof StageFormats) => `
    <div class="row between" style="margin-block:8px"><b>${t(`format.${k}` as MessageKey)}</b>
      <div class="choice">${([3, 5] as BestOf[]).map((b) => `<button data-act="set-format" data-k="${k}" data-v="${b}" aria-pressed="${tm.formats[k] === b}" ${locked ? 'disabled' : ''}>${bo(b)}</button>`).join('')}</div>
    </div>`;
  return `<div class="card">
    <h3>⚙️ ${t('settings.title')}</h3>
    <label class="field"><span>${t('wizard.name')}</span><input class="input" id="setName" value="${esc(tm.name)}"></label>
    <div class="row">
      <label class="field" style="flex:1"><span>📅 ${t('wizard.date')}</span><input class="input" id="setDate" type="date" value="${esc(tm.date)}"></label>
      <label class="field" style="flex:1"><span>⏰ ${t('tl.time')}</span><input class="input" id="setTime" type="time" value="${esc(tm.time ?? '')}"></label>
    </div>
    <label class="field"><span>📍 ${t('tl.location')}</span><input class="input" id="setLoc" dir="auto" maxlength="80" value="${esc(tm.location ?? '')}" placeholder="${esc(t('tl.locationPh'))}" list="placeList"></label>
    ${placeList()}
    <label class="field"><span>${t('wizard.consolationName')}</span><input class="input" id="setCons" value="${esc(tm.consolation.name)}"></label>
    <button class="btn small" data-act="set-save">💾 ${t('common.save')}</button>
  </div>
  ${online() ? coverCard(tm) : ''}
  <div class="card">
    <h3>🎯 ${t('wizard.formats')}</h3>
    ${locked ? `<p class="muted small">🔒 ${t('settings.formatsLocked')}</p>` : hint('wizard.formatsHint')}
    ${(['group', 'early', 'semi', 'final'] as const).map(row).join('')}
  </div>
  <div class="card">
    <h3>✍️ ${t('scoring.title')}</h3>
    ${hint('scoring.hint')}
    ${scoringChoice(recordsPoints(tm), 'set-scoring')}
  </div>
  ${online() ? assistantsCard(tm) : ''}
  <div class="card">
    <h3>📄 ${t('settings.duplicate')}</h3>
    ${hint('settings.duplicateHint')}
    <button class="btn soft" data-act="duplicate">📄 ${t('settings.duplicate')}</button>
  </div>
  <div class="card">
    <button class="btn red" data-act="delete">🗑️ ${deleteArmed ? t('settings.deleteConfirm') : t('settings.delete')}</button>
  </div>`;
}

/* ------------------------------------------------- media and assistants */

/** YouTube links play inside the page; other links open in a new tab. */
function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function mediaView(tm: Tournament): string {
  const items = tm.media ?? [];
  const org = isOrg();
  const item = (x: NonNullable<Tournament['media']>[number]) => {
    const yt = x.kind === 'video' ? youtubeId(x.url) : null;
    const view = x.kind === 'photo'
      ? `<a href="${esc(x.url)}" target="_blank" rel="noopener" class="ph photo"><img src="${esc(x.url)}" alt="${esc(x.caption)}" loading="lazy"></a>`
      : yt ? `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${yt}" title="${esc(x.caption || 'video')}" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`
      : `<a class="ph video-link" href="${esc(x.url)}" target="_blank" rel="noopener">${icon('eye', 40)}<span>${t('media.openVideo')}</span></a>`;
    return `<figure class="card media-item rise">${view}${x.caption ? `<figcaption dir="auto">${esc(x.caption)}</figcaption>` : ''}
      ${org ? `<button class="btn ghost small" data-act="media-del" data-id="${x.id}">${icon('trash', 14)} ${t('news.delete')}</button>` : ''}</figure>`;
  };
  return `${org ? `<div class="card"><h3>${icon('image', 20)} ${t('media.addTitle')}</h3>${hint('media.addHint')}
    <label class="field"><span>${t('media.caption')}</span><input class="input" id="mdCap" dir="auto" maxlength="140"></label>
    <div class="row">
      <label class="btn soft">${icon('image', 18)} ${t('media.addPhoto')}<input type="file" accept="image/*" class="hidden" data-act="media-photo"></label>
      <input class="input" id="mdUrl" dir="ltr" placeholder="https://youtube.com/…" style="flex:1;min-width:180px">
      <button class="btn" data-act="media-video">${icon('plus', 18)} ${t('media.addVideo')}</button>
    </div></div>` : ''}
  ${items.length ? `<div class="grid media-grid">${items.map(item).join('')}</div>` : empty('image', t('media.none'))}`;
}

let helpers: string[] | null = null;
let helpersFor = '';
let helperHits: content.PublicProfile[] = [];

function assistantsCard(tm: Tournament): string {
  if (helpersFor !== tm.id) {
    helpersFor = tm.id; helpers = null; helperHits = [];
    content.assistants(tm.id).then(async (h) => { helpers = h; await content.people(h); route(); }).catch(() => { helpers = []; route(); });
  }
  return `<div class="card"><h3>${icon('users', 20)} ${t('assist.title')}</h3>${hint('assist.hint')}
    ${helpers === null ? '<span class="spin"></span>' : helpers.length ? helpers.map((id) => `<div class="chip ro">${avatarOf(content.person(id))}<span dir="auto">${esc(content.personName(id))}</span>
      <button class="btn ghost small" style="margin-inline-start:auto" data-act="assist-del" data-id="${id}">${icon('x', 14)}</button></div>`).join('') : `<p class="muted small">${t('assist.none')}</p>`}
    <input class="input" id="assistQ" data-act="assist-q" placeholder="${esc(t('assist.search'))}" dir="auto" autocomplete="off" style="margin-block-start:8px">
    <div id="assistRes">${assistResults()}</div></div>`;
}

function assistResults(): string {
  return helperHits.filter((p) => !helpers?.includes(p.id)).map((p) => `<button class="chip" style="width:100%;cursor:pointer;touch-action:auto" data-act="assist-add" data-id="${p.id}">
    ${avatarOf(p)}<span dir="auto">${esc(p.full_name)}</span>${p.club ? `<span class="muted small" dir="auto">· ${esc(p.club)}</span>` : ''}
    <span class="badge green" style="margin-inline-start:auto">${icon('plus', 12)} ${t('assist.add')}</span></button>`).join('');
}

async function mediaAction(act: string, el: HTMLElement, tm: Tournament): Promise<void> {
  if (act === 'media-del') {
    tm.media = (tm.media ?? []).filter((x) => x.id !== el.dataset.id);
  } else if (act === 'media-video') {
    const url = val('mdUrl');
    if (!/^https?:\/\//.test(url)) { toast(t('media.badLink')); return; }
    tm.media = [...(tm.media ?? []), { id: uid(), kind: 'video', url, caption: val('mdCap') }];
  } else if (act === 'assist-add' || act === 'assist-del') {
    try {
      if (act === 'assist-add') { await content.addAssistant(tm.id, el.dataset.id!); helpers = [...(helpers ?? []), el.dataset.id!]; toast(t('assist.added')); }
      else { await content.removeAssistant(tm.id, el.dataset.id!); helpers = (helpers ?? []).filter((x) => x !== el.dataset.id); }
    } catch (e) { toast(authErr(e)); }
    route(); return;
  }
  persist(); route();
}

/* ------------------------------------------------------------ score entry */

/**
 * Two ways to enter a result, chosen per tournament by the organizer:
 *  - default: the match result in games only, one tap (e.g. 3-1);
 *  - optional: points of every game. Tap who won the game and type the
 *    loser's points; the winner's points are filled in (11, or +2 after 10-10).
 */
interface GameDraft { w: '' | 'a' | 'b'; lose: string }
interface ScoreDraft { matchId: string; result: GamesResult | null; games: GameDraft[]; error: string }
let sd: ScoreDraft | null = null;

/** Winner's points from the loser's points. */
const winPoints = (lose: number) => (lose >= 10 ? lose + 2 : GAME_POINTS);

function draftGame(g: GameDraft): Game | null {
  if (!g.w || g.lose === '') return null;
  const lose = Number(g.lose);
  const win = winPoints(lose);
  return g.w === 'a' ? { a: win, b: lose } : { a: lose, b: win };
}

/** Game rows to show: until the match is decided, at least the games needed to win. */
function shownGames(d: ScoreDraft, bestOf: BestOf): number {
  const need = gamesToWin(bestOf);
  let a = 0, b = 0, shown = 0;
  for (let i = 0; i < bestOf; i++) {
    if (a >= need || b >= need) break;
    shown = i + 1;
    const w = d.games[i].w;
    if (w === 'a') a++;
    else if (w === 'b') b++;
    else if (shown >= need) break;
  }
  return shown;
}

function liveGames(d: ScoreDraft, bestOf: BestOf): { a: number; b: number } {
  const rows = d.games.slice(0, shownGames(d, bestOf));
  return { a: rows.filter((g) => g.w === 'a').length, b: rows.filter((g) => g.w === 'b').length };
}

function errorText(c: MatchCheck): string {
  if (c.ok) return '';
  if (c.error === 'game') return t(`score.err.${c.reason}` as MessageKey, { n: c.index + 1 });
  return t(`score.err.${c.error}` as MessageKey);
}

function savedText(m: Match): string {
  if (m.walkover) return `🚩 ${t('matches.walkover')}`;
  return m.games.length ? gamesList(m.games) : '';
}

function scorePage(tm: Tournament, m: Match): string {
  const org = canScore(tm);
  const detailed = recordsPoints(tm);
  const a = playerName(tm, m.aId), b = playerName(tm, m.bId);
  const bracket = m.bracketId ? tm.brackets.find((x) => x.id === m.bracketId) : undefined;
  const locked = (m.stage === 'group' && tm.stage !== 'groups') || (bracket && !canEditKo(m, bracket, tm.matches));
  const where = m.stage === 'group'
    ? `${t('setup.group')} ${tm.groups.find((g) => g.id === m.groupId)?.name ?? ''}${(() => { const tb = tableText(tm.groups.find((g) => g.id === m.groupId)?.table); return tb ? ` · 🏓 ${tb}` : ''; })()}`
    : `${bracket?.kind === 'main' ? t('ko.main') : bracket?.name} · ${t(`ko.round.${roundName(m.round!, bracket!.rounds.length)}` as MessageKey)}`;
  const back = `<a class="btn soft small" href="#/t/${tm.id}/${m.stage === 'group' ? 'matches' : 'knockout'}">→ ${esc(tm.name)}</a>`;
  const saved = summarize(m);

  if (!sd || sd.matchId !== m.id) {
    const games: GameDraft[] = Array.from({ length: m.bestOf }, (_, i) => {
      const g = m.games[i];
      return g ? { w: g.a > g.b ? 'a' : 'b', lose: String(Math.min(g.a, g.b)) } : { w: '', lose: '' };
    });
    sd = { matchId: m.id, result: saved.winner && !m.walkover ? { a: saved.gamesA, b: saved.gamesB } : null, games, error: '' };
  }
  const live = detailed ? liveGames(sd, m.bestOf) : (sd.result ?? { a: 0, b: 0 });
  const board = (x: number, y: number) => `<div class="scoreboard">
    <div class="nm" dir="auto"><span class="paddle" style="background:var(--red)"></span>${esc(a)}</div>
    <div class="big">${pair(x, y)}</div>
    <div class="nm" dir="auto"><span class="paddle" style="background:var(--blue)"></span>${esc(b)}</div>
  </div>`;

  const history = m.history.length ? `<div class="card"><h3>🕓 ${t('score.history')}</h3>${hint('score.historyHint')}
    ${m.history.map((h) => `<div class="row small"><span class="muted">${dateTimeFmt.format(new Date(h.at))}</span>
      <span>${h.walkover ? `${t('matches.walkover')} (${h.walkover === 'a' ? esc(a) : esc(b)})` : h.games.length ? gamesList(h.games) : h.result ? pair(h.result.a, h.result.b) : ''}</span></div>`).join('')}
  </div>` : '';

  if (!org || locked) {
    return `<div class="row" style="margin-block-end:10px">${back}</div>
      <div class="card"><div class="muted small" style="margin-block-end:8px">${esc(where)} · ${bo(m.bestOf)}</div>${board(saved.gamesA, saved.gamesB)}
      ${savedText(m) ? `<p class="center">${savedText(m)}</p>` : ''}
      ${!org ? `<p class="muted small center">👀 ${t('score.readonly')}</p>` : `<div class="err">🔒 ${t(m.stage === 'ko' ? 'score.locked' : 'score.err.locked')}</div>`}
      </div>${history}`;
  }

  const need = gamesToWin(m.bestOf);
  let entry: string;
  if (!detailed) {
    // One tap per result: each player's column lists the ways they can win.
    const col = (side: 'a' | 'b', name: string, color: string) => `<div class="rescol">
      <div class="who" dir="auto"><span class="paddle" style="background:var(--${color})"></span>${esc(name)} ${t('score.wins')}</div>
      ${possibleResults(m.bestOf).map((lo) => {
        const r = side === 'a' ? { a: need, b: lo } : { a: lo, b: need };
        const on = sd!.result?.a === r.a && sd!.result?.b === r.b;
        return `<button class="resbtn ${color}" data-act="pick-result" data-a="${r.a}" data-b="${r.b}" aria-pressed="${on}">
          <b>${n(need)}</b><i>-</i><b>${n(lo)}</b></button>`;
      }).join('')}
    </div>`;
    entry = `${hint('score.resultHint')}
      <div class="results">${col('a', a, 'red')}${col('b', b, 'blue')}</div>`;
  } else {
    const shown = shownGames(sd, m.bestOf);
    const oldResult = !m.games.length && m.result ? `<p class="muted small center">${t('score.savedResult')} ${pair(m.result.a, m.result.b)}</p>` : '';
    const rows = sd.games.slice(0, shown).map((g, i) => {
      const game = draftGame(g);
      const cls = !g.w || g.lose === '' ? '' : game ? 'ok' : 'bad';
      const who = (side: 'a' | 'b', name: string, color: string) =>
        `<button class="gw ${color}" data-act="game-winner" data-i="${i}" data-s="${side}" aria-pressed="${g.w === side}" dir="auto">${esc(name)}</button>`;
      return `<div class="gamerow2 ${cls}">
        <span class="n">${t('score.game')} ${n(i + 1)}</span>
        <div class="gws">${who('a', a, 'red')}${who('b', b, 'blue')}</div>
        <label class="lose ${g.w ? '' : 'off'}"><span>${t('score.loserPts')}</span>
          <input inputmode="numeric" pattern="[0-9]*" maxlength="2" data-act="lose" data-i="${i}" value="${esc(g.lose)}" ${g.w ? '' : 'disabled'} placeholder="–"></label>
        <span class="gs">${game ? pair(game.a, game.b, ':') : ''}</span>
      </div>`;
    }).join('');
    entry = `${hint('score.pointsHint')}${oldResult}${rows}`;
  }

  return `<div class="row" style="margin-block-end:10px">${back}</div>
  <div class="card">
    <div class="row between"><h2>🎯 ${t('score.title')}</h2><span class="badge blue">${bo(m.bestOf)}</span></div>
    <div class="muted small" style="margin-block:4px 10px">${esc(where)}</div>
    ${board(live.a, live.b)}
    ${entry}
    ${sd.error ? `<div class="err" role="alert">${esc(sd.error)}</div>` : ''}
    <button class="btn green block" data-act="save-score" style="margin-block-start:12px" ${!detailed && !sd.result ? 'disabled' : ''}>💾 ${t('score.save')}</button>
  </div>
  <div class="card">
    <h3>🚩 ${t('score.walkover')}</h3>
    ${hint('score.walkoverHint')}
    <div class="row">
      <button class="btn soft" data-act="walkover" data-s="a" dir="auto">${esc(a)}</button>
      <button class="btn soft" data-act="walkover" data-s="b" dir="auto">${esc(b)}</button>
    </div>
  </div>
  ${isOrg() ? `<p class="muted small center">⚙️ ${t(detailed ? 'score.modePoints' : 'score.modeResult')} · <a href="#/t/${tm.id}/settings">${t('score.changeMode')}</a></p>` : ''}
  ${history}`;
}


/* ---------------------------------------------------------- online pages */

let authTab: 'login' | 'signup' = 'login';
let signupPhoto: string | null = null;
let authMsg = '';
let busy = false;
/** Typed values, kept across re-renders of the sign-in form. */
const authVals: Record<string, string> = {};

const RETURN_KEY = 'pingo.returnTo';

/** Where to go after signing in: the tournament the player came from, else home. */
function takeReturn(): string {
  try {
    const back = localStorage.getItem(RETURN_KEY);
    localStorage.removeItem(RETURN_KEY);
    if (back) return back;
  } catch { /* ignore */ }
  return '#/';
}

const authErr = (e: unknown) => t(`auth.err.${remote.errorCode(e)}` as MessageKey);

function loginPage(): string {
  if (session.profile) return `<div class="card center"><p>${t('auth.welcome', { name: esc(session.profile.full_name) })}</p><a class="btn" href="#/">${t('t.backHome')}</a></div>`;
  const signup = authTab === 'signup';
  const field = (id: string, label: MessageKey, type = 'text', extra = '') =>
    `<label class="field"><span>${t(label)}</span><input class="input" id="${id}" type="${type}" value="${esc(authVals[id] ?? '')}" ${extra}></label>`;
  return `<div class="card" style="max-width:480px;margin-inline:auto">
    <div class="choice" style="margin-block-end:12px">
      <button data-act="auth-tab" data-v="login" aria-pressed="${!signup}">🔑 ${t('auth.login')}</button>
      <button data-act="auth-tab" data-v="signup" aria-pressed="${signup}">👤 ${t('auth.signup')}</button>
    </div>
    ${hint('auth.hint')}
    <a class="faq-mini" href="#/faq/${signup ? 'signup' : 'organizer'}">${icon('help', 16)} ${t('faq.link')}</a>
    <a class="faq-mini" href="#/claim">🎟️ ${t('claim.menu')}</a>
    <form data-form="${signup ? 'signup' : 'login'}" novalidate>
      ${signup ? field('aName', 'auth.fullName', 'text', 'autocomplete="name" dir="auto" required') + `<p class="muted small" style="margin-block-start:-6px">${t('auth.fullNameHint')}</p>` : ''}
      ${signup ? field('aMobile', 'auth.mobile', 'tel', 'autocomplete="tel" inputmode="tel" dir="ltr" required placeholder="01001234567"') + `<p class="muted small" style="margin-block-start:-6px">${t('auth.mobileHint')}</p>`
        : field('aLogin', 'auth.loginId', 'text', 'autocomplete="username" inputmode="text" dir="ltr" required placeholder="01001234567"')}
      ${field('aPass', 'auth.password', 'password', `autocomplete="${signup ? 'new-password' : 'current-password'}" dir="ltr" required minlength="6"`)}
      ${signup ? `<p class="muted small" style="margin-block-start:-6px">${t('auth.passwordHint')}</p>
        <div class="row"><div style="flex:1">${field('aYear', 'auth.birthYear', 'text', 'inputmode="numeric" maxlength="4" dir="ltr"')}</div>
        <div style="flex:2">${field('aClub', 'auth.club', 'text', 'dir="auto"')}</div></div>
        <span class="lbl">${t('auth.gender')}</span>
        ${genderPick('aGender', authVals.aGender ?? '', authVals.aName || '?')}
        <p class="muted small" style="margin-block-start:4px">${t('auth.genderHint')}</p>
        <span class="lbl">${t('me.photo')}</span>
        <div class="row">${avatar(authVals.aName || '?', signupPhoto, authVals.aGender)}<label class="btn soft small">${icon('image', 16)} ${t(signupPhoto ? 'media.change' : 'media.choose')}<input type="file" accept="image/*" class="hidden" data-act="signup-photo"></label>
          <span class="muted small">${t('me.photoHint')}</span></div>
        <span class="lbl">${t('roles.wantAlso')}</span>
        <div class="toggles">${EXTRA.map((r) => `<label class="tog check-tog"><input type="checkbox" id="aWant-${r}" ${authVals[`aWant-${r}`] === '1' ? 'checked' : ''}> ${icon(ROLE_ICON[r], 16)} ${t(`roles.${r}` as MessageKey)}</label>`).join('')}</div>
        <p class="muted small">${t('roles.wantHint')}</p>` : ''}
      ${authMsg ? `<div class="${authMsg.startsWith('✅') ? 'hint' : 'err'}" role="alert">${esc(authMsg)}</div>` : ''}
      <button class="btn green block" type="submit" ${busy ? 'disabled' : ''}>${signup ? '🚀 ' + t('auth.submitSignup') : '🔑 ' + t('auth.submitLogin')}</button>
      ${signup ? '' : `<button class="btn ghost small block" type="button" data-act="forgot" style="margin-block-start:8px">${t('auth.forgot')}</button>`}
      ${!signup && forgotWa ? `<a class="btn small wa block" style="margin-block-start:8px" target="_blank" rel="noopener" href="https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(t('auth.forgotWa', { mobile: forgotWa }))}">${icon('whatsapp', 16)} ${t('claim.whatsapp')}</a>` : ''}
    </form>
  </div>`;
}

const val = (id: string) => ((document.getElementById(id) as HTMLInputElement | null)?.value ?? '').trim();

/** The male/female choice in a form (radio buttons named `name`), or '' when none is picked. */
const genderVal = (name: string) => (document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '');

/** Keep what the person typed in the sign-in form before it is drawn again. */
function keepAuthVals(withPassword = false): void {
  for (const id of ['aName', 'aLogin', 'aMobile', 'aYear', 'aClub', ...(withPassword ? ['aPass'] : [])]) if (document.getElementById(id)) authVals[id] = val(id);
  if (document.querySelector('input[name="aGender"]')) authVals.aGender = genderVal('aGender');
}

/** Two big cards with the default avatars: player (male) or player (female). */
function genderPick(name: string, current: string, fullName: string): string {
  return `<div class="gender-pick" role="radiogroup">${(['male', 'female'] as const).map((g) => `<label class="gender-opt">
    <input type="radio" name="${name}" value="${g}" ${current === g ? 'checked' : ''}>${avatar(fullName, null, g)}<b>${t(`auth.${g}` as MessageKey)}</b></label>`).join('')}</div>`;
}

async function submitAuth(kind: 'login' | 'signup'): Promise<void> {
  keepAuthVals(true);
  for (const r of ['organizer', 'seller', 'trainer']) { const c = document.getElementById(`aWant-${r}`) as HTMLInputElement | null; if (c) authVals[`aWant-${r}`] = c.checked ? '1' : ''; }
  const login = kind === 'login' ? val('aLogin') : val('aMobile'), password = val('aPass');
  if (!login || !password || (kind === 'signup' && !val('aName'))) { authMsg = t('auth.err.required'); route(); return; }
  if (!loginEmail(login) || (kind === 'signup' && !normalizeMobile(login))) { authMsg = t('auth.err.badMobile'); route(); return; }
  if (kind === 'signup' && password.length < 6) { authMsg = t('auth.err.weakPassword'); route(); return; }
  if (kind === 'signup' && !genderVal('aGender')) { authMsg = t('auth.err.gender'); route(); return; }
  busy = true; authMsg = ''; forgotWa = ''; route();
  try {
    if (kind === 'login') {
      await remote.signIn(login, password);
    } else {
      const year = val('aYear').replace(/[^\d]/g, '');
      const wants = EXTRA.filter((r) => (document.getElementById(`aWant-${r}`) as HTMLInputElement | null)?.checked).join(',');
      await remote.signUp({ mobile: login, password, full_name: val('aName'), birth_year: year, club: val('aClub'), gender: genderVal('aGender'), wants });
    }
    for (const k of Object.keys(authVals)) delete authVals[k];
    const back = takeReturn();
    // First sign-in with the starting password "pingo123": offer to choose a new one right away.
    const prof = await remote.myProfile().catch(() => null);
    if (prof?.must_change_password) { pwReturn = back; location.hash = '#/password'; }
    else location.hash = back;
  } catch (e) {
    authMsg = authErr(e);
  }
  busy = false;
  route();
}

/* Password: chosen at first sign-in (accounts made with "pingo123") and changeable anytime. */
let forgotWa = '';
let pwReturn = '#/';
let pwMsg = '';
let pwBusy = false;

function passwordForm(first: boolean): string {
  return `<form data-form="password" novalidate>
      <label class="field"><span>${t('pw.new')}</span><input class="input" id="pwNew" type="password" autocomplete="new-password" dir="ltr" minlength="6"></label>
      <label class="field"><span>${t('pw.again')}</span><input class="input" id="pwAgain" type="password" autocomplete="new-password" dir="ltr" minlength="6"></label>
      ${pwMsg ? `<div class="${pwMsg.startsWith('✅') ? 'hint' : 'err'}" role="alert">${esc(pwMsg)}</div>` : ''}
      <div class="row"><button class="btn green" type="submit" ${pwBusy ? 'disabled' : ''}>${pwBusy ? '<span class="spin"></span>' : icon('check')} ${t('pw.save')}</button>
      ${first ? `<button class="btn ghost" type="button" data-act="pw-later">${t('pw.later')}</button>` : ''}</div>
    </form>`;
}

/** #/password: the first-sign-in screen. */
function passwordPage(): string {
  const p = session.profile!;
  return `<div class="card pw-card pop" style="max-width:480px;margin-inline:auto">
    <div class="row">${avatarOf(p)}<h2 dir="auto">${esc(t('auth.welcome', { name: p.full_name }))}</h2></div>
    <h3>🔑 ${t(p.must_change_password ? 'pw.firstTitle' : 'pw.title')}</h3>
    ${p.must_change_password ? `<p>${t('pw.firstHint')}</p>` : hint('pw.hint')}
    ${passwordForm(true)}
  </div>`;
}

async function submitPassword(): Promise<void> {
  const a = val('pwNew'), b = val('pwAgain');
  if (a.length < 6) { pwMsg = t('auth.err.weakPassword'); route(); return; }
  if (a !== b) { pwMsg = t('auth.err.mismatch'); route(); return; }
  if (a === DEFAULT_PASSWORD) { pwMsg = t('auth.err.samePassword'); route(); return; }
  pwBusy = true; pwMsg = ''; route();
  try {
    await remote.changePassword(a);
    session.profile = await remote.myProfile();
    toast(`✅ ${t('pw.saved')}`);
    if (location.hash.startsWith('#/password')) { const back = pwReturn; pwReturn = '#/'; location.hash = back === '#/password' ? '#/' : back; }
  } catch (e) { pwMsg = authErr(e); }
  pwBusy = false;
  route();
}

/* The mobile number an account signs in with (on the profile page). */
let loginMobile: string | null | undefined;
let loginEdit = false;
function loginCard(): string {
  if (loginMobile === undefined) { loginMobile = null; remote.myLoginMobile().then((m) => { loginMobile = m; route(); }).catch(() => undefined); }
  return `<div class="card"><h3>📱 ${t('login.title')}</h3>
    <p>${loginMobile ? esc(t('login.mobileNow', { mobile: loginMobile })) : t('login.emailNow')}</p>
    ${loginEdit ? `<form data-form="login-mobile" class="row" novalidate>
        <input class="input" id="lmMobile" type="tel" inputmode="tel" dir="ltr" style="flex:1" placeholder="01001234567" value="${esc(loginMobile ?? session.profile?.phone ?? '')}">
        <button class="btn green small" type="submit">${t('common.save')}</button>
        <button class="btn ghost small" type="button" data-act="login-edit">${icon('x', 14)}</button></form>`
      : `<button class="btn soft small" data-act="login-edit">📱 ${t(loginMobile ? 'login.change' : 'login.set')}</button>`}
    <hr class="sep">
    <h3>🔑 ${t('pw.title')}</h3>${hint('pw.hint')}
    ${passwordForm(false)}
  </div>`;
}

const EXTRA: content.ExtraRole[] = ['organizer', 'seller', 'trainer'];
const ROLE_ICON: Record<content.ExtraRole, string> = { organizer: 'trophy', seller: 'shop', trainer: 'coach' };
const hasRole = (r: content.ExtraRole) => (r === 'organizer' ? canOrganize() : r === 'seller' ? isSeller() : isTrainer());

function rolesCard(): string {
  if (myRoleReqs === null) {
    myRoleReqs = [];
    content.myRoleRequests().then((r) => { myRoleReqs = r; }).catch(() => undefined).finally(route);
  }
  const req = (r: content.ExtraRole) => myRoleReqs?.find((x) => x.role === r);
  return `<div class="card"><h3>${icon('star', 20)} ${t('roles.title')}</h3>${hint('roles.hint')}
    <div class="roles">${EXTRA.map((r) => {
      const has = hasRole(r);
      const rq = req(r);
      const state = has ? `<span class="badge green">${icon('check', 14)} ${t('roles.active')}</span>`
        : rq?.status === 'pending' ? `<span class="badge gold">${icon('clock', 14)} ${t('roles.pending')}</span>`
        : `<button class="btn soft small" data-act="role-request" data-v="${r}">${icon('plus', 14)} ${t(rq?.status === 'rejected' ? 'roles.again' : 'roles.request')}</button>`;
      const link = has ? (r === 'organizer' ? '#/tournaments' : r === 'seller' ? '#/shop/manage' : '#/training/manage') : '';
      return `<div class="role-card ${has ? 'on' : ''}"><span class="role-ic">${icon(ROLE_ICON[r], 24)}</span>
        <div><b>${t(`roles.${r}` as MessageKey)}</b><br><small class="muted">${t(`roles.${r}Text` as MessageKey)}</small></div>
        <div class="role-state">${state}${link ? `<a class="btn small" href="${link}">${t('roles.open')}</a>` : ''}</div></div>`;
    }).join('')}</div></div>`;
}

function mePage(): string {
  const p = session.profile!;
  const reg = (r: remote.Registration) => {
    const tm = findT(r.tournament_id);
    return `<a class="match" href="#/t/${r.tournament_id}" style="grid-template-columns:1fr auto">
      <span class="p">${esc(tm?.name ?? '…')}</span><span class="badge ${r.status === 'approved' ? 'green' : r.status === 'pending' ? 'gold' : ''}">${t(`reg.status.${r.status}` as MessageKey)}</span></a>`;
  };
  const roleBadges = [isAdmin() ? `<span class="badge red">${icon('shield', 14)} ${t('role.admin')}</span>` : '',
    ...EXTRA.filter(hasRole).map((r) => `<span class="badge blue">${icon(ROLE_ICON[r], 14)} ${t(`roles.${r}` as MessageKey)}</span>`)].join('');
  return `<section class="banner b-me slim rise"><div class="row"><label class="me-photo" title="${esc(t('me.photo'))}">${avatarOf(p)}<span>${icon('image', 14)}</span><input type="file" accept="image/*" class="hidden" data-act="me-photo"></label><div><h1 dir="auto">${esc(p.full_name)}</h1>
    <div class="row" style="gap:6px">${roleBadges || `<span class="badge">${t('role.player')}</span>`}</div></div></div></section>
  ${training.myBookingsCard()}
  ${shop.myOrdersCard()}
  <div class="card"><h3>${icon('trophy', 20)} ${t('me.myTournaments')}</h3>
    ${myRegs.length ? myRegs.map(reg).join('') : `<p class="muted">${t('me.none')}</p>`}
  </div>
  ${rolesCard()}
  ${loginCard()}
  <div class="card">
    <h3>${icon('user', 20)} ${t('me.title')}</h3>
    <span class="lbl">${t('me.photo')}</span>
    <div class="row me-photo-row">${avatarOf(p)}
      <label class="btn soft small">${icon('image', 16)} ${t(p.avatar_url ? 'me.photoChange' : 'me.photoAdd')}<input type="file" accept="image/*" class="hidden" data-act="me-photo"></label>
      ${p.avatar_url ? `<button class="btn ghost small" type="button" data-act="me-photo-rm">${icon('x', 14)} ${t('me.photoRemove')}</button>` : ''}
      <span class="muted small">${t(p.avatar_url ? 'me.photoHint' : 'me.photoDefault')}</span></div>
    <form data-form="me" novalidate>
      <span class="lbl">${t('auth.gender')}</span>
      ${genderPick('mGender', p.gender ?? '', p.full_name)}
      <label class="field"><span>${t('auth.fullName')}</span><input class="input" id="mName" value="${esc(p.full_name)}" dir="auto"></label>
      <label class="field"><span>${t('auth.phone')}</span><input class="input" id="mPhone" type="tel" value="${esc(p.phone ?? '')}" dir="ltr"></label>
      <div class="row"><label class="field" style="flex:1"><span>${t('auth.birthYear')}</span><input class="input" id="mYear" inputmode="numeric" value="${p.birth_year ?? ''}" dir="ltr"></label>
      <label class="field" style="flex:2"><span>${t('auth.club')}</span><input class="input" id="mClub" value="${esc(p.club ?? '')}" dir="auto"></label></div>
      ${isTrainer() || isSeller() ? `<label class="field"><span>${t('me.bio')}</span><textarea class="input" id="mBio" dir="auto" style="min-height:90px" maxlength="600" placeholder="${esc(t('me.bioPh'))}">${esc(p.bio ?? '')}</textarea></label>` : ''}
      <button class="btn green" type="submit">${icon('check')} ${t('me.save')}</button>
    </form>
  </div>
  <div class="row">
    ${canOrganize() ? `<a class="btn soft" href="#/players">${icon('users')} ${t('dir.link')}</a><a class="btn soft" href="#/admin">${icon('shield')} ${t('users.link')}</a>` : ''}
    <button class="btn ghost" data-act="logout">${icon('logout')} ${t('auth.logout')}</button>
  </div>`;
}

async function roleAction(act: string, el: HTMLElement): Promise<void> {
  try {
    if (act === 'role-request') {
      await content.requestRole(el.dataset.v as content.ExtraRole);
      toast(`📨 ${t('roles.sent')}`);
      myRoleReqs = null;
    } else if (act === 'role-decide') {
      await content.decideRoleRequest(el.dataset.id!, el.dataset.v === 'yes');
      toast(t('admin.saved'));
      roleReqs = null; people = null;
    }
  } catch (e) { toast(authErr(e)); }
  route();
}

let roleReqs: content.RoleRequest[] | null = null;

let people: remote.Profile[] | null = null;
let pendingUsers: remote.PendingUser[] | null = null;
let pendingError = '';

function loadUsers(): void {
  remote.listProfiles().then((p) => { people = p; route(); }).catch((e) => toast(authErr(e)));
  remote.unconfirmedUsers()
    .then((u) => { pendingUsers = u; pendingError = ''; })
    .catch((e) => { pendingUsers = []; pendingError = remote.errorCode(e) === 'noFunction' ? t('users.functionMissing') : authErr(e); })
    .finally(route);
}

/* Admin: edit another account's details and the mobile it signs in with. */
let editingUser: string | null = null;
function userEditForm(p: remote.Profile): string {
  return `<form data-form="user-edit" data-id="${p.id}" class="user-edit" style="flex-basis:100%" novalidate>
    <div class="row"><label class="field" style="flex:2"><span>${t('auth.fullName')}</span><input class="input" id="ueName" dir="auto" value="${esc(p.full_name)}"></label>
      <label class="field" style="flex:2"><span>${t('auth.mobile')}</span><input class="input" id="ueMobile" type="tel" dir="ltr" value="${esc(p.phone ?? '')}"></label></div>
    <div class="row"><label class="field" style="flex:2"><span>${t('auth.club')}</span><input class="input" id="ueClub" dir="auto" value="${esc(p.club ?? '')}"></label>
      <label class="field" style="flex:1"><span>${t('auth.birthYear')}</span><input class="input" id="ueYear" inputmode="numeric" dir="ltr" value="${p.birth_year ?? ''}"></label></div>
    ${genderPick('ueGender', p.gender ?? '', p.full_name)}
    <div class="row"><button class="btn green small" type="submit">${icon('check', 14)} ${t('common.save')}</button>
      <button class="btn ghost small" type="button" data-act="user-edit" data-id="${p.id}">${t('common.cancel')}</button></div>
  </form>`;
}

async function saveUserEdit(): Promise<void> {
  const p = people?.find((x) => x.id === editingUser);
  if (!p) return;
  const year = Number(val('ueYear').replace(/[^\d]/g, ''));
  const raw = val('ueMobile');
  const mobile = raw ? normalizeMobile(raw) : null;
  if (raw && !mobile) { toast(t('auth.err.badMobile')); return; }
  try {
    await remote.updateProfile(p.id, {
      full_name: val('ueName') || p.full_name, club: val('ueClub') || null,
      birth_year: year >= 1920 ? year : null,
      ...(genderVal('ueGender') ? { gender: genderVal('ueGender') as remote.Gender } : {}),
    });
    // A new mobile also becomes the account's username.
    if (mobile && mobile !== normalizeMobile(p.phone ?? '')) await remote.setMobile(mobile, p.id);
    toast(`✅ ${t('users.saved')}`);
    editingUser = null; people = null; dir = null;
  } catch (e) { toast(authErr(e)); }
  route();
}

function usersPage(): string {
  if (!people) { loadUsers(); return `<div class="card center muted">⏳ ${t('reg.loading')}</div>`; }
  if (isAdmin() && roleReqs === null) {
    roleReqs = [];
    content.pendingRoleRequests().then((r) => { roleReqs = r; }).catch(() => undefined).finally(route);
  }
  const nameOf = (id: string) => people?.find((p) => p.id === id)?.full_name ?? '…';
  const requests = !location.hash.startsWith('#/admin/users') && isAdmin() && roleReqs?.length ? `<div class="card"><h2>${icon('star', 22)} ${t('roles.requests')}</h2>${hint('roles.requestsHint')}
    ${roleReqs.map((r) => `<div class="chip ro">${avatarOf(people?.find((p) => p.id === r.user_id), nameOf(r.user_id))}<span><b dir="auto">${esc(nameOf(r.user_id))}</b><br>
      <span class="badge blue">${icon(ROLE_ICON[r.role], 14)} ${t(`roles.${r.role}` as MessageKey)}</span>${r.note ? ` <span class="muted small" dir="auto">${esc(r.note)}</span>` : ''}</span>
      <span class="row" style="margin-inline-start:auto;gap:6px"><button class="btn green small" data-act="role-decide" data-id="${r.id}" data-v="yes">${icon('check', 14)} ${t('roles.approve')}</button>
      <button class="btn ghost small" data-act="role-decide" data-id="${r.id}" data-v="no">${icon('x', 14)}</button></span></div>`).join('')}</div>` : '';
  const flags: [string, MessageKey, (p: remote.Profile) => boolean][] = [
    ['is_organizer', 'roles.organizer', (p) => p.role === 'organizer' || !!p.is_organizer],
    ['is_seller', 'roles.seller', (p) => !!p.is_seller],
    ['is_trainer', 'roles.trainer', (p) => !!p.is_trainer],
    ['admin', 'role.admin', (p) => p.role === 'admin'],
  ];
  const pending = pendingUsers === null
    ? `<p class="muted">⏳ ${t('reg.loading')}</p>`
    : pendingError ? `<div class="err">${esc(pendingError)}</div>`
    : pendingUsers.length ? pendingUsers.map((u) => `<div class="chip ro">${avatar(u.full_name || u.email)}
        <span><span dir="auto">${esc(u.full_name)}</span><br><span class="muted small" dir="ltr">${esc(u.email)}</span></span>
        <button class="btn green small" style="margin-inline-start:auto" data-act="confirm-user" data-id="${u.id}">✅ ${t('users.confirm')}</button></div>`).join('')
    : `<p class="muted">${t('users.noPending')}</p>`;
  const f = (id: string, label: MessageKey, type = 'text', extra = '') =>
    `<label class="field"><span>${t(label)}</span><input class="input" id="${id}" type="${type}" ${extra}></label>`;
  return `${requests}<div class="card"><h2>📨 ${t('users.pending')}</h2>${hint('users.pendingHint')}${pending}</div>
  <div class="card"><h2>➕ ${t('users.create')}</h2>${hint('users.createHint')}
    <form data-form="create-account" novalidate>
      ${f('cName', 'auth.fullName', 'text', 'dir="auto"')}
      <div class="row"><div style="flex:1">${f('cMobile', 'auth.mobile', 'tel', 'dir="ltr" inputmode="tel" placeholder="01001234567"')}</div><div style="flex:1">${f('cClub', 'auth.club', 'text', 'dir="auto"')}</div></div>
      ${f('cPass', 'users.passwordOptional', 'text', `dir="ltr" autocomplete="off" placeholder="${DEFAULT_PASSWORD}"`)}
      ${isAdmin() ? `<span class="lbl">${t('roles.give')}</span><div class="toggles">${EXTRA.map((r) => `<label class="tog check-tog"><input type="checkbox" id="cRole-${r}"> ${icon(ROLE_ICON[r], 16)} ${t(`roles.${r}` as MessageKey)}</label>`).join('')}</div>` : ''}
      <button class="btn green" type="submit" ${busy ? 'disabled' : ''}>➕ ${t('users.create')}</button>
    </form>
  </div>
  <div class="card"><h2>🛡️ ${t('users.all')}</h2>${hint('admin.hint')}
    ${people.map((p) => `<div class="chip ro user-row">${avatarOf(p)}<span><span dir="auto">${esc(p.full_name)}</span>
      ${p.phone ? `<br><span class="muted small" dir="ltr">📱 ${esc(p.phone)}</span>` : ''}
      ${p.must_change_password ? ` <span class="badge gold">${t('users.mustChange')}</span>` : ''}</span>
      ${isAdmin() ? `<span class="row" style="gap:4px"><button class="btn soft small" data-act="user-edit" data-id="${p.id}">✏️ ${t('users.edit')}</button>
        ${p.id === session.profile?.id ? '' : `<button class="btn ghost small" data-act="user-reset" data-id="${p.id}">🔑 ${t('users.reset')}</button>`}</span>` : ''}
      ${editingUser === p.id ? userEditForm(p) : ''}
      <span class="flags">${flags.map(([flag, label, on]) => isAdmin()
        ? `<label class="flag ${on(p) ? 'on' : ''}"><input type="checkbox" data-act="role-flag" data-id="${p.id}" data-flag="${flag}" ${on(p) ? 'checked' : ''} ${p.id === session.profile?.id && flag === 'admin' ? 'disabled' : ''}> ${t(label)}</label>`
        : on(p) ? `<span class="badge">${t(label)}</span>` : '').join('')}</span></div>`).join('')}
  </div>`;
}

/* Player directory */
let dir: remote.DirPlayer[] | null = null;
let dirLoading = false;
let dirFilter = '';

function loadDir(): void {
  if (dirLoading) return;
  dirLoading = true;
  remote.listPlayers().then(async (d) => { dir = d; await content.people(d.flatMap((x) => (x.profile_id ? [x.profile_id] : []))).catch(() => undefined); }).catch((e) => { dir = []; toast(authErr(e)); }).finally(() => { dirLoading = false; route(); });
}

function dirResults(query: string, exclude: Set<string>): string {
  if (!dir) return '';
  const q = query.trim();
  if (!q) return '';
  const hits = searchDirectory(dir, q);
  const exact = exactDirectoryMatch(dir, q);
  return `${hits.map((d) => {
    const inT = exclude.has(d.id);
    return `<button type="button" class="chip" style="width:100%;cursor:pointer;touch-action:auto" data-act="dir-pick" data-id="${d.id}" ${inT ? 'disabled' : ''}>
      ${avatar(d.full_name, content.photoOf(d.profile_id ?? undefined), content.genderOf(d.profile_id ?? undefined))}<span dir="auto">${esc(d.full_name)}</span>${d.club ? `<span class="muted small" dir="auto">· ${esc(d.club)}</span>` : ''}
      <span class="badge ${d.profile_id ? 'green' : ''}" style="margin-inline-start:auto">${inT ? t('dir.inTournament') : d.profile_id ? t('dir.account') : t('dir.noAccount')}</span></button>`;
  }).join('')}
  ${hits.length ? '' : `<p class="muted small">${t('dir.none')}</p>`}
  ${exact ? '' : `<div class="row dir-new"><input class="input" id="dirNewMobile" type="tel" inputmode="tel" dir="ltr" style="flex:1;min-width:150px" placeholder="${esc(t('dir.mobileFor', { name: q }))}">
    <button type="button" class="btn soft small" data-act="dir-new" data-name="${esc(q)}">➕ ${esc(t('dir.addNew', { name: q }))}</button></div>`}`;
}

/** Search box + live results; `exclude` = directory ids already chosen. */
function dirPicker(exclude: Set<string>, title: MessageKey): string {
  if (!dir) { loadDir(); return `<p class="muted small">⏳ ${t('reg.loading')}</p>`; }
  return `<div class="card" style="background:#f7f9fd">
    <h3>🔎 ${t(title)}</h3>${hint('dir.pickHint')}
    <input class="input" id="dirQ" data-act="dir-q" placeholder="${esc(t('dir.search'))}" autocomplete="off" dir="auto">
    <div id="dirRes" class="stack" style="margin-block-start:8px">${dirResults('', exclude)}</div>
  </div>`;
}

let linking: string | null = null;
/** Directory player (without an account) getting a mobile number and an account. */
let mobileFor: string | null = null;
/** Players with a claim code shown on the players page, for "print all". */
let printable: claim.PrintItem[] = [];
function playersPage(): string {
  if (!dir) { loadDir(); return `<div class="card center muted">⏳ ${t('reg.loading')}</div>`; }
  if (linking && !people) { remote.listProfiles().then((p) => { people = p; route(); }).catch((e) => toast(authErr(e))); }
  const linkedProfiles = new Set(dir.filter((d) => d.profile_id).map((d) => d.profile_id));
  const shown = dirFilter ? searchDirectory(dir, dirFilter, 500) : dir;
  // Claim codes and temporary accounts are handled by the admin only.
  const adm = isAdmin();
  const temps = adm ? claim.tempCodes() : new Map<string, string | null>();
  const codeOf = (d: remote.DirPlayer): [string, string] | null => {
    if (!adm) return null;
    if (d.profile_id && temps.get(d.profile_id)) return [temps.get(d.profile_id)!, d.profile_id];
    if (!d.profile_id && d.claim_code) return [d.claim_code, d.id];
    return null;
  };
  const row = (d: remote.DirPlayer) => `<div class="chip ro" style="flex-wrap:wrap">${avatar(d.full_name, content.photoOf(d.profile_id ?? undefined), content.genderOf(d.profile_id ?? undefined))}
    <span><b dir="auto">${esc(d.full_name)}</b>${d.club ? ` <span class="muted small" dir="auto">· ${esc(d.club)}</span>` : ''}
    ${d.phone ? `<br><span class="muted small" dir="ltr">${esc(d.phone)}</span>` : ''}</span>
    <span class="row" style="margin-inline-start:auto;gap:6px">
      ${d.profile_id && temps.has(d.profile_id) ? `<span class="badge gold">${t('batch.temp')}</span>`
        : `<span class="badge ${d.profile_id ? 'green' : ''}">${d.profile_id ? t('dir.account') : t('dir.noAccount')}</span>`}
      ${d.profile_id ? '' : `<button class="btn soft small" data-act="link-open" data-id="${d.id}">🔗 ${t('dir.linkTo')}</button>`}
      ${d.profile_id ? '' : `<button class="btn soft small" data-act="dir-mobile" data-id="${d.id}">📱 ${t('dir.giveMobile')}</button>`}
    </span>
    ${codeOf(d) ? `<div style="flex-basis:100%;display:flex">${claim.codeTools(d.full_name, codeOf(d)![0], codeOf(d)![1])}</div>` : ''}
    ${mobileFor === d.id ? `<div class="row" style="flex-basis:100%"><input class="input" id="dmMobile" type="tel" inputmode="tel" dir="ltr" style="flex:1" placeholder="${esc(t('dir.mobileFor', { name: d.full_name }))}">
      <button class="btn green small" data-act="dir-mobile-save" data-id="${d.id}">${t('common.save')}</button></div>` : ''}
    ${linking === d.id ? `<div style="flex-basis:100%">${hint('dir.linkHint')}
      ${people ? `<div class="row"><select class="input" id="linkSel" style="flex:1"><option value="">${t('dir.choose')}</option>
        ${people.filter((p) => !linkedProfiles.has(p.id)).map((p) => `<option value="${p.id}">${esc(p.full_name)}${p.phone ? ' · ' + esc(p.phone) : ''}</option>`).join('')}
      </select><button class="btn green small" data-act="link-save" data-id="${d.id}">${t('common.save')}</button></div>` : '⏳'}</div>` : ''}
  </div>`;
  const coded = dir.filter((d) => codeOf(d));
  printable = coded.map((d) => ({ full_name: d.full_name, claim_code: codeOf(d)![0], club: d.club }));
  return `${adm ? claim.batchCard() : ''}
  <div class="card"><h2>👥 ${t('dir.title')}</h2>${hint('dir.hint')}
    ${coded.length ? `<button type="button" class="btn soft small" data-act="dir-print" style="margin-block-end:8px">🖨️ ${t('batch.printAll')} (${n(coded.length)})</button>` : ''}
    <input class="input" id="dirFilter" data-act="dir-filter" placeholder="${esc(t('dir.search'))}" value="${esc(dirFilter)}" dir="auto">
    <div style="margin-block-start:8px">${shown.length ? shown.map(row).join('') : `<p class="muted">${t('dir.empty')}</p>`}</div>
  </div>
  <div class="card"><h2>➕ ${t('dir.add')}</h2>${hint('dir.addHint')}
    <form data-form="add-player" novalidate>
      <label class="field"><span>${t('auth.fullName')}</span><input class="input" id="pName" dir="auto"></label>
      <div class="row">
        <label class="field" style="flex:1"><span>${t('auth.mobile')}</span><input class="input" id="pPhone" type="tel" inputmode="tel" dir="ltr" placeholder="01001234567"></label>
        <label class="field" style="flex:1"><span>${t('auth.club')}</span><input class="input" id="pClub" dir="auto"></label>
        <label class="field" style="flex:1"><span>${t('auth.birthYear')}</span><input class="input" id="pYear" inputmode="numeric" dir="ltr"></label>
      </div>
      <button class="btn green" type="submit">➕ ${t('dir.add')}</button>
    </form>
  </div>`;
}

/* Registration tab */
const regCache = new Map<string, remote.Registration[]>();
const regLoading = new Set<string>();

function loadRegs(id: string): void {
  if (regLoading.has(id)) return;
  regLoading.add(id);
  remote.tournamentRegistrations(id)
    .then(async (r) => { regCache.set(id, r); await content.people(r.map((x) => x.player_id)).catch(() => undefined); })
    .catch(() => regCache.set(id, []))
    .finally(() => { regLoading.delete(id); route(); });
}

function registerView(tm: Tournament): string {
  const reg = registrationOf(tm);
  const regs = regCache.get(tm.id);
  if (!regs) { loadRegs(tm.id); return `<div class="card center muted">⏳ ${t('reg.loading')}</div>`; }
  const approved = regs.filter((r) => r.status === 'approved');
  const pending = regs.filter((r) => r.status === 'pending');
  const others = regs.filter((r) => r.status === 'rejected' || r.status === 'withdrawn');
  const countText = reg.maxPlayers ? t('reg.count', { n: approved.length, max: reg.maxPlayers }) : n(approved.length);
  const person = (r: remote.Registration, actions = '') => `<div class="chip ro">${avatar(r.full_name ?? '?', content.photoOf(r.player_id), content.genderOf(r.player_id))}<span dir="auto">${esc(r.full_name ?? '')}</span>
    ${r.club ? `<span class="muted small" dir="auto">· ${esc(r.club)}</span>` : ''}<span class="row" style="margin-inline-start:auto;gap:6px">${actions}</span></div>`;
  const status = `<div class="row between"><h2>📝 ${t('reg.title')}</h2>
    <span class="badge ${reg.open ? 'gold' : ''}">${reg.open ? t('reg.open') : t('reg.closed')}</span></div>
    ${reg.maxPlayers ? `${xp(approved.length, reg.maxPlayers)}<p class="small muted">${countText}</p>` : ''}`;

  if (!isOrg()) {
    const mine = session.profile ? regs.find((r) => r.player_id === session.profile!.id) : undefined;
    let action = '';
    if (!session.profile) action = reg.open ? `<a class="btn gold block" href="#/login">👤 ${t('auth.needLogin')}</a>` : '';
    else if (mine && (mine.status === 'pending' || mine.status === 'approved')) {
      action = `<div class="hint" style="background:${mine.status === 'approved' ? '#eafbe3' : ''}">${t(`reg.status.${mine.status}` as MessageKey)}</div>
        ${reg.open ? `<button class="btn ghost small" data-act="withdraw">${t('reg.withdraw')}</button>` : ''}`;
    } else if (mine?.status === 'rejected') action = `<div class="err">${t('reg.status.rejected')}</div>`;
    else if (reg.open) action = `<button class="btn green block" data-act="join" ${busy ? 'disabled' : ''}>🏓 ${t('reg.join')}</button>`;
    return `<div class="card">${status}${action}
        <a class="faq-mini" href="#/faq/${mine && (mine.status === 'pending' || mine.status === 'approved') ? 'withdraw' : 'join'}">${icon('help', 16)} ${t(mine && (mine.status === 'pending' || mine.status === 'approved') ? 'faq.withdraw.q' : 'faq.join.q')}</a></div>
      <div class="card"><h3>✅ ${t('reg.approved')} (${countText})</h3>
        ${approved.length ? approved.map((r) => person(r)).join('') : `<p class="muted">${t('reg.empty')}</p>`}</div>`;
  }

  const decide = (r: remote.Registration, opts: ('approved' | 'rejected' | 'pending')[]) => opts.map((s) =>
    `<button class="btn ${s === 'approved' ? 'green' : s === 'rejected' ? 'red' : 'soft'} small" data-act="decide" data-id="${r.id}" data-s="${s}">${t(s === 'approved' ? 'reg.approve' : s === 'rejected' ? 'reg.reject' : 'reg.undo')}</button>`).join('');
  return `<div class="card">${status}
    ${reg.open ? hint('reg.shareHint') + `<button class="btn soft small" data-act="copy-link">🔗 ${t('reg.copyLink')}</button>` : ''}
    <label class="row" style="margin-block-start:10px"><input type="checkbox" data-act="reg-auto" ${reg.autoAccept ? 'checked' : ''}> ${t('reg.autoAccept')}</label>
    ${hint('reg.autoAcceptHint')}
    <label class="field"><span>${t('reg.maxPlayers')}</span>
      <input class="input" id="rMax" inputmode="numeric" value="${reg.maxPlayers ?? ''}" style="max-width:160px" data-act="reg-max"></label>
    <div style="margin-block-start:12px">
      ${reg.open
        ? `${hint('reg.closeHint')}<button class="btn gold block" data-act="reg-close">🔒 ${t('reg.closeBtn')}</button>`
        : `<button class="btn green block" data-act="reg-open">📝 ${t('reg.openBtn')}</button>`}
    </div>
  </div>
  ${pending.length ? `<div class="card" style="border-color:var(--warn)"><h3>⏳ ${t('reg.pending')} (${n(pending.length)})</h3>
    ${pending.map((r) => person(r, decide(r, ['approved', 'rejected']))).join('')}</div>` : ''}
  <div class="card"><h3>✅ ${t('reg.approved')} (${countText})</h3>
    ${approved.length ? approved.map((r) => person(r, decide(r, ['pending']))).join('') : `<p class="muted">${t('reg.empty')}</p>`}</div>
  ${others.length ? `<div class="card"><h3>${t('reg.others')}</h3>
    ${others.map((r) => person(r, `<span class="badge">${t(`reg.status.${r.status}` as MessageKey)}</span>${r.status === 'rejected' ? decide(r, ['approved']) : ''}`)).join('')}</div>` : ''}`;
}

/** Actions that talk to Supabase. Returns true when handled. */
async function onlineAction(act: string, el: HTMLElement, tm?: Tournament): Promise<boolean> {
  switch (act) {
    case 'me-photo-rm':
      if (!session.profile) return true;
      try {
        await remote.updateProfile(session.profile.id, { avatar_url: null });
        session.profile.avatar_url = null;
        try { localStorage.removeItem(PHOTO_KEY); } catch { /* ignore */ }
        toast(t('me.photoRemoved'));
      } catch (e) { toast(authErr(e)); }
      route(); return true;
    case 'auth-tab':
      keepAuthVals();
      authTab = el.dataset.v as typeof authTab; authMsg = ''; route(); return true;
    case 'forgot': {
      keepAuthVals();
      const id = val('aLogin');
      forgotWa = '';
      // Mobile accounts have no mailbox: the admin puts the password back to "pingo123".
      if (!id.includes('@')) { authMsg = '✅ ' + t('auth.forgotMobile'); forgotWa = normalizeMobile(id) ?? id; route(); return true; }
      try { await remote.resetPassword(id); authMsg = '✅ ' + t('auth.resetSent'); } catch (e) { authMsg = authErr(e); }
      route(); return true;
    }
    case 'pw-later':
      location.hash = pwReturn === '#/password' ? '#/' : pwReturn; pwReturn = '#/'; pwMsg = '';
      return true;
    case 'login-edit':
      loginEdit = !loginEdit; route(); return true;
    case 'user-edit':
      editingUser = editingUser === el.dataset.id ? null : el.dataset.id!; route(); return true;
    case 'user-reset': {
      if (el.dataset.armed !== '1') { el.dataset.armed = '1'; el.textContent = `🔑 ${t('users.resetConfirm')}`; return true; }
      try { await remote.resetToDefaultPassword(el.dataset.id!); toast(`✅ ${t('users.resetDone')}`); people = null; } catch (e) { toast(authErr(e)); }
      route(); return true;
    }
    case 'dir-mobile':
      mobileFor = mobileFor === el.dataset.id ? null : el.dataset.id!; route(); return true;
    case 'dir-mobile-save': {
      const d = dir?.find((x) => x.id === el.dataset.id);
      const m = normalizeMobile(val('dmMobile'));
      if (!d) return true;
      if (!m) { toast(t('auth.err.badMobile')); return true; }
      try {
        const r = (await remote.addPlayers([{ full_name: d.full_name, mobile: m, directory_id: d.id }])).rows[0];
        if (r?.kind === 'new') toast(`✅ ${t('dir.added')}`);
        else toast(authErr(new Error(r?.kind === 'account' ? 'mobile already registered' : r?.error ?? 'unknown')));
        mobileFor = null; dir = null;
      } catch (e) { toast(authErr(e)); }
      route(); return true;
    }
    case 'logout':
      loginMobile = undefined; loginEdit = false;
      await remote.signOut();
      location.hash = '#/';
      return true;
    case 'join': case 'withdraw': {
      if (!tm) return true;
      busy = true; route();
      try {
        if (act === 'join') {
          const st = await remote.joinTournament(tm.id);
          toast(st === 'approved' ? `✅ ${t('reg.joinedApproved')}` : `📨 ${t('reg.joined')}`);
        } else {
          await remote.withdraw(tm.id);
          toast(t('reg.withdrawn'));
        }
        myRegs = await remote.myRegistrations();
      } catch (e) { toast(authErr(e)); }
      busy = false;
      regCache.delete(tm.id);
      route(); return true;
    }
    case 'decide': {
      if (!tm) return true;
      try { await remote.decide(el.dataset.id!, el.dataset.s as 'approved'); } catch (e) { toast(authErr(e)); }
      regCache.delete(tm.id); route(); return true;
    }
    case 'reg-open': case 'reg-close': {
      if (!tm) return true;
      if (act === 'reg-open') tm.registration = { ...registrationOf(tm), open: true };
      else {
        const regs = (await remote.tournamentRegistrations(tm.id)).filter((r) => r.status === 'approved');
        const approved = [];
        for (const r of regs) {
          let directoryId: string | undefined;
          try { directoryId = await remote.playerForProfile(r.player_id); } catch { /* keep without directory link */ }
          approved.push({ profileId: r.player_id, name: r.full_name || '?', directoryId });
        }
        closeRegistration(tm, approved);
        dir = null;
      }
      persist();
      regCache.delete(tm.id);
      if (act === 'reg-close') { location.hash = `#/t/${tm.id}/groups`; return true; }
      route(); return true;
    }
    case 'dir-pick': case 'dir-new': {
      let entry: remote.DirPlayer | undefined;
      try {
        if (act === 'dir-new') {
          // A new player needs a mobile: it becomes their username (password "pingo123").
          const mobile = normalizeMobile(val('dirNewMobile'));
          if (!mobile) { toast(t(val('dirNewMobile') ? 'auth.err.badMobile' : 'dir.needMobile')); document.getElementById('dirNewMobile')?.focus(); return true; }
          const r = (await remote.addPlayers([{ full_name: el.dataset.name!, mobile }])).rows[0];
          if (!r?.player_id) throw new Error(r?.error ?? 'unknown');
          dir = await remote.listPlayers();
          entry = dir.find((d) => d.id === r.player_id);
          toast(r.kind === 'new' ? `✅ ${t('dir.added')} · ${mobile} / ${DEFAULT_PASSWORD}` : t('batch.kind.account'));
        } else entry = dir?.find((d) => d.id === el.dataset.id);
      } catch (e) { toast(authErr(e)); return true; }
      if (!entry) return true;
      if (location.hash.startsWith('#/new')) {
        readDraft();
        const names = draftNames();
        if (!names.includes(entry.full_name)) draft.players = [...names, entry.full_name].join('\n');
        draft.dirIds[entry.full_name] = entry.id;
      } else if (tm) {
        try { addPlayerToSetup(tm, entry.full_name, entry.id, entry.profile_id ?? undefined); persist(); } catch { toast(t('dir.duplicate')); }
      }
      route();
      document.getElementById('dirQ')?.focus();
      return true;
    }
    case 'rm-player':
      if (tm) { removePlayerFromSetup(tm, el.dataset.pid!); persist(); route(); }
      return true;
    case 'link-open':
      linking = linking === el.dataset.id ? null : el.dataset.id!;
      route(); return true;
    case 'link-save': {
      const account = (document.getElementById('linkSel') as HTMLSelectElement | null)?.value;
      if (!account) return true;
      try { await remote.linkPlayer(el.dataset.id!, account); toast(t('dir.linked')); linking = null; dir = null; } catch (e) { toast(authErr(e)); }
      route(); return true;
    }
    case 'confirm-user':
      try { await remote.confirmUser(el.dataset.id!); toast(`✅ ${t('users.confirmed')}`); pendingUsers = (pendingUsers ?? []).filter((u) => u.id !== el.dataset.id); }
      catch (e) { toast(authErr(e)); }
      route(); return true;
    case 'copy-link':
      try { await navigator.clipboard.writeText(location.href.replace(/\/register$/, '')); toast(t('reg.copied')); } catch { toast(location.href); }
      return true;
  }
  return false;
}


/** Save a tournament made by the wizard; online, link every player to the directory first. */
async function commitNew(nt: Tournament): Promise<void> {
  if (online()) {
    busy = true;
    try {
      if (!dir) dir = await remote.listPlayers();
      for (const p of nt.players) {
        const picked = draft.dirIds[p.name];
        const match = picked ? dir.find((d) => d.id === picked) : exactDirectoryMatch(dir, p.name);
        if (match) { p.directoryId = match.id; if (match.profile_id) p.accountId = match.profile_id; continue; }
        const created = await remote.addPlayer({ full_name: p.name });
        dir.push(created);
        p.directoryId = created.id;
      }
    } catch (e) {
      busy = false;
      draft.error = authErr(e);
      route();
      return;
    }
    busy = false;
    if (draft.selfReg) {
      const max = Number(draft.maxPlayers);
      nt.registration = { open: true, autoAccept: draft.autoAccept, maxPlayers: max >= 2 ? max : null };
    }
    if (session.profile) nt.organizerId = session.profile.id;
  }
  data.tournaments.unshift(nt);
  persist();
  draft = newDraft();
  location.hash = `#/t/${nt.id}/${nt.registration?.open ? 'register' : 'groups'}`;
}

/* ------------------------------------------------------------------ router */

/** Draw the page; in the journey simulator, draw it as the chosen kind of user would see it. */
function route(): void {
  const real = session.profile;
  const as: Preview = real?.role === 'admin' ? preview.as : 'off';
  const onAdmin = location.hash.startsWith('#/admin') || location.hash.startsWith('#/desk');
  rendering.preview = onAdmin ? 'off' : as;
  if (as !== 'off' && real && !onAdmin) session.profile = previewProfile(real, as);
  try { draw(); } finally { session.profile = real; rendering.preview = 'off'; }
  startCarousels();
}

function draw(): void {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'desk') {
    // Role tools: their own frame, apart from the public site.
    if (!online()) { shell(empty('shield', t('nav.onlineOnly'))); return; }
    const html = desk.page(parts);
    if (html === null) return;
    document.body.classList.toggle('no-hints', !prefs.hints);
    document.body.dataset.section = 'desk';
    app.innerHTML = html;
  } else if (parts[0] === 'new') {
    if (!isOrg()) { location.hash = '#/'; return; }
    shell(wizardPage());
  } else if (parts[0] === 'tournaments') {
    shell(tournamentsPage(parts[1]));
  } else if (['news', 'shop', 'training'].includes(parts[0])) {
    if (!online()) { shell(empty('spark', t('nav.onlineOnly'))); return; }
    shell(news.route(parts) ?? shop.route(parts) ?? training.route(parts) ?? '');
  } else if (parts[0] === 'faq') {
    shell(faq.route(parts) ?? '');
    if (parts[1]) document.getElementById(`faq-${parts[1]}`)?.scrollIntoView({ block: 'start' });
  } else if (parts[0] === 'login' && online()) {
    shell(loginPage());
  } else if (session.loading && online() && ['password', 'me', 'admin', 'players'].includes(parts[0])) {
    // Signed-in pages wait for the account to load instead of sending the visitor away.
    shell(`<div class="card center muted"><span class="spin"></span> ${t('sync.loading')}</div>`);
  } else if (parts[0] === 'password' && online()) {
    if (!session.profile) { location.hash = '#/login'; return; }
    shell(passwordPage());
  } else if (parts[0] === 'me' && online()) {
    if (!session.profile) { location.hash = '#/login'; return; }
    shell(mePage());
  } else if (parts[0] === 'admin' && online()) {
    if (!canOrganize() || !session.profile) { location.hash = '#/'; return; }
    shell(isAdmin() ? admin.page(parts) : usersPage());
  } else if (parts[0] === 'org' && online()) {
    // The organizer dashboard moved into the organizer's tool.
    location.hash = '#/desk/org';
  } else if (parts[0] === 'players' && online()) {
    if (!canOrganize() || !session.profile) { location.hash = '#/'; return; }
    shell(playersPage());
    if (parts[1] === 'batch') document.getElementById('bNames')?.focus();
  } else if (parts[0] === 'claim' && online()) {
    shell(claim.page(parts));
  } else if (parts[0] === 't') {
    const tm = findT(parts[1]);
    if (!tm) {
      shell(`<div class="card center"><p>${t('t.notFound')}</p><a class="btn" href="#/">${t('t.backHome')}</a></div>`);
    } else if (parts[2] === 'm' && tm.matches[parts[3]]) {
      shell(scorePage(tm, tm.matches[parts[3]]));
    } else {
      let tab = (parts[2] as Tab) || (tm.stage === 'knockout' ? 'knockout' : online() && tm.stage === 'setup' ? 'register' : 'groups');
      if (tab === 'settings' && !isOrg()) tab = 'groups';
      if (tab === 'media' && !online()) tab = 'groups';
      if (tab === 'register' && (!online() || tm.stage !== 'setup')) tab = 'groups';
      shell(tournamentPage(tm, tab));
    }
  } else {
    shell(homePage());
  }
}

function current(): { tm?: Tournament; m?: Match } {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] !== 't') return {};
  const tm = findT(parts[1]);
  return { tm, m: tm && parts[2] === 'm' ? tm.matches[parts[3]] : undefined };
}

/* ------------------------------------------------------------------ events */

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!el || el.tagName === 'INPUT') return;
  const act = el.dataset.act!;
  const here = current();
  const tm = el.dataset.tid ? findT(el.dataset.tid) : here.tm;
  const m = here.m;
  if (act.startsWith('dk-')) { void desk.onClick(act, el); return; }
  if (/^(news|shop|tr)-/.test(act)) {
    void (act.startsWith('news-') ? news.onClick(act, el) : act.startsWith('shop-') ? shop.onClick(act, el) : training.onClick(act, el));
    return;
  }
  if (act.startsWith('role-')) { void roleAction(act, el); return; }
  if (act === 'dir-print') { if (printable.length) claim.printCards(printable); return; }
  if (/^(batch|claim)-/.test(act)) { void claim.onClick(act, el); return; }
  if (/^(media|assist)-/.test(act) && tm) { void mediaAction(act, el, tm); return; }
  if (act === 'car-go' || act === 'car-step') {
    const c = el.closest<HTMLElement>('[data-carousel]');
    if (!c) return;
    const track = c.querySelector<HTMLElement>('.car-track');
    const at = Number(c.dataset.at ?? 0), d = Number(el.dataset.d);
    if (act === 'car-go') carGo(c, Number(el.dataset.i));
    else if (d > 0 && track && !c.hasAttribute('data-fade') && carAtEnd(track)) carGo(c, 0);
    else carGo(c, at + d);
    return;
  }
  if (act.startsWith('adm-') || act.startsWith('pv-')) { void admin.onClick(act, el); return; }
  if (act.startsWith('sim-') && tm && isOrg()) { simAction(act, el, tm); return; }
  if (act === 'rm-player' && tm && !online()) { removePlayerFromSetup(tm, el.dataset.pid!); persist(); route(); return; }
  if (online() && ONLINE_ACTS.has(act)) {
    void onlineAction(act, el, tm);
    return;
  }

  switch (act) {
    case 'tl-clear':
      listFilters.time = 'any'; listFilters.place = '';
      route();
      return;
    case 't-cover-del':
      if (!tm) return;
      delete tm.cover;
      persist(); admin.reset(); toast(t('admin.saved'));
      route();
      return;
    case 'view':
      prefs.view = el.dataset.v as View;
      selectedChip = null;
      route();
      toast(el.dataset.v === 'player' ? `🎾 ${t('view.player')}` : `🛠️ ${t('view.organizer')}`);
      return;
    case 'hints':
      prefs.hints = !prefs.hints;
      route();
      return;
    case 'sample-open':
      sampleOpen = !sampleOpen;
      route();
      if (sampleOpen) document.getElementById('sample')?.scrollIntoView({ behavior: 'smooth' });
      return;
    case 'sample': {
      const players = Number((document.getElementById('sPlayers') as HTMLSelectElement).value);
      const groups = Number((document.getElementById('sGroups') as HTMLSelectElement).value);
      const withPoints = (document.getElementById('sPoints') as HTMLInputElement).checked;
      const st = sampleTournament(el.dataset.level as SampleLevel, Date.now(), players, Math.min(groups, Math.floor(players / 2)), withPoints);
      data.tournaments.unshift(st);
      persist();
      sampleOpen = false;
      location.hash = `#/t/${st.id}`;
      return;
    }
    case 'export': {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pingo-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      return;
    }

    /* wizard */
    case 'w-next':
      readDraft();
      draft.error = validateDraft(draft.step);
      if (!draft.error) draft.step++;
      route();
      return;
    case 'w-back':
      readDraft();
      draft.error = '';
      draft.step--;
      route();
      return;
    case 'w-fill': {
      readDraft();
      const existing = draftNames();
      const add = sampleNames(16, Date.now()).filter((x) => !existing.includes(x));
      draft.players = [...existing, ...add].slice(0, Math.max(16, existing.length)).join('\n');
      route();
      return;
    }
    case 'w-groups':
      draft.groupCount = Number(el.dataset.v);
      draft.error = '';
      route();
      return;
    case 'w-format':
      readDraft();
      draft.formats[el.dataset.k as keyof StageFormats] = Number(el.dataset.v) as BestOf;
      route();
      return;
    case 'w-finish': {
      readDraft();
      draft.error = validateDraft(3);
      if (draft.error) { route(); return; }
      const nt = createTournament({
        name: draft.name.trim(), date: draft.date, playerNames: draftNames(), groupCount: draft.groupCount,
        formats: draft.formats, consolation: { enabled: draft.consolation.enabled, name: draft.consolation.name.trim() || 'بطولة الترضية' },
        pointsPerGame: draft.pointsPerGame,
      });
      if (draft.time) nt.time = draft.time;
      if (draft.location.trim()) nt.location = draft.location.trim();
      void commitNew(nt);
      return;
    }

    /* setup board */
    case 'chip':
      if (dragMoved) return;
      selectedChip = selectedChip === el.dataset.pid ? null : el.dataset.pid!;
      route();
      if (selectedChip) toast(t('setup.selected'));
      return;
    case 'extra-open':
      extraPickFor = el.dataset.gid || null;
      route();
      return;
    case 'extra-add':
      if (!tm || !isOrg()) return;
      try { addExtraPlayer(tm, el.dataset.pid!, el.dataset.gid!); } catch { return; }
      extraPickFor = null;
      persist();
      toast(t('extra.added'));
      route();
      return;
    case 'rm-extra':
      if (!tm || !isOrg()) return;
      removeExtraPlayer(tm, el.dataset.pid!, el.dataset.gid!);
      persist();
      route();
      return;
    case 'drop-here':
      if (!tm || !selectedChip) return;
      placePlayer(tm, selectedChip, el.dataset.gid!);
      selectedChip = null;
      persist();
      route();
      return;
    case 'reshuffle':
      if (!tm) return;
      reshuffleGroups(tm);
      extraPickFor = null;
      persist();
      route();
      return;
    case 'start-groups':
      if (!tm) return;
      try {
        startGroups(tm);
      } catch (e) {
        toast(t((e as Error).message === 'waiting' ? 'tsim.errWaiting' : 'setup.errSmall'));
        return;
      }
      persist();
      location.hash = `#/t/${tm.id}/matches`;
      return;
    case 'tie-move': {
      const key = el.dataset.key!;
      const order = [...(tieDrafts.get(key) ?? [])];
      const i = Number(el.dataset.i), j = i + Number(el.dataset.d);
      [order[i], order[j]] = [order[j], order[i]];
      tieDrafts.set(key, order);
      route();
      return;
    }
    case 'tie-save': {
      if (!tm) return;
      const g = tm.groups.find((x) => x.id === el.dataset.gid)!;
      const order = tieDrafts.get(el.dataset.key!) ?? [];
      // Keep earlier manual decisions for other tied sets in this group.
      g.manualOrder = [...g.manualOrder.filter((id) => !order.includes(id)), ...order];
      tieDrafts.delete(el.dataset.key!);
      persist();
      toast(t('settings.saved'));
      route();
      return;
    }
    case 'tables-save':
    case 'tables-auto':
    case 'tables-clear': {
      if (!tm || !isOrg()) return;
      if (act === 'tables-auto') numberTables(tm);
      else document.querySelectorAll<HTMLInputElement>('[data-table-gid]').forEach((inp) =>
        setGroupTable(tm, inp.dataset.tableGid!, act === 'tables-clear' ? '' : inp.value));
      persist();
      toast(t(act === 'tables-clear' ? 'table.cleared' : 'table.saved'));
      route();
      return;
    }
    case 'start-ko':
      if (!tm) return;
      startKnockout(tm);
      persist();
      location.hash = `#/t/${tm.id}/knockout`;
      return;
    case 'filter':
      matchFilter = el.dataset.v as typeof matchFilter;
      route();
      return;

    /* settings */
    case 'set-save': {
      if (!tm) return;
      const nm = (document.getElementById('setName') as HTMLInputElement).value.trim();
      const cn = (document.getElementById('setCons') as HTMLInputElement).value.trim();
      if (nm) tm.name = nm;
      tm.date = (document.getElementById('setDate') as HTMLInputElement).value;
      const tv = (document.getElementById('setTime') as HTMLInputElement).value;
      if (tv) tm.time = tv; else delete tm.time;
      const lv = (document.getElementById('setLoc') as HTMLInputElement).value.trim();
      if (lv) tm.location = lv; else delete tm.location;
      if (cn) {
        tm.consolation.name = cn;
        tm.brackets.filter((b) => b.kind === 'consolation').forEach((b) => (b.name = cn));
      }
      persist();
      toast(t('settings.saved'));
      route();
      return;
    }
    case 'set-scoring':
      if (!tm) return;
      tm.pointsPerGame = el.dataset.v === '1';
      persist();
      toast(t('settings.saved'));
      route();
      return;
    case 'w-scoring':
      readDraft();
      draft.pointsPerGame = el.dataset.v === '1';
      route();
      return;
    case 'set-format':
      if (!tm || tm.stage !== 'setup') return;
      tm.formats[el.dataset.k as keyof StageFormats] = Number(el.dataset.v) as BestOf;
      persist();
      route();
      return;
    case 'duplicate': {
      if (!tm) return;
      const copy = duplicateTournament(tm, `${tm.name} ${t('settings.copySuffix')}`);
      data.tournaments.unshift(copy);
      persist();
      toast(t('settings.duplicated'));
      location.hash = `#/t/${copy.id}/groups`;
      return;
    }
    case 'delete':
      if (!tm) return;
      if (!deleteArmed) { deleteArmed = true; route(); setTimeout(() => { deleteArmed = false; }, 4000); return; }
      deleteArmed = false;
      data.tournaments = data.tournaments.filter((x) => x.id !== tm.id);
      if (online()) remote.deleteTournament(tm.id).catch(() => toast(t('auth.err.forbidden')));
      persist();
      toast(t('settings.deleted'));
      location.hash = '#/';
      return;

    /* score entry */
    case 'pick-result': {
      if (!sd || !m) return;
      sd.result = { a: Number(el.dataset.a), b: Number(el.dataset.b) };
      sd.error = '';
      route();
      return;
    }
    case 'game-winner': {
      if (!sd || !m) return;
      syncInputs();
      const i = Number(el.dataset.i);
      sd.games[i].w = el.dataset.s as 'a' | 'b';
      sd.error = '';
      route();
      // Next step is the loser's points: put the cursor there.
      const inp = document.querySelector<HTMLInputElement>(`input[data-act="lose"][data-i="${i}"]`);
      if (inp && inp.value === '') inp.focus();
      return;
    }
    case 'save-score':
    case 'walkover': {
      if (!sd || !m || !tm) return;
      syncInputs();
      let res: ReturnType<typeof saveResult>;
      if (act === 'walkover') res = saveResult(tm, m.id, [], el.dataset.s as 'a' | 'b');
      else if (!recordsPoints(tm)) {
        if (!sd.result) { sd.error = t('score.err.pick'); route(); return; }
        res = saveResult(tm, m.id, [], null, sd.result);
      } else {
        const rows = sd.games.slice(0, shownGames(sd, m.bestOf));
        const bad = rows.findIndex((g) => !draftGame(g));
        if (bad !== -1) {
          sd.error = t(rows[bad].w ? 'score.err.loser' : 'score.err.noWinner', { n: bad + 1 });
          route();
          return;
        }
        res = saveResult(tm, m.id, rows.map((g) => draftGame(g)!), null);
      }
      if (!res.ok) {
        sd.error = res.error === 'locked' ? t('score.err.locked') : errorText(res as MatchCheck);
        route();
        return;
      }
      persist();
      sd = null;
      toast(`✅ ${t('score.saved')}`);
      const b = m.bracketId ? tm.brackets.find((x) => x.id === m.bracketId) : undefined;
      if (b?.kind === 'main' && b.rounds[b.rounds.length - 1][0] === m.id) confetti();
      location.hash = `#/t/${tm.id}/${m.stage === 'group' ? 'matches' : 'knockout'}`;
      return;
    }
  }
});

function syncInputs(): void {
  if (!sd) return;
  document.querySelectorAll<HTMLInputElement>('input[data-act="lose"]').forEach((inp) => {
    sd!.games[Number(inp.dataset.i)].lose = inp.value.replace(/[^\d]/g, '').slice(0, 2);
  });
}

let assistTimer = 0;
document.addEventListener('input', (e) => {
  const el = e.target as HTMLElement;
  if (shop.onInput(el as HTMLInputElement) || claim.onInput(el)) return;
  if (admin.onInput(el as HTMLInputElement)) return;
  if (el.dataset.act === 'assist-q') {
    const q = (el as HTMLInputElement).value.trim();
    clearTimeout(assistTimer);
    assistTimer = window.setTimeout(() => {
      if (q.length < 2) { helperHits = []; } 
      (q.length < 2 ? Promise.resolve([]) : content.searchPeople(q)).then((r) => {
        helperHits = r;
        const box = document.getElementById('assistRes');
        if (box) box.innerHTML = assistResults();
      }).catch(() => undefined);
    }, 250);
    return;
  }
  if (el.dataset.act === 'dir-q') {
    const res = document.getElementById('dirRes');
    const { tm } = current();
    const exclude = new Set(location.hash.startsWith('#/new')
      ? Object.values(draft.dirIds)
      : (tm?.players.map((p) => p.directoryId).filter((x): x is string => !!x) ?? []));
    if (res) res.innerHTML = dirResults((el as HTMLInputElement).value, exclude);
    return;
  }
  if (el.dataset.act === 'dir-filter') {
    dirFilter = (el as HTMLInputElement).value;
    const pos = (el as HTMLInputElement).selectionStart;
    route();
    const again = document.getElementById('dirFilter') as HTMLInputElement | null;
    again?.focus();
    if (again && pos !== null) again.setSelectionRange(pos, pos);
    return;
  }
  if (el.id === 'wPlayers') {
    const c = document.getElementById('wCount');
    draft.players = (el as HTMLTextAreaElement).value;
    if (c) c.textContent = `${n(draftNames().length)} ${t('wizard.count')}`;
  }
  if (el.dataset.act === 'lose' && sd) {
    syncInputs();
    // Update the row without a full re-render to keep focus.
    const i = Number(el.dataset.i);
    const game = draftGame(sd.games[i]);
    const row = el.closest('.gamerow2')!;
    row.classList.toggle('ok', !!game);
    row.classList.toggle('bad', !game && sd.games[i].lose !== '');
    row.querySelector('.gs')!.innerHTML = game ? pair(game.a, game.b, ':') : '';
    if (sd.error) { sd.error = ''; document.querySelector('.err[role="alert"]')?.remove(); }
  }

});

document.addEventListener('submit', async (e) => {
  const form = e.target as HTMLFormElement;
  const kind = form.dataset.form;
  if (!kind) return;
  e.preventDefault();
  if (kind === 'login' || kind === 'signup') { await submitAuth(kind); return; }
  if (kind === 'password') { await submitPassword(); return; }
  if (kind === 'login-mobile') {
    const m = normalizeMobile(val('lmMobile'));
    if (!m) { toast(t('auth.err.badMobile')); return; }
    try {
      await remote.setMobile(m);
      loginMobile = m; loginEdit = false;
      session.profile = await remote.myProfile();
      toast(`✅ ${t('login.saved', { mobile: m })}`);
    } catch (err) { toast(authErr(err)); }
    route();
    return;
  }
  if (kind === 'user-edit') { await saveUserEdit(); return; }
  if (await desk.onSubmit(kind)) return;
  if (await news.onSubmit(kind, form) || await shop.onSubmit(kind, form) || await training.onSubmit(kind, form) || await claim.onSubmit(kind, form)) return;
  if (kind === 'add-player') {
    const name = val('pName');
    const mobile = normalizeMobile(val('pPhone'));
    if (!name || !val('pPhone')) { toast(t('auth.err.required')); return; }
    if (!mobile) { toast(t('auth.err.badMobile')); return; }
    const year = Number(val('pYear').replace(/[^\d]/g, ''));
    try {
      // Every player is an account that signs in with their mobile and "pingo123".
      const r = (await remote.addPlayers([{ full_name: name, mobile, club: val('pClub') || undefined, birth_year: year >= 1920 ? year : undefined }])).rows[0];
      if (r?.kind === 'new') toast(`✅ ${t('dir.added')} · ${mobile} / ${DEFAULT_PASSWORD}`);
      else toast(authErr(new Error(r?.kind === 'account' ? 'mobile already registered' : r?.error ?? 'bad mobile')));
      dir = null;
    } catch (err) { toast(authErr(err)); }
    route();
    return;
  }
  if (kind === 'create-account') {
    busy = true; route();
    try {
      const roles = EXTRA.filter((r) => (document.getElementById(`cRole-${r}`) as HTMLInputElement | null)?.checked);
      const mobile = normalizeMobile(val('cMobile'));
      if (!val('cName') || !mobile) throw new Error(val('cName') ? 'bad mobile' : 'required');
      await remote.createAccount({ full_name: val('cName'), mobile, password: val('cPass'), club: val('cClub'), birth_year: '', roles });
      toast(`✅ ${t('users.created')}`);
      people = null;
    } catch (err) { toast(authErr(err)); }
    busy = false; route();
    return;
  }
  if (kind === 'me' && session.profile) {
    const year = Number(val('mYear').replace(/[^\d]/g, ''));
    try {
      await remote.updateProfile(session.profile.id, {
        full_name: val('mName') || session.profile.full_name, phone: val('mPhone') || null,
        birth_year: year >= 1920 ? year : null, club: val('mClub') || null,
        ...(genderVal('mGender') ? { gender: genderVal('mGender') as remote.Gender } : {}),
        ...(document.getElementById('mBio') ? { bio: (document.getElementById('mBio') as HTMLTextAreaElement).value.trim() || null } : {}),
      });
      session.profile = await remote.myProfile();
      toast(t('settings.saved'));
    } catch (err) { toast(authErr(err)); }
    route();
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target as HTMLInputElement;
  const { tm } = current();
  if (await desk.onChange(el)) return;
  if (await news.onChange(el) || await shop.onChange(el) || training.onChange(el) || await claim.onChange(el) || admin.onChange(el)) return;
  if (el.dataset.act === 'tl-time' || el.dataset.act === 'tl-place') {
    if (el.dataset.act === 'tl-time') listFilters.time = el.value as TimeFilter; else listFilters.place = el.value;
    route(); return;
  }
  if (el.dataset.act === 't-cover' && el.files?.[0]) {
    const target = findT(el.dataset.tid ?? '');
    if (!target) return;
    toast(t('media.uploading'));
    try {
      target.cover = await content.uploadImage(el.files[0], 1600);
      persist(); admin.reset(); toast(t('media.uploaded'));
    } catch (err) { toast(authErr(err)); }
    route(); return;
  }
  if (el.dataset.act === 'media-photo' && el.files?.[0] && tm) {
    toast(t('media.uploading'));
    try {
      const url = await content.uploadImage(el.files[0]);
      tm.media = [...(tm.media ?? []), { id: uid(), kind: 'photo', url, caption: val('mdCap') }];
      persist(); toast(t('media.uploaded'));
    } catch (err) { toast(authErr(err)); }
    route(); return;
  }
  if (el.dataset.act === 'me-photo' && el.files?.[0] && session.profile) {
    toast(t('media.uploading'));
    try {
      const url = await content.uploadImage(el.files[0], 480);
      await remote.updateProfile(session.profile.id, { avatar_url: url });
      session.profile.avatar_url = url;
      toast(t('media.uploaded'));
    } catch (err) { toast(authErr(err)); }
    route(); return;
  }
  if (el.name === 'aGender') { keepAuthVals(true); route(); return; }
  if (el.dataset.act === 'signup-photo' && el.files?.[0]) {
    try {
      signupPhoto = await content.squareDataUrl(el.files[0]);
      try { localStorage.setItem(PHOTO_KEY, signupPhoto); } catch { /* ignore */ }
    } catch { toast(t('auth.err.upload')); }
    keepAuthVals(true);
    route(); return;
  }
  if (el.dataset.act === 'role-flag') {
    const id = el.dataset.id!;
    const flag = el.dataset.flag!;
    try {
      if (flag === 'admin') await content.setRoles(id, { role: el.checked ? 'admin' : 'player' });
      else await content.setRoles(id, { [flag]: el.checked });
      toast(t('admin.saved'));
    } catch (err) { toast(authErr(err)); el.checked = !el.checked; }
    return;
  }
  if ((el.dataset.act === 'reg-auto' || el.dataset.act === 'reg-max') && tm) {
    const max = Number(val('rMax').replace(/[^\d]/g, ''));
    tm.registration = { ...registrationOf(tm), autoAccept: (document.querySelector('[data-act="reg-auto"]') as HTMLInputElement).checked, maxPlayers: max >= 2 ? max : null };
    persist();
    toast(t('settings.saved'));
    return;
  }
  if (el.dataset.act === 'import' && el.files?.[0]) {
    try {
      const incoming = parseBackup(await el.files[0].text());
      const known = new Set(data.tournaments.map((x) => x.id));
      for (const x of incoming.tournaments) {
        if (known.has(x.id)) x.id = uid();
        data.tournaments.push(x);
      }
      persist();
      toast(t('home.imported'));
      route();
    } catch {
      toast(t('home.importFailed'));
    }
  }
});

document.addEventListener('keydown', (e) => {
  const el = e.target as HTMLElement;
  if ((e.key === 'Enter' || e.key === ' ') && (el.dataset.act === 'chip' || el.dataset.act === 'drop-here')) {
    e.preventDefault();
    el.click();
  }
});

/* Pointer-based drag and drop: works with mouse and touch. */
let drag: { pid: string; x: number; y: number; ghost?: HTMLElement; over?: HTMLElement | null } | null = null;
let dragMoved = false;

document.addEventListener('pointerdown', (e) => {
  const chip = (e.target as HTMLElement).closest<HTMLElement>('.chip[data-act="chip"]');
  if (!chip || e.button !== 0) return;
  drag = { pid: chip.dataset.pid!, x: e.clientX, y: e.clientY };
  dragMoved = false;
});

document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.ghost) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
    const src = document.querySelector<HTMLElement>(`.chip[data-pid="${drag.pid}"]`);
    if (!src) return;
    dragMoved = true;
    const g = src.cloneNode(true) as HTMLElement;
    g.classList.add('ghost-chip');
    g.style.width = `${src.offsetWidth}px`;
    document.body.append(g);
    drag.ghost = g;
    src.style.opacity = '.35';
  }
  // Scroll the page when dragging near the top or bottom edge (long boards on phones).
  if (e.clientY < 90) window.scrollBy(0, -14);
  else if (e.clientY > window.innerHeight - 90) window.scrollBy(0, 14);
  drag.ghost.style.left = `${e.clientX - drag.ghost.offsetWidth / 2}px`;
  drag.ghost.style.top = `${e.clientY - 20}px`;
  const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.gcol') ?? null;
  if (under !== drag.over) {
    drag.over?.classList.remove('drop');
    under?.classList.add('drop');
    drag.over = under;
  }
});

function endDrag(commit: boolean): void {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.ghost) return;
  d.ghost.remove();
  const { tm } = current();
  if (commit && tm && d.over) {
    const target = d.over;
    // Insert before the chip under the pointer, if any.
    const chips = [...target.querySelectorAll<HTMLElement>('.chip')].filter((c) => c.dataset.pid !== d.pid);
    const ghostTop = parseFloat(d.ghost.style.top);
    const index = chips.findIndex((c) => c.getBoundingClientRect().top + c.offsetHeight / 2 > ghostTop + 20);
    placePlayer(tm, d.pid, target.dataset.gid!, index === -1 ? undefined : index);
    persist();
  }
  selectedChip = null;
  route();
  setTimeout(() => (dragMoved = false), 0);
}

document.addEventListener('pointerup', () => endDrag(true));
document.addEventListener('pointercancel', () => endDrag(false));


let lastHash = location.hash;

if (online()) {
  remote.onAuthChange(() => {
    refreshFromServer().then(() => {
      // Send a player who signed up from a tournament back to that tournament.
      let back: string | null = null;
      try { back = localStorage.getItem(RETURN_KEY); } catch { /* ignore */ }
      if (session.profile && back && ['', '#', '#/', '#/login'].includes(location.hash)) {
        try { localStorage.removeItem(RETURN_KEY); } catch { /* ignore */ }
        location.hash = back;
        return;
      }
      route();
    });
  });
}

window.addEventListener('hashchange', () => {
  if (location.hash === '#/login' && /^#\/(t|news|shop|training|claim|desk)\//.test(lastHash)) {
    try { localStorage.setItem(RETURN_KEY, lastHash); } catch { /* ignore */ }
  }
  lastHash = location.hash;
  window.scrollTo(0, 0);
  deleteArmed = false;
  route();
});
setRender(route);
claim.setOnAdded(() => { dir = null; regCache.clear(); route(); });
claim.setTournaments(() => data.tournaments
  .filter((x) => x.stage === 'setup')
  .map((x) => ({ id: x.id, name: x.name, open: registrationOf(x).open })));
claim.setAfterClaim(async () => { await refreshFromServer(); });
admin.setUsersView(usersPage);
desk.setHost({
  tournaments: () => data.tournaments,
  persist,
  add: (nt) => { data.tournaments.unshift(nt); persist(); },
  refresh: refreshFromServer,
});
admin.setAfterBulk(async () => { await refreshFromServer(); route(); });
route();
