import './ui/styles.css';
import { dateFmt, dateTimeFmt, numberFmt, t, type MessageKey } from './i18n/ar';
import { load, parseBackup, save, type AppData } from './domain/storage';
import {
  createTournament, duplicateTournament, groupName, groupMatches, groupStandings, groupsComplete, movePlayer,
  playerName, progress, saveResult, snakeGroups, startGroups, startKnockout, uid,
} from './domain/tournament';
import { canEditKo, isBye, placements, roundName } from './domain/bracket';
import { checkGame, gamesToWin, summarize, type MatchCheck } from './domain/scoring';
import { sampleNames, sampleTournament, type SampleLevel } from './domain/sample';
import type { BestOf, Bracket, Game, Match, StageFormats, Tournament } from './domain/types';
import { avatar, confetti, esc, groupColor, toast } from './ui/util';

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
const isOrg = () => prefs.view === 'organizer';

function persist(): void {
  if (!save(data)) toast(t('common.storageFull'));
}

function findT(id: string): Tournament | undefined {
  return data.tournaments.find((x) => x.id === id);
}

const app = document.getElementById('app')!;

/* ---------------------------------------------------------------- helpers */

const n = (x: number) => numberFmt.format(x);
const hint = (key: MessageKey) => `<p class="hint">${esc(t(key))}</p>`;
const bo = (b: BestOf) => t('format.bestOf', { n: b });

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

/* ------------------------------------------------------------------ shell */

function shell(content: string): void {
  const v = prefs.view;
  document.body.classList.toggle('no-hints', !prefs.hints);
  app.innerHTML = `
  <header class="top">
    <a class="brand" href="#/"><span class="ball"></span>${t('app.name')}</a>
    <span class="spacer"></span>
    <div class="switch" role="group" aria-label="${esc(t('view.hint'))}" title="${esc(t('view.hint'))}">
      <button data-act="view" data-v="player" aria-pressed="${v === 'player'}">🎾 ${t('view.player')}</button>
      <button data-act="view" data-v="organizer" aria-pressed="${v === 'organizer'}">🛠️ ${t('view.organizer')}</button>
    </div>
    <button class="helpbtn" data-act="hints" aria-pressed="${prefs.hints}" title="${t('common.help')}" aria-label="${t('common.help')}">؟</button>
  </header>
  <main>${content}</main>`;
}

/* ------------------------------------------------------------------- home */

