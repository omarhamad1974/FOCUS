/**
 * Player statistics on the public profile (#/u/<id>) and the players'
 * ranking page (#/ranking). Everything is computed from the tournaments the
 * app already loaded (domain/stats), so no extra database tables are needed.
 */
import { dateFmt, t, type MessageKey } from '../i18n/ar';
import * as content from '../data/content';
import { n, render, session } from '../app/ctx';
import { host } from '../admin/host';
import { PLACE_BONUS, playerStats, ranking, type Finish, type PlayerStats, type RankRow } from '../domain/stats';
import type { Tournament } from '../domain/types';
import { icon } from '../ui/icons';
import { avatar, esc } from '../ui/util';

/* Ranking is computed once per set of loaded tournaments. */
let cache: { list: Tournament[]; key: string; rows: RankRow[] } | null = null;
function rows(): RankRow[] {
  const list = host.tournaments();
  const key = list.map((x) => `${x.id}:${Object.values(x.matches).filter((m) => m.games.length || m.walkover || m.result).length}`).join('|');
  if (!cache || cache.list !== list || cache.key !== key) cache = { list, key, rows: ranking(list) };
  return cache.rows;
}

/* Public cards (names, photos) of ranked players, loaded once per id. */
const asked = new Set<string>();
function loadPeople(ids: (string | undefined)[]): void {
  const missing = [...new Set(ids)].filter((id): id is string => !!id && !asked.has(id) && !content.person(id));
  if (!missing.length) return;
  missing.forEach((id) => asked.add(id));
  const parts: string[][] = [];
  for (let i = 0; i < missing.length; i += 80) parts.push(missing.slice(i, i + 80));
  Promise.all(parts.map((p) => content.people(p))).then(render).catch(() => undefined);
}

const nameOf = (acc: string | undefined, fallback: string) => (acc && content.person(acc)?.full_name) || fallback;
const face = (acc: string | undefined, name: string) => avatar(name, content.photoOf(acc), content.genderOf(acc));

/** Win-rate ring (SVG), animated on first paint. */
function ring(rate: number | null): string {
  const pct = rate ?? 0;
  const c = 2 * Math.PI * 52;
  const color = pct >= 60 ? 'var(--green)' : pct >= 40 ? 'var(--gold)' : 'var(--red)';
  return `<div class="ps-ring" role="img" aria-label="${esc(t('stats.winRate'))} ${pct}%">
    <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="trk"/>
      <circle cx="60" cy="60" r="52" class="val" style="stroke:${color};stroke-dasharray:${c.toFixed(1)};--off:${(c * (1 - pct / 100)).toFixed(1)};--c:${c.toFixed(1)}"/></svg>
    <span class="ps-ring-in"><b>${rate === null ? '—' : `${n(pct)}%`}</b><small>${t('stats.winRate')}</small></span></div>`;
}

/** Arabic counted noun: 2 → dual, 3–10 → plural, else singular accusative (key holds "dual|plural|single"). */
function count(x: number, key: MessageKey): string {
  const [dual, plural, single] = t(key).split('|');
  if (x === 2) return dual;
  return `${n(x)} ${x >= 3 && x <= 10 ? plural : single}`;
}

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉', 4: '🎖️' };

/** Text and look of a finish in one tournament. */
export function finishView(f: Finish): { icon: string; text: string; cls: string } {
  const cons = (name: string) => name || t('ps.consolation');
  if (f.kind === 'registered') return { icon: '📝', text: t('ps.f.registered'), cls: '' };
  if (f.kind === 'group') {
    return f.alive
      ? { icon: '🏓', text: t('ps.f.groupAlive', { rank: n(f.rank) }), cls: 'live' }
      : { icon: '👥', text: t('ps.f.groupOut', { rank: n(f.rank) }), cls: '' };
  }
  if (f.kind === 'round') {
    const round = t(`ko.round.${f.round}` as MessageKey);
    const where = f.bracket === 'consolation' ? ` · ${cons(f.bracketName)}` : '';
    return f.alive
      ? { icon: '⚡', text: t('ps.f.koAlive', { round }) + where, cls: 'live' }
      : { icon: '🎯', text: t('ps.f.koOut', { round }) + where, cls: '' };
  }
  if (f.bracket === 'consolation') {
    return { icon: MEDAL[f.place], text: t(`ps.f.cons${f.place}` as MessageKey, { name: cons(f.bracketName) }), cls: `c${f.place}` };
  }
  return { icon: f.place === 1 ? '🏆' : MEDAL[f.place], text: t(`ps.f.main${f.place}` as MessageKey), cls: `m${f.place}` };
}

