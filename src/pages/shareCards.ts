/**
 * Turns a tournament into the data of a shareable result card (see
 * ui/shareCard) and opens the share sheet.
 */
import { dateFmt, numberFmt, t, type MessageKey } from '../i18n/ar';
import type { Match, Tournament } from '../domain/types';
import { accountOf, groupStandings, playerName, qualifyingRows } from '../domain/tournament';
import { placements, roundName } from '../domain/bracket';
import { summarize } from '../domain/scoring';
import * as content from '../data/content';
import { MEDAL_COLORS, openShare, type CardData, type CardPerson } from '../ui/shareCard';

const n = (x: number) => numberFmt.format(x);

function person(tm: Tournament, pid: string | null): CardPerson {
  const pl = tm.players.find((p) => p.id === pid);
  const acc = pl ? accountOf(pl) : undefined;
  // Isolated so a Latin name ("Omar K.") keeps its own direction inside Arabic text.
  return { name: `\u2068${playerName(tm, pid)}\u2069`, photo: content.photoOf(acc), gender: content.genderOf(acc) };
}

function base(tm: Tournament) {
  const when = [tm.date ? dateFmt.format(new Date(tm.date)) : '', tm.location ?? ''].filter(Boolean).join(' · ');
  const site = (location.host + location.pathname).replace(/\/(index\.html)?$/, '');
  return { tournament: tm.name, when, labels: { footer: t('share.footer'), site } };
}

const pageLink = (hash: string) => `${location.href.split('#')[0]}#${hash}`;

function fileName(tm: Tournament, what: string): string {
  const slug = tm.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'pingo';
  return `pingo-${slug}-${what}.png`;
}

const mainBracket = (tm: Tournament) => tm.brackets.find((b) => b.kind === 'main');

/** Has the main draw a champion yet? */
export function hasChampion(tm: Tournament): boolean {
  const b = mainBracket(tm);
  return !!b && placements(b, tm.matches).some((p) => p.place === 1);
}

function championCard(tm: Tournament): CardData | null {
  const b = mainBracket(tm);
  if (!b) return null;
  const places = placements(b, tm.matches);
  const first = places.find((p) => p.place === 1);
  if (!first) return null;
  const others = places.filter((p) => p.place === 2 || p.place === 3)
    .map((p) => ({ label: t(`place.${p.place}` as MessageKey), person: person(tm, p.playerId), color: MEDAL_COLORS[p.place as 2 | 3] }));
  return { kind: 'champion', ...base(tm), title: t('share.cardChampion'), champion: person(tm, first.playerId), others };
}

function podiumCard(tm: Tournament, bracketId: string): CardData | null {
  const b = tm.brackets.find((x) => x.id === bracketId);
  if (!b) return null;
  const places = placements(b, tm.matches);
  if (!places.length) return null;
  const at = (p: number) => places.find((x) => x.place === p);
  const lines: { label: string; name: string }[] = [];
  const fourth = at(4);
  if (fourth) lines.push({ label: t('place.4'), name: person(tm, fourth.playerId).name });
  // On the main draw card, also name the consolation tournament's winner.
  if (b.kind === 'main') {
    for (const c of tm.brackets.filter((x) => x.kind === 'consolation')) {
      const w = placements(c, tm.matches).find((x) => x.place === 1);
      if (w) lines.push({ label: t('share.consolationWinner', { name: c.name }), name: person(tm, w.playerId).name });
    }
  }
  return {
    kind: 'podium', ...base(tm),
    title: b.kind === 'main' ? t('share.cardPodium') : `${t('share.cardPodium')} · ${b.name}`,
    places: ([1, 2, 3] as const).map((p) => ({ place: p, person: at(p) ? person(tm, at(p)!.playerId) : null })),
    lines,
  };
}

