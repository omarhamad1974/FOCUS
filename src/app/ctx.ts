/** State and helpers shared by every page module. */
import { numberFmt, t, type MessageKey } from '../i18n/ar';
import { online } from '../config';
import * as remote from '../data/remote';
import { esc } from '../ui/util';

/* Online mode (Supabase): the signed-in user and their profile. */
export const session: { profile: remote.Profile | null; loading: boolean } = { profile: null, loading: online() };

const p = () => session.profile;
export const isAdmin = () => p()?.role === 'admin';

/* Journey simulator: an admin can look at the app as another kind of user. */
export type Preview = 'off' | 'guest' | 'player' | 'organizer' | 'assistant' | 'seller' | 'trainer';
export const PREVIEWS: Preview[] = ['guest', 'player', 'organizer', 'assistant', 'seller', 'trainer'];
export const preview = {
  get as(): Preview {
    try { return (localStorage.getItem('pingo.preview') as Preview) || 'off'; } catch { return 'off'; }
  },
  set as(v: Preview) {
    try { if (v === 'off') localStorage.removeItem('pingo.preview'); else localStorage.setItem('pingo.preview', v); } catch { /* ignore */ }
  },
};

/** The profile as the chosen preview would have it (null for a guest). */
export function previewProfile(real: remote.Profile, as: Preview): remote.Profile | null {
  if (as === 'guest') return null;
  return { ...real, role: 'player', is_organizer: as === 'organizer', is_seller: as === 'seller', is_trainer: as === 'trainer' };
}

/** Assistants this session may score for (tournament ids); filled after sign-in. */
export const assisting = new Set<string>();
export const isAssistantFor = (id: string) => assisting.has(id) || (rendering.preview === 'assistant');
/** Set while a page is drawn in preview. */
export const rendering: { preview: Preview } = { preview: 'off' };
/** Can this user manage tournaments at all? Offline everyone can. */
export const canOrganize = () => !online() || isAdmin() || p()?.role === 'organizer' || !!p()?.is_organizer;
export const isSeller = () => isAdmin() || !!p()?.is_seller;
export const isTrainer = () => isAdmin() || !!p()?.is_trainer;
/** News is managed by admins only. */
export const canWriteNews = () => online() && isAdmin();

let rerender: () => void = () => {};
export const setRender = (fn: () => void) => { rerender = fn; };
/** Draw the current page again. */
export const render = () => rerender();

export const n = (x: number) => numberFmt.format(x);
export const money = (x: number) => `${numberFmt.format(Math.round(x * 100) / 100)} ${t('shop.currency')}`;
export const hint = (key: MessageKey) => `<p class="hint">${esc(t(key))}</p>`;
export const val = (id: string) => ((document.getElementById(id) as HTMLInputElement | null)?.value ?? '').trim();
export const checked = (id: string) => !!(document.getElementById(id) as HTMLInputElement | null)?.checked;
export const authErr = (e: unknown) => t(`auth.err.${remote.errorCode(e)}` as MessageKey);
export const loading = () => `<div class="card center muted"><span class="spin"></span> ${t('reg.loading')}</div>`;

/** Ask a signed-out visitor to sign in, then bring them back here. */
export function needLogin(msgKey: MessageKey): string {
  return `<div class="card center"><p>${t(msgKey)}</p><a class="btn gold" href="#/login" data-return="${esc(location.hash)}">${t('auth.login')}</a></div>`;
}
