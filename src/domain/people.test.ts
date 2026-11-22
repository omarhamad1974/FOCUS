import { describe, expect, it } from 'vitest';
import { deletable, fallout, filterPeople, matchesQuery, rolesOf, type Person } from './people';

const P = (id: string, extra: Partial<Person> = {}): Person => ({ id, role: 'player', full_name: id, ...extra });
const people: Person[] = [
  P('me', { role: 'admin' }),
  P('boss', { role: 'admin' }),
  P('ahmed', { full_name: 'أحمد علي', phone: '01001234567' }),
  P('org', { role: 'organizer' }),
  P('org2', { is_organizer: true, is_seller: true }),
  P('seller', { is_seller: true }),
  P('coach', { is_trainer: true }),
  P('hall', { is_hall: true }),
  P('temp', { must_change_password: true }),
  P('sim01'),
];
const sim = new Set(['sim01']);

describe('admin remove accounts', () => {
  it('never lists admins or yourself', () => {
    const ids = deletable(people, 'me').map((p) => p.id);
    expect(ids).not.toContain('me');
    expect(ids).not.toContain('boss');
    expect(ids).toHaveLength(people.length - 2);
  });
  it('filters by role, temp and simulation', () => {
    const ids = (f: Parameters<typeof filterPeople>[2]) => filterPeople(people, 'me', f, '', sim).map((p) => p.id);
    expect(ids('organizer')).toEqual(['org', 'org2']);
    expect(ids('seller')).toEqual(['org2', 'seller']);
    expect(ids('hall')).toEqual(['hall']);
    expect(ids('player')).toEqual(['ahmed', 'temp', 'sim01']);
    expect(ids('temp')).toEqual(['temp']);
    expect(ids('sim')).toEqual(['sim01']);
  });
  it('searches Arabic names loosely and mobiles by digits', () => {
    const ahmed = people[2];
    expect(matchesQuery(ahmed, 'احمد')).toBe(true);
    expect(matchesQuery(ahmed, '1234')).toBe(true);
    expect(matchesQuery(ahmed, 'محمد')).toBe(false);
  });
  it('lists roles including hall owner', () => {
    expect(rolesOf(people[4])).toEqual(['organizer', 'seller']);
    expect(rolesOf(people[7])).toEqual(['hall']);
  });
  it('counts what goes with the chosen accounts', () => {
    const f = fallout(people, ['org', 'seller'], { tournaments: [{ organizer_id: 'org' }, { organizer_id: 'x' }], products: [{ seller_id: 'seller' }, { seller_id: 'seller' }] });
    expect(f).toEqual({ tournaments: 1, products: 2, sellers: 1, trainers: 0, halls: 0 });
  });
});