function homePage(): string {
  const ts = data.tournaments;
  const players = ts.reduce((s, x) => s + x.players.length, 0);
  const done = ts.reduce((s, x) => s + Object.values(x.matches).filter((m) => summarize(m).winner && m.aId && m.bId).length, 0);
  const tiles = ts.map((tm) => {
    const p = progress(tm);
    const st = stageIndex(tm);
    const badge = ['blue', 'green', 'red', 'gold'][st];
    const labels: MessageKey[] = ['stage.setup', 'stage.groups', 'stage.knockout', 'stage.champion'];
    const champ = st === 3 ? placements(tm.brackets[0], tm.matches)[0] : null;
    return `<a class="card tile" href="#/t/${tm.id}">
      <div class="row between"><h3>${esc(tm.name)}</h3><span class="badge ${badge}">${t(labels[st])}</span></div>
      <div class="muted small">${tm.date ? dateFmt.format(new Date(tm.date)) : ''} · ${n(tm.players.length)} ${t('t.players')} · ${n(tm.groups.length)} ${t('t.groupsCount')}</div>
      ${champ ? `<div class="row" style="margin-block-start:6px">🏆 <b>${esc(playerName(tm, champ.playerId))}</b></div>` : ''}
      ${xp(p.done, p.total)}
    </a>`;
  }).join('');

  const org = isOrg();
  return `
  <section class="hero">
    <h1>${t('app.name')} 🏓</h1>
    <p class="muted">${t('app.tagline')}</p>
    ${org ? `<div class="row" style="margin-block-start:12px">
      <a class="btn gold" href="#/new">➕ ${t('home.create')}</a>
      <button class="btn soft" data-act="sample-open">🎲 ${t('home.sample')}</button>
    </div>` : ''}
  </section>
  <div class="stats" style="margin-block:14px">
    <div class="stat"><b>${n(ts.length)}</b><small>${t('home.statTournaments')}</small></div>
    <div class="stat"><b>${n(players)}</b><small>${t('home.statPlayers')}</small></div>
    <div class="stat"><b>${n(done)}</b><small>${t('home.statMatches')}</small></div>
  </div>
  ${org ? samplePanel() : ''}
  <h2 style="margin-block:18px 4px">${t('home.title')}</h2>
  ${ts.length ? `<div class="grid">${tiles}</div>` : `<div class="card center muted">${t(org ? 'home.empty' : 'home.emptyPlayer')}</div>`}
  ${org ? `<div class="card">
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
    <div class="stack">${levels.map((l) => `<button class="btn soft block" data-act="sample" data-level="${l}">${t(`home.sample.${l}` as MessageKey)}</button>`).join('')}</div>
  </div>`;
}

/* ----------------------------------------------------------------- wizard */

interface Draft {
  step: number;
  name: string;
  date: string;
  players: string;
  groupCount: number;
  formats: StageFormats;
  consolation: { enabled: boolean; name: string };
  error: string;
}

const newDraft = (): Draft => ({
  step: 0,
  name: '',
  date: new Date().toISOString().slice(0, 10),
  players: '',
  groupCount: 4,
  formats: { group: 3, early: 3, semi: 5, final: 5 },
  consolation: { enabled: true, name: 'بطولة الترضية' },
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
        <input class="input" id="wDate" type="date" value="${esc(draft.date)}"></label>`;
  } else if (s === 1) {
    body = `
      <label class="field"><span>👥 ${t('wizard.players')} <span class="badge blue" id="wCount">${n(draftNames().length)} ${t('wizard.count')}</span></span>
        ${hint('wizard.playersHint')}
        <textarea class="input" id="wPlayers" placeholder="${esc(t('wizard.playersPh'))}" dir="auto">${esc(draft.players)}</textarea></label>
      <button class="btn soft small" data-act="w-fill">🎲 ${t('wizard.fillSample')}</button>`;
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
  if (v('wPlayers')) draft.players = (v('wPlayers') as unknown as HTMLTextAreaElement).value;
  if (v('wCons')) draft.consolation.enabled = v('wCons')!.checked;
  if (v('wConsName')) draft.consolation.name = v('wConsName')!.value;
}

function validateDraft(step: number): string {
  if (step === 0 && !draft.name.trim()) return t('wizard.errName');
  if (step >= 1) {
    const names = draftNames();
    if (names.length < 2) return t('wizard.errPlayers');
    if (new Set(names).size !== names.length) return t('wizard.errDup');
  }
  if (step >= 2 && draftNames().length < draft.groupCount * 2) return t('wizard.errPlayers');
  return '';
}

/* ------------------------------------------------------------- tournament */

type Tab = 'groups' | 'matches' | 'knockout' | 'settings';

function tournamentPage(tm: Tournament, tab: Tab): string {
  const p = progress(tm);
  const tabs: [Tab, MessageKey][] = [['groups', 't.tab.groups'], ['matches', 't.tab.matches'], ['knockout', 't.tab.knockout']];
  if (isOrg()) tabs.push(['settings', 't.tab.settings']);
  let body = '';
  if (tab === 'groups') body = tm.stage === 'setup' ? setupBoard(tm) : groupsView(tm);
  else if (tab === 'matches') body = matchesView(tm);
  else if (tab === 'knockout') body = knockoutView(tm);
  else body = settingsView(tm);
  return `
  <section class="hero">
    <h1>${esc(tm.name)}</h1>
    <p class="muted">${tm.date ? dateFmt.format(new Date(tm.date)) : ''} · ${n(tm.players.length)} ${t('t.players')}</p>
    ${stagePath(tm)}
    <div class="row between small" style="margin-block-start:10px"><span>${t('t.progress')}</span><span>${n(p.done)} / ${n(p.total)}</span></div>
    ${xp(p.done, p.total)}
  </section>
  <nav class="tabs" style="margin-block:14px 4px">${tabs.map(([k, l]) => `<a href="#/t/${tm.id}/${k}" ${k === tab ? 'aria-current="page"' : ''}>${t(l)}</a>`).join('')}</nav>
  ${body}`;
}

