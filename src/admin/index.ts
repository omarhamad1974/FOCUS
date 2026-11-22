/**
 * The role tools ("مكتب بينجو"): a back office apart from the public site, one
 * area per role at #/desk/org, #/desk/trainer, #/desk/seller and #/desk/admin.
 * main.ts hands over every #/desk page and every data-act starting with "dk-".
 */
import { t } from '../i18n/ar';
import { session } from '../app/ctx';
import { empty } from '../ui/art';
import { deskShell, rolesHeld, type DeskRole } from './shell';
import * as organizer from './organizer';
import * as trainer from './trainer';
import * as seller from './seller';
import * as adminDesk from './adminDesk';
import * as bio from './bio';
import * as subs from './subs';
import * as posters from './posters';
import * as lists from '../pages/playerLists';
import * as hall from './hall';
import * as paySettings from './paySettings';
import * as payUi from '../ui/pay';

export { setHost } from './host';

const roleOf = (parts: string[]): DeskRole | null => {
  const r = parts[1] as DeskRole;
  return r === 'org' || r === 'trainer' || r === 'seller' || r === 'hall' || r === 'admin' ? r : null;
};
const current = () => roleOf(location.hash.replace(/^#\/?/, '').split('/'));

/** Page HTML for #/desk/…, or a redirect (returns null after changing the hash). */
export function page(parts: string[]): string | null {
  if (session.loading) return `<main class="page desk"><div class="card center muted"><span class="spin"></span> ${t('sync.loading')}</div></main>`;
  if (!session.profile) { location.hash = '#/login'; return null; }
  const held = rolesHeld();
  const role = roleOf(parts);
  if (!role || !held.includes(role)) {
    if (held.length) { location.hash = `#/desk/${held.includes('admin') && !role ? 'admin' : held[0]}`; return null; }
    return deskShell('org', empty('shield', t('desk.noRole'), `<a class="btn gold small" href="#/me">${t('desk.askRole')}</a>`));
  }
  let body = role === 'org' ? (parts[2] === 'players' ? lists.orgPage() : organizer.page(parts)) : role === 'trainer' ? trainer.page() : role === 'seller' ? seller.page() : role === 'hall' ? hall.page()
    : parts[2] === 'subs' ? subs.adminPage() : parts[2] === 'posters' ? posters.page(parts[3]) : parts[2] === 'blacklist' ? lists.adminPage() : adminDesk.page();
  // Subscription status, payment methods and the optional biography for every provider, on each tool's front page.
  if (role !== 'admin' && !parts[2]) body = body.replace('</section>', () => `</section>${subs.card(role)}${paySettings.card(role)}${bio.card()}`);
  return deskShell(role, body, { org: organizer.pendingCount() });
}

export async function onClick(act: string, el: HTMLElement): Promise<boolean> {
  const role = current();
  if (act.startsWith('dk-bio-')) return bio.onClick(act);
  if (act.startsWith('dk-sub-')) return subs.onClick(act, el);
  if (act.startsWith('dk-pst-')) return posters.onClick(act, el);
  if (act.startsWith('dk-ps-')) return paySettings.onClick(act, el);
  if (act === 'dk-new-open' && role !== 'org') { location.hash = '#/desk/org'; return organizer.onClick(act, el); }
  if (role === 'org') return organizer.onClick(act, el);
  if (role === 'trainer') return trainer.onClick(act, el);
  if (role === 'seller') return seller.onClick(act, el);
  if (role === 'hall') return hall.onClick(act, el);
  return false;
}

export async function onChange(el: HTMLInputElement): Promise<boolean> {
  if (el.dataset.act?.startsWith('dk-sub-')) return subs.onChange(el);
  if (el.dataset.act?.startsWith('pay-')) return payUi.onChange(el);
  const role = current();
  if (role === 'org') return organizer.onChange(el);
  if (role === 'trainer') return trainer.onChange(el);
  if (role === 'seller') return seller.onChange(el);
  if (role === 'hall') return hall.onChange(el);
  return false;
}

export const onSubmit = async (kind: string) => (kind.startsWith('dk-sub-') ? subs.onSubmit(kind) : kind.startsWith('dk-ps-') ? paySettings.onSubmit(kind)
  : kind.startsWith('dk-hl-') ? hall.onSubmit(kind) : organizer.onSubmit(kind));

/** Forget loaded data (after sign-in changes or a refresh). */
export function reset(): void { organizer.reset(); trainer.reset(); seller.reset(); subs.reset(); hall.reset(); paySettings.reset(); payUi.forget(); }
