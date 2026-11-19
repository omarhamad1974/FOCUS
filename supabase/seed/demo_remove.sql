-- Removes everything the demo seed added (accounts end in @demo.pingo.example). Safe to run again.
delete from public.tournaments where id like 'demo-%';
delete from auth.users where email like '%@demo.pingo.example';
