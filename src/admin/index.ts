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

export { setHost } from './host';

const roleOf = (parts: string[]): DeskRole | null => {
  const r = parts[1] as DeskRole;
  return r === 'org' || r === 'trainer' || r === 'seller' || r === 'admin' ? r : null;
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
  const body = role === 'org' ? organizer.page(parts) : role === 'trainer' ? trainer.page() : role === 'seller' ? seller.page() : adminDesk.page();
  return deskShell(role, body, { org: organizer.pendingCount() });
}

export async function onClick(act: string, el: HTMLElement): Promise<boolean> {
  const role = current();
  if (act === 'dk-new-open' && role !== 'org') { location.hash = '#/desk/org'; return organizer.onClick(act, el); }
  if (role === 'org') return organizer.onClick(act, el);
  if (role === 'trainer') return trainer.onClick(act, el);
  if (role === 'seller') return seller.onClick(act, el);
  return false;
}

export async function onChange(el: HTMLInputElement): Promise<boolean> {
  const role = current();
  if (role === 'org') return organizer.onChange(el);
  if (role === 'trainer') return trainer.onChange(el);
  if (role === 'seller') return seller.onChange(el);
  return false;
}

export const onSubmit = (kind: string) => organizer.onSubmit(kind);

/** Forget loaded data (after sign-in changes or a refresh). */
export function reset(): void { organizer.reset(); trainer.reset(); seller.reset(); }