function formDots(s: PlayerStats): string {
  const last = s.recent.slice(0, 10);
  if (!last.length) return '';
  return `<div class="ps-form" aria-label="${esc(t('ps.form'))}">${last.map((m, i) =>
    `<span class="${m.won ? 'w' : 'l'}" style="--i:${i}" title="${esc(`${m.won ? t('ps.won') : t('ps.lost')} ${m.games[0]}-${m.games[1]} · ${m.opponentName}`)}">${m.won ? t('ps.w') : t('ps.l')}</span>`).join('')}</div>`;
}

function streakText(s: PlayerStats): string {
  if (s.streak >= 2) return `<span class="badge green ps-streak">🔥 ${t('ps.winStreak', { n: n(s.streak) })}</span>`;
  if (s.streak <= -2) return `<span class="badge ps-streak">💪 ${t('ps.lossStreak', { n: count(-s.streak, 'ps.lossesN') })}</span>`;
  return '';
}

/** Statistics block for a profile page; empty string when the account never joined a tournament. */
export function profileStats(account: string): string {
  const s = playerStats(host.tournaments(), account);
  if (!s.tournaments.length) return '';
  const all = rows();
  const mine = all.find((r) => r.accountId === account);
  loadPeople(s.recent.slice(0, 8).map((m) => m.opponentAccount));
  const own = session.profile?.id === account;
  const tile = (ic: string, v: string, label: MessageKey, cls = '') => `<div class="ps-tile ${cls}"><span class="ic">${ic}</span><b>${v}</b><small>${t(label)}</small></div>`;

  const hero = `<section class="card ps-hero rise">
    <h3>📊 ${t(own ? 'ps.titleOwn' : 'ps.title')}</h3>
    <div class="ps-top">${ring(s.winRate)}
      <div class="ps-tiles">
        ${tile('✅', n(s.wins), 'ps.wins', 'w')}${tile('❌', n(s.losses), 'ps.losses', 'l')}
        ${tile('🎾', n(s.played), 'ps.played')}${tile('🏓', `<span dir="ltr">${n(s.gamesWon)}:${n(s.gamesLost)}</span>`, 'ps.games')}
      </div></div>
    ${mine ? `<a class="ps-rank" href="#/ranking">
      <span class="ps-rank-no">#${n(mine.rank)}</span>
      <span><b>${t('ps.rankOf', { n: count(all.length, 'ps.playersN') })}</b><small>${t('ps.points', { n: n(mine.points) })}</small></span>
      <span class="ps-rank-go">${t('ps.seeRanking')} ${icon('chevron', 16)}</span></a>` : ''}
    <div class="row ps-formrow">${formDots(s)}${streakText(s)}</div>
    <p class="hint">${t('ps.hint')}</p>
  </section>`;

  const shelf = `<div class="card ps-shelf rise">
    <div class="ps-cup ${s.titles ? 'on' : ''}"><span>🏆</span><b>${n(s.titles)}</b><small>${t('ps.titles')}</small></div>
    <div class="ps-cup ${s.runnerUps ? 'on' : ''}"><span>🥈</span><b>${n(s.runnerUps)}</b><small>${t('ps.runnerUps')}</small></div>
    <div class="ps-cup ${s.podiums ? 'on' : ''}"><span>🥉</span><b>${n(s.podiums)}</b><small>${t('ps.podiums')}</small></div>
    <div class="ps-cup on"><span>🎟️</span><b>${n(s.tournaments.length)}</b><small>${t('ps.tournaments')}</small></div>
  </div>`;

  const journey = `<div class="card rise"><h3>${icon('trophy', 20)} ${t('ps.journey')}</h3>
    <div class="ps-journey">${s.tournaments.map((l) => {
      const f = finishView(l.finish);
      return `<a class="ps-tour ${f.cls}" href="#/t/${esc(l.tournamentId)}">
        <span class="ps-medal">${f.icon}</span>
        <span class="ps-tname"><b dir="auto">${esc(l.name)}</b><small>${f.text}${l.date ? ` · ${dateFmt.format(new Date(l.date))}` : ''}</small></span>
        ${l.wins + l.losses ? `<span class="ps-wl"><span class="w">${n(l.wins)}</span><i>-</i><span class="l">${n(l.losses)}</span></span>` : ''}</a>`;
    }).join('')}</div></div>`;

  const recent = s.recent.length ? `<div class="card rise"><h3>⚔️ ${t('ps.recent')}</h3>
    ${s.recent.slice(0, 8).map((m) => {
      const name = nameOf(m.opponentAccount, m.opponentName);
      const who = `${face(m.opponentAccount, name)}<span dir="auto">${esc(name)}</span>`;
      const tour = host.tournaments().find((x) => x.id === m.tournamentId);
      return `<div class="ps-match ${m.won ? 'w' : 'l'}">
        <span class="ps-res">${m.won ? t('ps.won') : t('ps.lost')}</span>
        <span class="ps-vs">${t('ps.vs')} ${m.opponentAccount ? `<a href="#/u/${esc(m.opponentAccount)}">${who}</a>` : `<span>${who}</span>`}
          <small class="muted" dir="auto">${esc(tour?.name ?? '')}${m.walkover ? ` · ${t('ps.walkover')}` : ''}</small></span>
        <b class="ps-score" title="${esc(t('ps.scoreTitle'))}"><span>${n(m.games[0])}</span><i>-</i><span>${n(m.games[1])}</span></b></div>`;
    }).join('')}</div>` : '';

  return hero + shelf + journey + recent;
}