/* Setup: drag-and-drop group board */
let selectedChip: string | null = null;

function setupBoard(tm: Tournament): string {
  const org = isOrg();
  const seedOf = (id: string) => tm.players.findIndex((p) => p.id === id) + 1;
  const cols = tm.groups.map((g, i) => `
    <div class="gcol ${selectedChip ? 'target' : ''}" data-gid="${g.id}" ${org ? `tabindex="0" data-act="drop-here"` : ''} aria-label="${t('setup.group')} ${esc(g.name)}">
      <h3><span class="gletter" style="background:${groupColor(i)}">${esc(g.name)}</span> ${t('setup.group')} ${esc(g.name)}
        <span class="badge" style="margin-inline-start:auto">${n(g.playerIds.length)}</span></h3>
      ${g.playerIds.map((pid) => `
        <div class="chip ${org ? '' : 'ro'} ${selectedChip === pid ? 'sel' : ''}" data-pid="${pid}" ${org ? `tabindex="0" role="button" data-act="chip"` : ''}>
          ${org ? '<span class="grip" aria-hidden="true">⋮⋮</span>' : ''}${avatar(playerName(tm, pid))}<span dir="auto">${esc(playerName(tm, pid))}</span>
          <span class="seed">#${n(seedOf(pid))}</span>
        </div>`).join('')}
    </div>`).join('');
  return `
  <div class="card">
    <div class="row between"><h2>🧩 ${t('setup.title')}</h2>
      ${org ? `<button class="btn soft small" data-act="reshuffle">🔀 ${t('setup.reshuffle')}</button>` : ''}</div>
    ${org ? hint('setup.hint') : ''}
    <div class="board" id="board">${cols}</div>
  </div>
  ${org ? `<div class="card">
    ${hint('setup.startHint')}
    <button class="btn green block" data-act="start-groups">▶️ ${t('setup.start')}</button>
  </div>` : ''}`;
}

