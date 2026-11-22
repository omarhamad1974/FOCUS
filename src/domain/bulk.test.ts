import { describe, expect, it } from 'vitest';
import { confirmed, holdsRole, isTempAccount, planRoleRemoval, roleOff, type RoleHolder } from './bulk';

const people: RoleHolder[] = [
  { id: 'admin', role: 'admin', is_organizer: true, is_seller: true },
  { id: 'seller', role: 'player', is_seller: true },
  { id: 'sellTrain', role: 'player', is_seller: true, is_trainer: true },
  { id: 'oldOrg', role: 'organizer' },
  { id: 'orgSeller', role: 'organizer', is_organizer: true, is_seller: true },
  { id: 'player', role: 'player' },
  { id: 'player2', role: 'player', is_seller: false },
];
const all = people.map((p) => p.id);

describe('bulk delete by role', () => {
  it('never lists an admin under any role', () => {
    for (const r of ['organizer', 'seller', 'trainer', 'player'] as const) expect(holdsRole(people[0], r)).toBe(false);
  });

  it('players are accounts with no extra role', () => {
    expect(people.filter((p) => holdsRole(p, 'player')).map((p) => p.id)).toEqual(['player', 'player2']);
  });

  it('deleting all sellers removes only the seller role from people who have another role', () => {
    const plan = planRoleRemoval(people, 'seller', all, 'admin');
    expect(plan.deleteAccounts).toEqual(['seller']);
    expect(plan.removeRole).toEqual(['sellTrain', 'orgSeller']);
  });

  it('old-style organizers (role column) count as organizers', () => {
    const plan = planRoleRemoval(people, 'organizer', all, 'admin');
    expect(plan.deleteAccounts).toEqual(['oldOrg']);
    expect(plan.removeRole).toEqual(['orgSeller']);
    expect(roleOff('organizer', people[3])).toEqual({ is_organizer: false, role: 'player' });
    expect(roleOff('seller', people[1])).toEqual({ is_seller: false });
  });

  it('only the selected accounts are touched, and never my own', () => {
    const plan = planRoleRemoval(people, 'player', ['player', 'seller'], 'player');
    expect(plan).toEqual({ deleteAccounts: [], removeRole: [] });
    expect(planRoleRemoval(people, 'player', ['player2'], 'admin').deleteAccounts).toEqual(['player2']);
  });

  it('needs the exact confirm word', () => {
    expect(confirmed(' حذف ')).toBe(true);
    expect(confirmed('حذ')).toBe(false);
    expect(confirmed('delete')).toBe(false);
  });
});

describe('temporary batch accounts', () => {
  it('are plain players still on the claim code or the starting password', () => {
    expect(isTempAccount({ id: 'a', role: 'player', must_change_password: true })).toBe(true);
    expect(isTempAccount({ id: 'b', role: 'player', is_temp: true })).toBe(true);
    expect(isTempAccount({ id: 'c', role: 'player' })).toBe(false);
    expect(isTempAccount({ id: 'd', role: 'player', is_seller: true, must_change_password: true })).toBe(false);
    expect(isTempAccount({ id: 'e', role: 'admin', must_change_password: true })).toBe(false);
  });
});