/** Players' ranking: podium for the top 3, then everyone with at least one match. */
export function rankingPage(): string {
  const all = rows();
  loadPeople(all.slice(0, 100).map((r) => r.accountId));
  const me = session.profile?.id;
  const head = `<section class="banner b-rank slim rise"><h1>🏅 ${t('ps.rankingTitle')}</h1>
    <p>${t('ps.rankingText')}</p></section>
    <p class="hint">${t('ps.rankingRule', { c: n(PLACE_BONUS[1]), r: n(PLACE_BONUS[2]), t3: n(PLACE_BONUS[3]), t4: n(PLACE_BONUS[4]) })}</p>`;
  if (!all.length) {
    return `${head}<div class="card center muted"><p style="font-size:40px;margin:0">🏓</p><p>${t('ps.rankingEmpty')}</p>
      <a class="btn" href="#/tournaments">${icon('trophy', 16)} ${t('nav.tournaments')}</a></div>`;
  }
  const step = (r: RankRow | undefined, p: 1 | 2 | 3) => {
    if (!r) return `<div class="step p${p}"></div>`;
    const name = nameOf(r.accountId, r.name);
    return `<a class="step p${p}" href="#/u/${esc(r.accountId)}"><span class="medal">${MEDAL[p]}</span>
      <div class="podium-photo">${face(r.accountId, name)}</div><div class="nm" dir="auto">${esc(name)}</div>
      <div class="block"><span>${n(r.points)}</span><small>${t('ps.pts')}</small></div></a>`;
  };
  const top = all.slice(0, 3);
  const podium = `<div class="card rise"><div class="podium ps-podium">${step(top[1], 2)}${step(top[0], 1)}${step(top[2], 3)}</div></div>`;
  const list = `<div class="card rise ps-list">
    <div class="ps-row ps-headrow"><span>#</span><span>${t('ps.player')}</span><span>${t('ps.wl')}</span><span class="ps-c-rate">${t('stats.winRate')}</span><span>${t('ps.pts')}</span></div>
    ${all.map((r) => {
      const name = nameOf(r.accountId, r.name);
      return `<a class="ps-row ${r.accountId === me ? 'me' : ''} ${r.rank <= 3 ? `top${r.rank}` : ''}" href="#/u/${esc(r.accountId)}">
        <span class="ps-rk">${r.rank <= 3 ? MEDAL[r.rank] : n(r.rank)}</span>
        <span class="ps-who">${face(r.accountId, name)}<span dir="auto">${esc(name)}</span>${r.titles ? `<span class="badge gold" title="${esc(t('ps.titles'))}">🏆 ${n(r.titles)}</span>` : ''}</span>
        <span class="ps-wl"><span class="w">${n(r.wins)}</span><i>-</i><span class="l">${n(r.losses)}</span></span>
        <span class="ps-c-rate ps-bar"><span style="width:${r.winRate ?? 0}%"></span><small>${n(r.winRate ?? 0)}%</small></span>
        <b class="ps-pts">${n(r.points)}</b></a>`;
    }).join('')}</div>`;
  return head + podium + list;
}
