# Product requirements

## Audience and surfaces
Players: fixtures, rankings, history, training. Organizers: tournaments, groups, brackets, match entry. Trainers: recurring sessions and player development. Sellers: inventory and sales (scope to be validated). Admins: oversight and access management.

## Tournament workflow
Create/duplicate tournament -> configure format/participants -> assign groups -> record group matches -> calculate standings -> seed knockout -> semifinal -> championship final + third-place playoff -> publish placements/history.

Standings rules: 1 point per win; two-way tie head-to-head; tie of 3+ game difference then points difference. Apply consistently in the group table and advancement logic. Consider all tied participants, not only adjacent rows. Avoid treating demonstration sample standings as calculated results.

## UX
Mobile-first with accessible touch targets, clear score entry, compact responsive tables, easy RTL navigation, and simple workflows for a nontechnical organizer. Desktop should remain fully functional.

## Scope integrity
The prototype is only a design/interaction seed. Production functionality must be implemented, tested and connected to data services separately.
