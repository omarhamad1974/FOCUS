/** Admin "remove any account": filters, search and what goes with a deleted account. */
import { isAdminProfile, isOrganizer, isTempAccount, type RoleHolder } from './bulk';

export interface Person extends RoleHolder {
  full_name: string;
  phone?: string | null;
  club?: string | null;
  is_hall?: boolean;
}

export type PeopleFilter = 'all' | 'player' | 'organizer' | 'seller' | 'trainer' | 'hall' | 'temp' | 'sim';
export const PEOPLE_FILTERS: PeopleFilter[] = ['all', 'player', 'organizer', 'seller', 'trainer', 'hall', 'temp', 'sim'];

/** Roles an account holds beyond playing (the admin role is never listed: admins are never shown). */
export function rolesOf(p: Person): ('organizer' | 'seller' | 'trainer' | 'hall')[] {
  const r: ('organizer' | 'seller' | 'trainer' | 'hall')[] = [];
  if (isOrganizer(p)) r.push('organizer');
  if (p.is_seller) r.push('seller');
  if (p.is_trainer) r.push('trainer');
  if (p.is_hall) r.push('hall');
  return r;
}

/** Every account the admin may delete: never an admin, never the admin's own account. */
export const deletable = (people: Person[], myId: string | undefined) => people.filter((p) => p.id !== myId && !isAdminProfile(p));

export function matchesFilter(p: Person, f: PeopleFilter, sim: Set<string>): boolean {
  switch (f) {
    case 'all': return true;
    case 'player': return rolesOf(p).length === 0;
    case 'temp': return rolesOf(p).length === 0 && isTempAccount(p);
    case 'sim': return sim.has(p.id);
    default: return rolesOf(p).includes(f);
  }
}

/** Arabic-friendly match: ignores hamza/taa-marbuta/yaa forms, spaces and case; digits match the mobile. */
export function norm(s: string): string {
  return s.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْ]/g, '').replace(/\s+/g, ' ').trim();
}

export function matchesQuery(p: Person, q: string): boolean {
  const needle = norm(q);
  if (!needle) return true;
  const digits = q.replace(/\D/g, '');
  if (digits.length >= 3 && (p.phone ?? '').replace(/\D/g, '').includes(digits)) return true;
  return norm(`${p.full_name} ${p.club ?? ''}`).includes(needle);
}

export function filterPeople(people: Person[], myId: string | undefined, f: PeopleFilter, q: string, sim: Set<string>): Person[] {
  return deletable(people, myId).filter((p) => matchesFilter(p, f, sim) && matchesQuery(p, q));
}

export interface Fallout {
  /** Tournaments they organize: kept and moved to the deleting admin. */
  tournaments: number;
  /** Shop products: deleted with the account. */
  products: number;
  sellers: number;
  trainers: number;
  halls: number;
}

/** What happens to things the chosen accounts own, for the confirm box. */
export function fallout(people: Person[], ids: string[], owned: { tournaments: { organizer_id: string }[]; products: { seller_id: string }[] }): Fallout {
  const chosen = new Set(ids);
  const picked = people.filter((p) => chosen.has(p.id));
  return {
    tournaments: owned.tournaments.filter((x) => chosen.has(x.organizer_id)).length,
    products: owned.products.filter((x) => chosen.has(x.seller_id)).length,
    sellers: picked.filter((p) => p.is_seller).length,
    trainers: picked.filter((p) => p.is_trainer).length,
    halls: picked.filter((p) => p.is_hall).length,
  };
}