function standingsTable(tm: Tournament, gi: number): string {
  const g = tm.groups[gi];
  const s = groupStandings(tm, g);
  const rows = s.rows.map((r) => {
    const cls = r.rank <= 2 ? 'q' : r.rank <= 4 && tm.consolation.enabled ? 'c' : '';
    const pct = r.played ? Math.round((r.wins / r.played) * 100) : 0;
    const tb = r.tiebreak !== 'none' ? `<span class="badge ${r.tiebreak === 'unresolved' ? 'red' : 'blue'}" style="font-size:10px">${t(`tiebreak.${r.tiebreak}` as MessageKey)}</span>` : '';
    return `<tr class="${cls}">
      <td><span class="rank r${r.rank}">${n(r.rank)}</span></td>
      <td class="name"><div class="row" style="gap:6px;flex-wrap:nowrap">${avatar(playerName(tm, r.playerId))}<span dir="auto">${esc(playerName(tm, r.playerId))}</span> ${tb}</div>
        <div class="winbar" title="${t('stats.winRate')} ${pct}%"><span style="width:${pct}%"></span></div></td>
      <td>${n(r.played)}</td><td>${n(r.wins)}</td><td>${n(r.losses)}</td>
      <td class="hide-sm">${pair(n(r.gamesWon), n(r.gamesLost), ':')}</td>
      <td class="hide-sm">${pair(n(r.pointsWon), n(r.pointsLost), ':')}</td>
      <td><b>${n(r.points)}</b></td>
    </tr>`;
  }).join('');
  const ties = s.unresolved.length ? tieResolver(tm, gi, s.unresolved) : '';
  return `
  <div class="card">
    <h3><span class="gletter" style="background:${groupColor(gi)};display:inline-grid;margin-inline-end:6px">${esc(g.name)}</span>${t('setup.group')} ${esc(g.name)}</h3>
    <div class="table-wrap"><table class="standings">
      <thead><tr><th>${t('standings.rank')}</th><th class="name">${t('standings.player')}</th><th>${t('standings.played')}</th><th>${t('standings.won')}</th><th>${t('standings.lost')}</th>
      <th class="hide-sm">${t('standings.games')}</th><th class="hide-sm">${t('standings.points')}</th><th>${t('standings.pts')}</th></tr></thead>
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
        <span class="rank">${n(i + 1)}</span>${avatar(playerName(tm, pid))}<span dir="auto">${esc(playerName(tm, pid))}</span>
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
    ${tm.consolation.enabled ? `<span><i style="background:var(--warn)"></i>${t('standings.consolation')} · ${esc(tm.consolation.name)}</span>` : ''}</div>`;
  const ready = groupsComplete(tm);
  const startKo = isOrg() && tm.stage === 'groups' ? `<div class="card">
    ${hint('ko.startHint')}
    <button class="btn green block" data-act="start-ko" ${ready ? '' : 'disabled'}>⚔️ ${t('ko.start')}</button>
    ${ready ? '' : `<p class="muted small center">${t('ko.notReady')}</p>`}
  </div>` : '';
  return `${hint('standings.hint')}${legend}
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
  const meta = [label, bo(m.bestOf), m.walkover ? `🚩 ${t('matches.walkover')}` : '', m.history.length ? `✏️ ${n(m.history.length)}` : '']
    .filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('');
  return `<a class="match" href="#/t/${tm.id}/m/${m.id}">
    <span class="p ${s.winner === 'a' ? 'win' : ''}" dir="auto">${esc(a)}</span>
    <span class="sc ${done ? '' : 'pending'}">${done ? scoreText(m) : (isOrg() ? t('matches.enter') : t('matches.pending'))}</span>
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
      <div class="row between"><h3><span class="gletter" style="background:${groupColor(i)};display:inline-grid;margin-inline-end:6px">${esc(g.name)}</span>${t('setup.group')} ${esc(g.name)}</h3>
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
    return `<div class="step p${p}"><span class="medal">${medal}</span><div class="nm" dir="auto">${x ? esc(playerName(tm, x.playerId)) : '…'}</div><div class="block">${n(p)}</div></div>`;
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
    <label class="field"><span>${t('wizard.consolationName')}</span><input class="input" id="setCons" value="${esc(tm.consolation.name)}"></label>
    <button class="btn small" data-act="set-save">💾 ${t('common.save')}</button>
  </div>
  <div class="card">
    <h3>🎯 ${t('wizard.formats')}</h3>
    ${locked ? `<p class="muted small">🔒 ${t('settings.formatsLocked')}</p>` : hint('wizard.formatsHint')}
    ${(['group', 'early', 'semi', 'final'] as const).map(row).join('')}
  </div>
  <div class="card">
    <h3>📄 ${t('settings.duplicate')}</h3>
    ${hint('settings.duplicateHint')}
    <button class="btn soft" data-act="duplicate">📄 ${t('settings.duplicate')}</button>
  </div>
  <div class="card">
    <button class="btn red" data-act="delete">🗑️ ${deleteArmed ? t('settings.deleteConfirm') : t('settings.delete')}</button>
  </div>`;
}

/* ------------------------------------------------------------ score entry */

interface ScoreDraft { matchId: string; games: { a: string; b: string }[]; error: string }
let sd: ScoreDraft | null = null;

function parseGames(d: ScoreDraft): Game[] {
  return d.games.map((g) => ({ a: g.a === '' ? NaN : Number(g.a), b: g.b === '' ? NaN : Number(g.b) }));
}

function errorText(c: MatchCheck): string {
  if (c.ok) return '';
  if (c.error === 'game') return t(`score.err.${c.reason}` as MessageKey, { n: c.index + 1 });
  return t(`score.err.${c.error}` as MessageKey);
}

function scorePage(tm: Tournament, m: Match): string {
  const org = isOrg();
  const a = playerName(tm, m.aId), b = playerName(tm, m.bId);
  const bracket = m.bracketId ? tm.brackets.find((x) => x.id === m.bracketId) : undefined;
  const locked = (m.stage === 'group' && tm.stage !== 'groups') || (bracket && !canEditKo(m, bracket, tm.matches));
  const where = m.stage === 'group'
    ? `${t('setup.group')} ${tm.groups.find((g) => g.id === m.groupId)?.name ?? ''}`
    : `${bracket?.kind === 'main' ? t('ko.main') : bracket?.name} · ${t(`ko.round.${roundName(m.round!, bracket!.rounds.length)}` as MessageKey)}`;
  const back = `<a class="btn soft small" href="#/t/${tm.id}/${m.stage === 'group' ? 'matches' : 'knockout'}">→ ${esc(tm.name)}</a>`;

  if (!sd || sd.matchId !== m.id) {
    const start = m.games.length ? m.games.map((g) => ({ a: String(g.a), b: String(g.b) })) : Array.from({ length: gamesToWin(m.bestOf) }, () => ({ a: '', b: '' }));
    sd = { matchId: m.id, games: start, error: '' };
  }
  const games = parseGames(sd);
  const live = summarize({ games: games.filter((g) => checkGame(g) === 'ok'), bestOf: m.bestOf, walkover: null });
  const saved = summarize(m);
  const board = `<div class="scoreboard">
    <div class="nm" dir="auto"><span class="paddle" style="background:var(--red)"></span>${esc(a)}</div>
    <div class="big">${org && !locked ? pair(live.gamesA, live.gamesB) : pair(saved.gamesA, saved.gamesB)}</div>
    <div class="nm" dir="auto"><span class="paddle" style="background:var(--blue)"></span>${esc(b)}</div>
  </div>`;

  const history = m.history.length ? `<div class="card"><h3>🕓 ${t('score.history')}</h3>${hint('score.historyHint')}
    ${m.history.map((h) => `<div class="row small"><span class="muted">${dateTimeFmt.format(new Date(h.at))}</span>
      <span>${h.walkover ? `${t('matches.walkover')} (${h.walkover === 'a' ? esc(a) : esc(b)})` : gamesList(h.games)}</span></div>`).join('')}
  </div>` : '';

  if (!org || locked) {
    return `<div class="row" style="margin-block-end:10px">${back}</div>
      <div class="card"><div class="muted small" style="margin-block-end:8px">${esc(where)} · ${bo(m.bestOf)}</div>${board}
      ${m.games.length ? `<p class="center">${gamesList(m.games)}</p>` : ''}
      ${m.walkover ? `<p class="center">🚩 ${t('matches.walkover')}</p>` : ''}
      ${!org ? `<p class="muted small center">👀 ${t('score.readonly')}</p>` : `<div class="err">🔒 ${t(m.stage === 'ko' ? 'score.locked' : 'score.err.locked')}</div>`}
      </div>${history}`;
  }

  const rows = sd.games.map((g, i) => {
    const st = checkGame(games[i]);
    const cls = g.a === '' && g.b === '' ? '' : st === 'ok' ? 'ok' : 'bad';
    const pts = (side: 'a' | 'b') => `<span class="pts">
      <button data-act="pt" data-i="${i}" data-s="${side}" data-d="-1" aria-label="-1">−</button>
      <input inputmode="numeric" pattern="[0-9]*" data-act="gin" data-i="${i}" data-s="${side}" value="${esc(g[side])}" aria-label="${t('score.game')} ${i + 1} ${side === 'a' ? esc(a) : esc(b)}">
      <button data-act="pt" data-i="${i}" data-s="${side}" data-d="1" aria-label="+1">+</button></span>`;
    return `<div class="gamerow ${cls}"><span class="n">${t('score.game')} ${n(i + 1)}</span>${pts('a')}<span class="dash">:</span>${pts('b')}
      <span class="st">${cls === 'ok' ? '✅' : cls === 'bad' ? '⚠️' : ''}</span></div>
      <div class="quick">
        <button class="btn soft small" data-act="quick" data-i="${i}" data-s="a">🔴 11 ${t('score.wins')}</button>
        <button class="btn soft small" data-act="quick" data-i="${i}" data-s="b">🔵 11 ${t('score.wins')}</button>
      </div>`;
  }).join('');

  return `<div class="row" style="margin-block-end:10px">${back}</div>
  <div class="card">
    <div class="row between"><h2>🎯 ${t('score.title')}</h2><span class="badge blue">${bo(m.bestOf)}</span></div>
    <div class="muted small" style="margin-block:4px 10px">${esc(where)}</div>
    ${board}
    ${hint('score.hint')}
    ${rows}
    <div class="row">
      ${sd.games.length < m.bestOf ? `<button class="btn soft small" data-act="add-game">➕ ${t('score.addGame')}</button>` : ''}
      ${sd.games.length > 1 ? `<button class="btn ghost small" data-act="rm-game">➖ ${t('score.removeGame')}</button>` : ''}
    </div>
    ${sd.error ? `<div class="err" role="alert">${esc(sd.error)}</div>` : ''}
    <button class="btn green block" data-act="save-score" style="margin-block-start:12px">💾 ${t('score.save')}</button>
  </div>
  <div class="card">
    <h3>🚩 ${t('score.walkover')}</h3>
    ${hint('score.walkoverHint')}
    <div class="row">
      <button class="btn soft" data-act="walkover" data-s="a" dir="auto">${esc(a)}</button>
      <button class="btn soft" data-act="walkover" data-s="b" dir="auto">${esc(b)}</button>
    </div>
  </div>
  ${history}`;
}

/* ------------------------------------------------------------------ router */

function route(): void {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'new') {
    if (!isOrg()) { location.hash = '#/'; return; }
    shell(wizardPage());
  } else if (parts[0] === 't') {
    const tm = findT(parts[1]);
    if (!tm) {
      shell(`<div class="card center"><p>${t('t.notFound')}</p><a class="btn" href="#/">${t('t.backHome')}</a></div>`);
    } else if (parts[2] === 'm' && tm.matches[parts[3]]) {
      shell(scorePage(tm, tm.matches[parts[3]]));
    } else {
      let tab = (parts[2] as Tab) || (tm.stage === 'knockout' ? 'knockout' : 'groups');
      if (tab === 'settings' && !isOrg()) tab = 'groups';
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
  const { tm, m } = current();

  switch (act) {
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
      const st = sampleTournament(el.dataset.level as SampleLevel, Date.now(), players, Math.min(groups, Math.floor(players / 2)));
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
      });
      data.tournaments.unshift(nt);
      persist();
      draft = newDraft();
      location.hash = `#/t/${nt.id}/groups`;
      return;
    }

    /* setup board */
    case 'chip':
      if (dragMoved) return;
      selectedChip = selectedChip === el.dataset.pid ? null : el.dataset.pid!;
      route();
      if (selectedChip) toast(t('setup.selected'));
      return;
    case 'drop-here':
      if (!tm || !selectedChip) return;
      movePlayer(tm, selectedChip, el.dataset.gid!);
      selectedChip = null;
      persist();
      route();
      return;
    case 'reshuffle':
      if (!tm) return;
      snakeGroups(tm.players.map((p) => p.id), tm.groups.length).forEach((ids, i) => (tm.groups[i].playerIds = ids));
      persist();
      route();
      return;
    case 'start-groups':
      if (!tm) return;
      try {
        startGroups(tm);
      } catch {
        toast(t('setup.errSmall'));
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
      if (cn) {
        tm.consolation.name = cn;
        tm.brackets.filter((b) => b.kind === 'consolation').forEach((b) => (b.name = cn));
      }
      persist();
      toast(t('settings.saved'));
      route();
      return;
    }
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
      persist();
      toast(t('settings.deleted'));
      location.hash = '#/';
      return;

    /* score entry */
    case 'pt': case 'quick': case 'add-game': case 'rm-game': {
      if (!sd || !m) return;
      syncInputs();
      const i = Number(el.dataset.i);
      const s = el.dataset.s as 'a' | 'b';
      if (act === 'pt') {
        const cur = Number(sd.games[i][s] || 0);
        sd.games[i][s] = String(Math.max(0, cur + Number(el.dataset.d)));
      } else if (act === 'quick') {
        const other = s === 'a' ? 'b' : 'a';
        const o = Number(sd.games[i][other] || 0);
        // 11 to the chosen side, keeping a deuce margin if the other score is 10+.
        sd.games[i][s] = String(o >= 10 ? o + 2 : 11);
      } else if (act === 'add-game') {
        if (sd.games.length < m.bestOf) sd.games.push({ a: '', b: '' });
      } else {
        sd.games.pop();
      }
      sd.error = '';
      route();
      return;
    }
    case 'save-score':
    case 'walkover': {
      if (!sd || !m || !tm) return;
      syncInputs();
      const games = parseGames(sd).filter((_, i) => !(sd!.games[i].a === '' && sd!.games[i].b === '') || i === 0);
      const res = act === 'walkover' ? saveResult(tm, m.id, [], el.dataset.s as 'a' | 'b') : saveResult(tm, m.id, games, null);
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
  document.querySelectorAll<HTMLInputElement>('input[data-act="gin"]').forEach((inp) => {
    sd!.games[Number(inp.dataset.i)][inp.dataset.s as 'a' | 'b'] = inp.value.replace(/[^\d]/g, '');
  });
}

