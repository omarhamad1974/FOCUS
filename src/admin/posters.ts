/**
 * Admin's launch posters (#/desk/admin/posters[/<which>]): pick one of the four
 * online posters or the coming soon page, then copy, share or open its public link.
 */
import { t, type MessageKey } from '../i18n/ar';
import { icon } from '../ui/icons';
import { esc, toast } from '../ui/util';
import { FOR_WHO, JOIN_ROLES, PAGES, launchUrl, posterCard, type JoinRole } from '../pages/join';

type Pick = JoinRole | 'soon';
const PICKS: Pick[] = [...JOIN_ROLES, 'soon'];

const nameOf = (x: Pick) => (x === 'soon' ? t('pst.soonTitle' as MessageKey) : FOR_WHO[x]);
const shareText = (x: Pick) => (x === 'soon' ? t('pst.soonShare' as MessageKey)
  : t('pst.shareText' as MessageKey, { who: FOR_WHO[x], title: PAGES[x].title }));

function thumb(x: Pick, on: boolean): string {
  const inner = x === 'soon'
    ? `<div class="pst-soon-thumb"><span class="pst-soon-ball"></span>${icon('spark', 40)}<b>${t('pst.soonTitle' as MessageKey)}</b><small>${t('pst.soonText' as MessageKey)}</small></div>`
    : `<div class="pst-scale">${posterCard(x, true)}</div>`;
  return `<a class="pst-pick${on ? ' on' : ''}" href="#/desk/admin/posters/${x}" ${on ? 'aria-current="true"' : ''}>
    <span class="pst-thumb">${inner}</span><b>${nameOf(x)}</b></a>`;
}

export function page(which?: string): string {
  const sel: Pick = PICKS.includes(which as Pick) ? (which as Pick) : 'player';
  const url = launchUrl(sel);
  const wa = `https://wa.me/?text=${encodeURIComponent(`${shareText(sel)}\n${url}`)}`;
  return `<section class="banner b-admin slim"><div><h1>${icon('image', 26)} ${t('pst.title' as MessageKey)}</h1><p>${t('pst.hint' as MessageKey)}</p></div></section>
  <div class="card pst-share-card">
    <h2>${x(sel)} ${esc(nameOf(sel))}</h2>
    <label class="field"><span>${t('pst.link' as MessageKey)}</span>
      <input class="input" id="pstUrl" dir="ltr" readonly value="${esc(url)}" data-act="dk-pst-select"></label>
    <div class="row wrap">
      <button class="btn green" type="button" data-act="dk-pst-copy" data-url="${esc(url)}">${icon('check', 18)} ${t('pst.copy' as MessageKey)}</button>
      <button class="btn soft" type="button" data-act="dk-pst-share" data-url="${esc(url)}" data-text="${esc(shareText(sel))}">${icon('spark', 18)} ${t('pst.share' as MessageKey)}</button>
      <a class="btn soft" href="${esc(wa)}" target="_blank" rel="noopener">${icon('whatsapp', 18)} ${t('pst.whatsapp' as MessageKey)}</a>
      <a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener">${icon('eye', 18)} ${t('pst.open' as MessageKey)}</a>
    </div>
  </div>
  <div class="pst-picks">${PICKS.map((p) => thumb(p, p === sel)).join('')}</div>`;
}

const x = (p: Pick) => icon(p === 'soon' ? 'spark' : PAGES[p].icon, 22);

async function copy(url: string): Promise<void> {
  try { await navigator.clipboard.writeText(url); toast(t('pst.copied' as MessageKey)); return; } catch { /* fall back below */ }
  const input = document.getElementById('pstUrl') as HTMLInputElement | null;
  input?.select();
  try { document.execCommand('copy'); toast(t('pst.copied' as MessageKey)); } catch { /* the link stays selected for a manual copy */ }
}

export async function onClick(act: string, el: HTMLElement): Promise<boolean> {
  const url = el.dataset.url ?? '';
  if (act === 'dk-pst-copy') { await copy(url); return true; }
  if (act === 'dk-pst-share') {
    if (navigator.share) { try { await navigator.share({ title: 'Pingo', text: el.dataset.text ?? '', url }); } catch { /* closed */ } }
    else await copy(url);
    return true;
  }
  if (act === 'dk-pst-select') { (el as HTMLInputElement).select(); return true; }
  return false;
}
