-- Removes everything the demo seed added (accounts end in @demo.pingo.example), including the 40
-- simulation players and what they did (registrations, bookings, orders). Safe to run again.
delete from public.tournaments where id like 'demo-%';
update public.training_slots s set booked = false
  where exists (select 1 from public.bookings b join auth.users u on u.id = b.player_id
                where b.slot_id = s.id and b.status = 'booked' and u.email like '%@demo.pingo.example');
delete from public.players where profile_id in (select id from auth.users where email like '%@demo.pingo.example');
delete from auth.users where email like '%@demo.pingo.example';
