-- Pingo: 40 registered demo players for the role tools' simulations (Nov 2026).
-- Real accounts with realistic photos (AI-generated portraits, CC0, from faker-js/assets-person-portrait),
-- stored in the app under public/demo/players. Nobody can sign in with them (no password).
-- Safe to run again: it replaces the previous 40. demo_remove.sql removes them with the other demo content.

begin;

delete from public.players where profile_id in (select id from auth.users where email like 'sim__@demo.pingo.example');
delete from auth.users where email like 'sim__@demo.pingo.example';

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', ('d0d0d0d0-0000-4000-8001-' || lpad(k::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', 'sim' || lpad(k::text, 2, '0') || '@demo.pingo.example', '', now(),
  '{"provider":"email","providers":["email"]}',
  jsonb_build_object('full_name', n, 'club', 'نادي ' || c, 'gender', g, 'birth_year', y::text,
    'phone', '0100' || lpad((5550000 + k * 37)::text, 7, '0')),
  now() - make_interval(days => 90 - k), now(), '', '', '', ''
from (values
  (1, 'كريم عادل', 'الأهلي', 'male', 1989),
  (2, 'زياد حسام', 'الزمالك', 'male', 2007),
  (3, 'هبة عبد العزيز', 'هليوبوليس', 'female', 1987),
  (4, 'مصطفى رأفت', 'سموحة', 'male', 1997),
  (5, 'سالم الكعبي', 'الشمس', 'male', 1966),
  (6, 'نادية فهمي', 'الجزيرة', 'female', 1965),
  (7, 'شريف منير', 'الصيد', 'male', 1980),
  (8, 'طارق سليم', 'وادي دجلة', 'male', 1986),
  (9, 'ياسمين شكري', 'الأهلي', 'female', 1991),
  (10, 'محمود الشناوي', 'الترسانة', 'male', 1962),
  (11, 'فهد العتيبي', 'الزمالك', 'male', 1981),
  (12, 'ريم القحطاني', 'هليوبوليس', 'female', 2000),
  (13, 'هشام البدري', 'سموحة', 'male', 1977),
  (14, 'عمر فتحي', 'الأهلي', 'male', 2003),
  (15, 'سلمى رشدي', 'الجزيرة', 'female', 1996),
  (16, 'إيهاب نصار', 'الشمس', 'male', 1975),
  (17, 'وائل جاد', 'الصيد', 'male', 1978),
  (18, 'منى الحديدي', 'وادي دجلة', 'female', 1986),
  (19, 'باسم عزت', 'الزمالك', 'male', 1992),
  (20, 'آدم الشريف', 'سموحة', 'male', 2000),
  (21, 'داليا مختار', 'الأهلي', 'female', 1988),
  (22, 'يوسف هاني', 'الجزيرة', 'male', 1999),
  (23, 'أشرف قنديل', 'الترسانة', 'male', 1986),
  (24, 'رانيا سعيد', 'هليوبوليس', 'female', 1990),
  (25, 'عادل الفقي', 'الشمس', 'male', 1965),
  (26, 'نبيل حمدي', 'الصيد', 'male', 1988),
  (27, 'لينا الخطيب', 'الزمالك', 'female', 2006),
  (28, 'تامر لطفي', 'وادي دجلة', 'male', 1988),
  (29, 'رامي ناجي', 'الأهلي', 'male', 1996),
  (30, 'جيهان صبري', 'سموحة', 'female', 1990),
  (31, 'معاذ إبراهيم', 'الجزيرة', 'male', 2001),
  (32, 'حسام فاروق', 'الزمالك', 'male', 1983),
  (33, 'أمل بن علي', 'الشمس', 'female', 1989),
  (34, 'ماهر العلمي', 'الصيد', 'male', 1977),
  (35, 'خالد عبد الحميد', 'الأهلي', 'male', 1985),
  (36, 'نور الهدى سامي', 'هليوبوليس', 'female', 1996),
  (37, 'جمال الطرابلسي', 'سموحة', 'male', 1980),
  (38, 'سامر يوسف', 'الترسانة', 'male', 1981),
  (39, 'ملك حجازي', 'الزمالك', 'female', 2000),
  (40, 'مريم أنور', 'وادي دجلة', 'female', 2002)
) as v(k, n, c, g, y);

-- Photos: public/demo/players/sp-01.jpg … sp-40.jpg in the app.
update public.profiles
set avatar_url = 'demo/players/sp-' || right(id::text, 2) || '.jpg'
where id::text like 'd0d0d0d0-0000-4000-8001-%';

-- Each player also gets a row in the shared player directory, ready for tournaments.
insert into public.players (full_name, phone, club, birth_year, gender, profile_id)
select p.full_name, p.phone, p.club, p.birth_year, p.gender, p.id from public.profiles p
where p.id::text like 'd0d0d0d0-0000-4000-8001-%'
  and not exists (select 1 from public.players x where x.profile_id = p.id);

commit;