function groupCard(tm: Tournament, gi: number): CardData | null {
  const g = tm.groups[gi];
  if (!g) return null;
  const s = groupStandings(tm, g);
  const qRank = new Map(qualifyingRows(tm, g).map((r) => [r.playerId, r.rank]));
  const legend = [{ color: '#7ed957', label: t('standings.qualified') }];
  if (tm.consolation.enabled) legend.push({ color: '#f5b301', label: tm.consolation.name });
  return {
    kind: 'table', ...base(tm),
    title: t('share.cardGroup', { g: g.name }),
    heads: [t('standings.played'), t('standings.won'), t('standings.lost'), t('standings.pts')],
    rows: s.rows.map((r) => {
      const q = qRank.get(r.playerId);
      const tone = q === undefined ? '' : q <= 2 ? 'q' : q <= 4 && tm.consolation.enabled ? 'c' : '';
      return { rank: n(r.rank), person: person(tm, r.playerId), cells: [n(r.played), n(r.wins), n(r.losses), n(r.points)], tone };
    }),
    legend,
  };
}

function matchCard(tm: Tournament, m: Match): CardData | null {
  const s = summarize(m);
  if (!s.winner) return null;
  let where: string;
  if (m.stage === 'group') {
    const g = tm.groups.find((x) => x.id === m.groupId);
    where = `${t('setup.group')} ${g?.name ?? ''}`;
  } else {
    const b = tm.brackets.find((x) => x.id === m.bracketId);
    const round = m.round === -1 ? t('ko.round.third') : b ? t(`ko.round.${roundName(m.round!, b.rounds.length)}` as MessageKey) : '';
    where = [b?.kind === 'main' ? t('ko.main') : b?.name, round].filter(Boolean).join(' · ');
  }
  return {
    kind: 'match', ...base(tm),
    title: t('share.cardMatch'), where,
    a: person(tm, m.aId), b: person(tm, m.bId),
    gamesA: n(s.gamesA), gamesB: n(s.gamesB), winner: s.winner,
    games: m.walkover ? [] : m.games.map((g) => [n(g.a), n(g.b)] as [string, string]),
    note: m.walkover ? t('share.walkover') : '',
    winnerLabel: t('share.winner'),
  };
}

const texts = () => ({
  title: t('share.title'), hint: t('share.hint'), share: t('share.native'), download: t('share.download'),
  whatsapp: t('share.whatsapp'), facebook: t('share.facebook'), copy: t('share.copy'), copied: t('share.copied'),
  close: t('share.close'), making: t('share.making'), failed: t('share.failed'),
});

/** Button that opens the share sheet. `k` = champion | podium | group | match. */
export function shareButton(k: 'champion' | 'podium' | 'group' | 'match', extra = '', cls = 'btn soft small'): string {
  const label = t(`share.${k}` as MessageKey);
  return `<button class="${cls} share-btn" data-act="share-card" data-k="${k}" ${extra} title="${label}">📤 <span>${label}</span></button>`;
}

/** Handle a click on a share button. */
export function onShare(el: HTMLElement, tm: Tournament, m?: Match): void {
  const k = el.dataset.k;
  let d: CardData | null = null, what = '', msg = '', hash = `/t/${tm.id}`;
  if (k === 'champion') {
    d = championCard(tm); what = 'champion'; hash += '/knockout';
    if (d?.kind === 'champion') msg = t('share.msgChampion', { name: d.champion.name, t: tm.name });
  } else if (k === 'podium') {
    d = podiumCard(tm, el.dataset.b ?? ''); what = 'podium'; hash += '/knockout';
    msg = t('share.msgPodium', { t: tm.name });
  } else if (k === 'group') {
    const gi = Number(el.dataset.g);
    d = groupCard(tm, gi); what = `group-${tm.groups[gi]?.name ?? gi}`; hash += '/groups';
    msg = t('share.msgGroup', { g: tm.groups[gi]?.name ?? '', t: tm.name });
  } else if (k === 'match' && m) {
    d = matchCard(tm, m); what = 'match'; hash += `/m/${m.id}`;
    if (d?.kind === 'match') msg = t('share.msgMatch', { a: d.a.name, b: d.b.name, x: d.gamesA, y: d.gamesB, t: tm.name });
  }
  if (!d) return;
  void openShare(d, fileName(tm, what), msg, pageLink(hash), texts());
}
