/** Admin bulk delete: which accounts lose only a role and which are removed entirely. */

export type BulkRole = 'organizer' | 'seller' | 'trainer' | 'player';
export const BULK_ROLES: BulkRole[] = ['organizer', 'seller', 'trainer', 'player'];

export interface RoleHolder {
  id: string;
  role: string;
  is_organizer?: boolean;
  is_seller?: boolean;
  is_trainer?: boolean;
  /** Old-style batch account still waiting for its claim code (0011). */
  is_temp?: boolean;
  /** Still on the starting password "pingo123" (0014): batch players who never signed in. */
  must_change_password?: boolean;
}

export const isOrganizer = (p: RoleHolder) => p.role === 'organizer' || !!p.is_organizer;
export const isAdminProfile = (p: RoleHolder) => p.role === 'admin';

/** Extra roles the account holds (admin not included). */
export function extraRoles(p: RoleHolder): Exclude<BulkRole, 'player'>[] {
  const r: Exclude<BulkRole, 'player'>[] = [];
  if (isOrganizer(p)) r.push('organizer');
  if (p.is_seller) r.push('seller');
  if (p.is_trainer) r.push('trainer');
  return r;
}

/** Does this account belong in the list for `role`? Admins never appear, so they can never be deleted here.
 * "Players" are accounts with no extra role (everyone else is also a player, but is listed under their role). */
export function holdsRole(p: RoleHolder, role: BulkRole): boolean {
  if (isAdminProfile(p)) return false;
  return role === 'player' ? extraRoles(p).length === 0 : extraRoles(p).includes(role);
}

export interface RolePlan {
  /** Accounts removed completely (they have no other role left). */
  deleteAccounts: string[];
  /** Accounts that keep their account and their other roles, and only lose `role`. */
  removeRole: string[];
}

/** Plan removing `role` from the chosen accounts. Admins and `myId` are always left alone. */
export function planRoleRemoval(people: RoleHolder[], role: BulkRole, ids: Iterable<string>, myId: string | undefined): RolePlan {
  const chosen = new Set(ids);
  const plan: RolePlan = { deleteAccounts: [], removeRole: [] };
  for (const p of people) {
    if (!chosen.has(p.id) || p.id === myId || !holdsRole(p, role)) continue;
    const others = extraRoles(p).filter((r) => r !== role);
    if (role !== 'player' && others.length) plan.removeRole.push(p.id);
    else plan.deleteAccounts.push(p.id);
  }
  return plan;
}

/** The profile fields to clear when an account loses `role` but stays. */
export function roleOff(role: Exclude<BulkRole, 'player'>, p: RoleHolder): Record<string, unknown> {
  if (role === 'organizer') return p.role === 'organizer' ? { is_organizer: false, role: 'player' } : { is_organizer: false };
  return role === 'seller' ? { is_seller: false } : { is_trainer: false };
}

/** A batch-added player nobody has taken over yet: still on the claim code or the starting password. */
export const isTempAccount = (p: RoleHolder) => holdsRole(p, 'player') && (!!p.is_temp || !!p.must_change_password);

/** The word the admin types to confirm a bulk delete. */
export const CONFIRM_WORD = 'حذف';
export const confirmed = (typed: string) => typed.trim() === CONFIRM_WORD;