document.addEventListener('input', (e) => {
  const el = e.target as HTMLElement;
  if (el.id === 'wPlayers') {
    const c = document.getElementById('wCount');
    draft.players = (el as HTMLTextAreaElement).value;
    if (c) c.textContent = `${n(draftNames().length)} ${t('wizard.count')}`;
  }
  if (el.dataset.act === 'gin' && sd) {
    syncInputs();
    // Update the row status without a full re-render to keep focus.
    const i = Number(el.dataset.i);
    const g = parseGames(sd)[i];
    const row = el.closest('.gamerow')!;
    const empty = sd.games[i].a === '' && sd.games[i].b === '';
    const ok = checkGame(g) === 'ok';
    row.classList.toggle('ok', !empty && ok);
    row.classList.toggle('bad', !empty && !ok);
    row.querySelector('.st')!.textContent = empty ? '' : ok ? '✅' : '⚠️';
    const live = summarize({ games: parseGames(sd).filter((x) => checkGame(x) === 'ok'), bestOf: current().m!.bestOf, walkover: null });
    const big = document.querySelector('.scoreboard .big');
    if (big) big.innerHTML = pair(live.gamesA, live.gamesB);
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target as HTMLInputElement;
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
    movePlayer(tm, d.pid, target.dataset.gid!, index === -1 ? undefined : index);
    persist();
  }
  selectedChip = null;
  route();
  setTimeout(() => (dragMoved = false), 0);
}

document.addEventListener('pointerup', () => endDrag(true));
document.addEventListener('pointercancel', () => endDrag(false));

window.addEventListener('hashchange', () => {
  window.scrollTo(0, 0);
  deleteArmed = false;
  route();
});
route();
