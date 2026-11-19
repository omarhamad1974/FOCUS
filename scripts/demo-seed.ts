/**
 * Builds supabase/seed/demo_content.sql and demo_remove.sql: demo people, news,
 * products, training slots and tournaments that use the pictures in public/demo/.
 * Run with: npx vite-node scripts/demo-seed.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createTournament } from '../src/domain/tournament';
import { sampleTournament } from '../src/domain/sample';
import type { Tournament } from '../src/domain/types';

const OUT = new URL('../supabase/seed/', import.meta.url);
const id = (n: number) => `d0d0d0d0-0000-4000-8000-${String(n).padStart(12, '0')}`;
const q = (s: string | null) => (s === null ? 'null' : `'${s.replace(/'/g, "''")}'`);
const photo = (n: number) => `demo/person-${String(n).padStart(2, '0')}.jpg`;

/* ------------------------------------------------------------------ people */
// Person pictures 02, 04, 08, 10, 14, 16, 20 and 22 are drawn as women.
interface Person { n: number; name: string; club: string; bio?: string; organizer?: boolean; seller?: boolean; trainer?: boolean }
const PEOPLE: Person[] = [
  { n: 1, name: 'كابتن هشام عادل', club: 'نادي الزمالك', trainer: true, bio: 'مدرب معتمد من الاتحاد المصري، 15 سنة خبرة مع الناشئين والكبار. متخصص في الضربات الأمامية والإرسال.' },
  { n: 2, name: 'كوتش منى رضا', club: 'نادي هليوبوليس', trainer: true, bio: 'لاعبة منتخب سابقة ومدربة للسيدات والأطفال. حصص فردية وجماعية بأسلوب ممتع.' },
  { n: 3, name: 'كابتن طارق فهمي', club: 'سموحة', trainer: true, bio: 'مدرب لياقة وتكتيك في الإسكندرية. يجهز اللاعبين للبطولات المحلية.' },
  { n: 4, name: 'نادين فؤاد', club: 'متجر سبين', seller: true, bio: 'متجر سبين: ملابس وأحذية واكسسوارات تنس الطاولة الأصلية.' },
  { n: 5, name: 'إيهاب سمير', club: 'متجر توب سبين', seller: true, bio: 'وكيل مضارب وأسطح وكرات من أشهر الماركات، مع خدمة تركيب الأسطح.' },
  { n: 6, name: 'وليد منصور', club: 'اتحاد الجامعات', organizer: true, bio: 'منظم بطولات الجامعات والأندية منذ 2015.' },
  { n: 9, name: 'سامح الجمال', club: 'فريق أخبار بينجو', bio: 'محرر أخبار تنس الطاولة في بينجو.' },
  { n: 7, name: 'يوسف منصور', club: 'الأهلي' },
  { n: 8, name: 'سارة النجار', club: 'هليوبوليس' },
  { n: 10, name: 'مريم حسني', club: 'الشمس' },
  { n: 11, name: 'كريم السيد', club: 'الزمالك' },
  { n: 12, name: 'زياد فاروق', club: 'سموحة' },
  { n: 13, name: 'مروان الشريف', club: 'الصيد' },
  { n: 14, name: 'هنا سالم', club: 'الأهلي' },
  { n: 15, name: 'عمر رمضان', club: 'الجزيرة' },
  { n: 16, name: 'فرح زكي', club: 'وادي دجلة' },
  { n: 17, name: 'مازن بكر', club: 'الشمس' },
  { n: 18, name: 'علي عبد الله', club: 'الترسانة' },
  { n: 19, name: 'آدم حمد', club: 'الزمالك' },
  { n: 20, name: 'جنى منصور', club: 'هليوبوليس' },
  { n: 21, name: 'ياسين النجار', club: 'سموحة' },
  { n: 22, name: 'ليلى فاروق', club: 'الصيد' },
  { n: 23, name: 'خالد حسني', club: 'الأهلي' },
  { n: 24, name: 'سيف رمضان', club: 'الجزيرة' },
];
const byN = (n: number) => PEOPLE.find((p) => p.n === n)!;
const EDITOR = 9, ORGANIZER = 6, SELLERS = [4, 5];

/* -------------------------------------------------------------------- news */
interface Article { title: string; summary: string; body: string; category: string; cover: string; daysAgo: number }
const ARTICLES: Article[] = [
  {
    title: 'منتخب مصر يحصد 5 ميداليات في البطولة الأفريقية',
    summary: 'ذهبيتان وفضية وبرونزيتان في ختام منافسات الفردي والزوجي، وتأهل مباشر للبطولة العالمية.',
    category: 'news', cover: 'news-medals', daysAgo: 1,
    body: `اختتمت مساء أمس منافسات البطولة الأفريقية لتنس الطاولة بحصاد مميز للمنتخب المصري، بعدما نال **ذهبيتين وفضية وبرونزيتين** في فئات الفردي والزوجي.

وجاءت الذهبية الأولى في زوجي الرجال بعد مباراة نهائية ماراثونية حُسمت في الشوط الخامس بنتيجة 12-10، بينما أضافت سيدات المنتخب الذهبية الثانية في منافسات الفرق.

وقال المدير الفني إن الإعداد المبكر ومعسكرات الصيف صنعت الفارق، مؤكدًا أن الهدف القادم هو التأهل إلى دور الستة عشر في البطولة العالمية.

ويعود المنتخب إلى القاهرة غدًا، ويستأنف اللاعبون مشاركاتهم مع أنديتهم في الدوري الأسبوع المقبل.`,
  },
  {
    title: 'درس للمبتدئين: الضربة الأمامية خطوة بخطوة',
    summary: 'وقفة الاستعداد، حركة الذراع، ونقطة لمس الكرة. ثلاث خطوات تجعل ضربتك الأمامية أقوى وأدق.',
    category: 'learn', cover: 'news-forehand', daysAgo: 3,
    body: `الضربة الأمامية (الفورهاند) هي أول ضربة يتعلمها كل لاعب، وإتقانها يفتح الباب لكل الضربات الهجومية.

**1. وقفة الاستعداد:** قف على بعد خطوة من الطاولة، القدمان أوسع قليلًا من الكتفين، والركبتان مثنيتان. القدم اليسرى أمام اليمنى قليلًا (للاعب الأيمن).

**2. حركة الذراع:** ابدأ الضربة من الخصر لا من المعصم. اسحب المضرب للخلف مع لف الجذع، ثم أنهِ الحركة أمام جبهتك كأنك تؤدي التحية.

**3. نقطة اللمس:** اضرب الكرة وهي في أعلى نقطة لها أو قبلها بقليل، أمام جسمك وليس بجانبه.

تمرين مقترح: 100 ضربة أمامية متتالية مع زميل على القطر، ثم كرر التمرين على الخط المستقيم. سجّل عدد الأخطاء في كل مرة ولاحظ تحسنك خلال أسبوع.`,
  },
  {
    title: 'كيف تختار سطح المضرب المناسب لأسلوبك؟',
    summary: 'السرعة، الدوران، والتحكم. دليل مبسط لاختيار السطح والإسفنجة حسب مستواك وطريقة لعبك.',
    category: 'gear', cover: 'news-rubber', daysAgo: 6,
    body: `يحتار كثير من اللاعبين أمام عشرات الأسطح المتوفرة في المتاجر. القاعدة الذهبية: **اختر ما يناسب مستواك، لا ما يستخدمه المحترفون.**

**للمبتدئ:** سطح متوسط السرعة مع إسفنجة 1.8 – 2.0 مم. يمنحك تحكمًا أفضل ويساعدك على تعلم الضربات الصحيحة.

**للاعب الهجومي:** سطح ذو قدرة عالية على الدوران مع إسفنجة 2.1 مم أو "ماكس"، مناسب للتوب سبين والضربات القوية.

**للاعب الدفاعي:** سطح أبطأ بإسفنجة رقيقة، أو سطح بنتوءات طويلة على الوجه الخلفي لإرباك المنافس.

نصيحة: غيّر الأسطح كل 3 إلى 6 أشهر حسب عدد ساعات التدريب، فالسطح القديم يفقد قدرته على الدوران تدريجيًا.`,
  },
  {
    title: 'انطلاق التسجيل في بطولة الناشئين الشتوية',
    summary: 'بطولة مفتوحة للاعبين تحت 18 سنة بنظام المجموعات ثم خروج المغلوب، والتسجيل من التطبيق.',
    category: 'events', cover: 'news-events', daysAgo: 8,
    body: `يسعدنا الإعلان عن فتح باب التسجيل في **بطولة الناشئين الشتوية** المقامة الشهر المقبل.

نظام البطولة: مجموعات من 4 لاعبين، يتأهل الأول والثاني إلى خروج المغلوب، بينما يلعب الثالث والرابع في بطولة الترضية حتى يحصل الجميع على مباريات أكثر.

المباريات من 3 أشواط في دور المجموعات، ومن 5 أشواط بدءًا من نصف النهائي.

للتسجيل افتح صفحة البطولة واضغط "اشترك". ينظر المنظم في الطلبات ويؤكد قائمة المشاركين قبل القرعة.`,
  },
  {
    title: '5 نصائح لتحسين الإرسال في أسبوع واحد',
    summary: 'الإرسال هو الضربة الوحيدة التي تتحكم فيها بالكامل. هذه خمس عادات صغيرة تصنع فرقًا كبيرًا.',
    category: 'tips', cover: 'news-tips', daysAgo: 12,
    body: `**1. ارمِ الكرة عموديًا:** القانون يطلب رمي الكرة 16 سم على الأقل، والرمية المستقيمة تجعل إرسالك ثابتًا.

**2. نوّع الدوران بنفس الحركة:** تدرب على إرسال قصير بدوران سفلي وآخر بلا دوران بحركة تبدو متشابهة، فيصعب على المنافس قراءتك.

**3. أرسل قصيرًا:** الكرة التي ترتد مرتين على طاولة المنافس تمنعه من الهجوم المباشر.

**4. فكّر في الضربة الثالثة:** خطط لما بعد الإرسال، فالإرسال الجيد يجهز لك هجومًا سهلًا.

**5. 10 دقائق يوميًا:** خذ سلة كرات وتدرب على الإرسال وحدك قبل كل حصة.`,
  },
  {
    title: 'مدارس تنس الطاولة للأطفال: متى يبدأ طفلك؟',
    summary: 'من سن 6 سنوات يمكن للطفل أن يبدأ. ما الذي يكتسبه، وكيف تختار المدرب والمكان المناسب؟',
    category: 'other', cover: 'news-kids', daysAgo: 20,
    body: `تنس الطاولة من أنسب الرياضات للأطفال: آمنة، سريعة، وتنمي التركيز وسرعة رد الفعل والتوافق بين العين واليد.

**متى يبدأ؟** يمكن البدء من 6 أو 7 سنوات بحصص قصيرة لا تتجاوز 45 دقيقة، مع التركيز على اللعب والمرح.

**كيف تختار المدرب؟** ابحث عن مدرب لديه خبرة مع الأطفال، يقسم الحصة إلى تمارين قصيرة متنوعة، ويستخدم ألعابًا وتحديات.

**المعدات:** مضرب جاهز خفيف الوزن يكفي في البداية، وحذاء رياضي بنعل لا يترك أثرًا.

يمكنك حجز حصة تجريبية مع أحد المدربين من قسم التدريب في بينجو.`,
  },
];

/* ---------------------------------------------------------------- products */
interface Item { name: string; description: string; category: string; price: number; stock: number; img: string; seller: number; featured?: boolean; pending?: boolean }
const PRODUCTS: Item[] = [
  { name: 'مضرب احترافي كربون 7 طبقات', description: 'خشب 5 طبقات مع طبقتين كربون، سريع وثابت للاعب الهجومي. يأتي بدون أسطح.', category: 'rackets', price: 3450, stock: 6, img: 'p-racket-pro', seller: 5, featured: true },
  { name: 'مضرب جاهز للمبتدئين', description: 'مضرب كامل بأسطح معتمدة، خفيف وسهل التحكم. مثالي للمدارس والمبتدئين.', category: 'rackets', price: 650, stock: 25, img: 'p-racket-starter', seller: 5, featured: true },
  { name: 'كرات تدريب 3 نجوم (6 كرات)', description: 'كرات بلاستيك ABS 40+ معتمدة للمباريات، ارتداد ثابت وعمر طويل.', category: 'balls', price: 240, stock: 60, img: 'p-balls', seller: 5 },
  { name: 'سطح مضرب عالي الدوران', description: 'سطح هجومي بإسفنجة 2.1 مم، دوران عالٍ وتحكم ممتاز في التوب سبين.', category: 'rubbers', price: 1350, stock: 15, img: 'p-rubber', seller: 5 },
  { name: 'تيشيرت بينجو الرياضي', description: 'قماش خفيف يمتص العرق، مقاسات من S إلى XXL. متوفر بالأزرق.', category: 'clothing', price: 450, stock: 40, img: 'p-tshirt', seller: 4, featured: true },
  { name: 'حذاء تنس طاولة خفيف', description: 'نعل مطاطي لا يترك أثرًا، ثبات عالٍ في الحركة الجانبية.', category: 'shoes', price: 1900, stock: 12, img: 'p-shoes', seller: 4 },
  { name: 'حقيبة مضارب مزدوجة', description: 'تتسع لمضربين و6 كرات، مع جيب للمنشفة وحزام كتف.', category: 'bags', price: 520, stock: 20, img: 'p-bag', seller: 4 },
  { name: 'طاولة قابلة للطي للمنزل', description: 'طاولة مقاس رسمي بعجلات وقفل أمان، سطح 19 مم. التوصيل داخل القاهرة والجيزة.', category: 'tables', price: 18500, stock: 3, img: 'p-table', seller: 5 },
  { name: 'شبكة وحامل بمشبك', description: 'شبكة قابلة لضبط الارتفاع والشد، تركب على أي طاولة حتى 5 سم.', category: 'accessories', price: 380, stock: 18, img: 'p-net', seller: 4 },
  { name: 'منشفة قطنية للاعبين', description: 'منشفة صغيرة سريعة الجفاف بشعار بينجو.', category: 'accessories', price: 150, stock: 30, img: 'p-towel', seller: 4, pending: true },
];

/* --------------------------------------------------------------- training */
const LOCATIONS = [
  { trainer: 1, name: 'صالة الزمالك المغطاة', address: 'ميت عقبة، الجيزة', map: 'https://maps.google.com/?q=Zamalek+Club+Giza', hours: [17, 18, 19, 20], price: 350, note: 'حصة فردية' },
  { trainer: 2, name: 'نادي هليوبوليس - صالة 2', address: 'مصر الجديدة، القاهرة', map: 'https://maps.google.com/?q=Heliopolis+Sporting+Club', hours: [10, 11, 16, 17], price: 300, note: 'سيدات وأطفال' },
  { trainer: 3, name: 'أكاديمية سموحة', address: 'سموحة، الإسكندرية', map: 'https://maps.google.com/?q=Smouha+Club+Alexandria', hours: [18, 19, 20], price: 250, note: 'تكتيك ولياقة' },
];

/* ------------------------------------------------------------- tournaments */
function link(t: Tournament, people: number[]): void {
  t.players.forEach((p, i) => { const who = byN(people[i]); p.name = who.name; p.accountId = id(who.n); });
}
const PLAYERS = PEOPLE.filter((p) => !p.organizer && !p.seller && p.n !== EDITOR).map((p) => p.n);

const finished = sampleTournament('finished', 20261109, 16, 4);
finished.name = 'بطولة القاهرة المفتوحة';
link(finished, PLAYERS.slice(0, 16));
finished.media = [
  { id: 'm1', kind: 'photo', url: 'demo/tour-podium.jpg', caption: 'منصة التتويج' },
  { id: 'm2', kind: 'photo', url: 'demo/tour-final.jpg', caption: 'لحظة حسم النهائي' },
  { id: 'm3', kind: 'photo', url: 'demo/tour-hall.jpg', caption: 'صالة البطولة' },
];

const running = sampleTournament('groupsHalf', 20261118, 12, 3);
running.name = 'دوري الأندية الشتوي';
link(running, [...PLAYERS].reverse().slice(0, 12));
running.media = [{ id: 'm1', kind: 'photo', url: 'demo/tour-hall.jpg', caption: 'اليوم الأول من الدوري' }];

const open = createTournament({
  name: 'بطولة الناشئين الشتوية', date: '', playerNames: PLAYERS.slice(4, 8).map((n) => byN(n).name), groupCount: 4,
  formats: { group: 3, early: 3, semi: 5, final: 5 }, consolation: { enabled: true, name: 'بطولة الترضية' },
});
open.players.forEach((p, i) => { p.accountId = id(PLAYERS[4 + i]); });
open.registration = { open: true, autoAccept: false, maxPlayers: 32 };
open.media = [{ id: 'm1', kind: 'photo', url: 'demo/news-events.jpg', caption: 'إعلان البطولة' }];

const TOURS: { t: Tournament; key: string; status: string; days: number; maxPlayers: number | null }[] = [
  { t: finished, key: 'demo-cairo-open', status: 'finished', days: -10, maxPlayers: null },
  { t: running, key: 'demo-winter-league', status: 'running', days: 0, maxPlayers: null },
  { t: open, key: 'demo-juniors', status: 'registration', days: 21, maxPlayers: 32 },
];

/* --------------------------------------------------------------------- SQL */
const remove = `-- Removes everything the demo seed added (accounts end in @demo.pingo.example). Safe to run again.
delete from public.tournaments where id like 'demo-%';
delete from auth.users where email like '%@demo.pingo.example';
`;

const L: string[] = [];
L.push(`-- Pingo demo content: people with photos, news, shop products, training slots and tournaments.
-- Run in the Supabase SQL Editor after migrations 0001–0006. Safe to run again: it first
-- removes the previous demo content. Pictures live in the app under demo/ (public/demo).
-- Demo accounts have no password, so nobody can sign in with them.
-- To remove the demo content later, run demo_remove.sql.

begin;

${remove}
-------------------------------------------------------------------- people
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
values`);
L.push(PEOPLE.map((p) => `  ('00000000-0000-0000-0000-000000000000', '${id(p.n)}', 'authenticated', 'authenticated', 'demo${String(p.n).padStart(2, '0')}@demo.pingo.example', '', now(),
   '{"provider":"email","providers":["email"]}', ${q(JSON.stringify({ full_name: p.name, club: p.club }))}, now() - interval '${60 - p.n} days', now(), '', '', '', '')`).join(',\n') + ';');
L.push('');
for (const p of PEOPLE) {
  L.push(`update public.profiles set avatar_url = ${q(photo(p.n))}, bio = ${q(p.bio ?? null)}, is_organizer = ${!!p.organizer}, is_seller = ${!!p.seller}, is_trainer = ${!!p.trainer} where id = '${id(p.n)}';`);
}
L.push(`-- One request waiting for the admin, to try the approvals screen.
insert into public.role_requests (user_id, role, note) values ('${id(10)}', 'trainer', 'لاعبة سابقة وأحب تدريب الأطفال، أرجو الموافقة.');
`);

L.push('---------------------------------------------------------------------- news');
L.push(`insert into public.posts (author_id, title, summary, body, category, cover_url, published, created_at) values`);
L.push(ARTICLES.map((a) => `  ('${id(EDITOR)}', ${q(a.title)}, ${q(a.summary)},\n   ${q(a.body)},\n   '${a.category}', 'demo/${a.cover}.jpg', true, now() - interval '${a.daysAgo} days')`).join(',\n') + ';\n');

L.push('---------------------------------------------------------------------- shop');
L.push(`insert into public.products (seller_id, name, description, category, price, stock, image_url, approved, featured, created_at) values`);
L.push(PRODUCTS.map((p, i) => `  ('${id(p.seller)}', ${q(p.name)}, ${q(p.description)}, '${p.category}', ${p.price}, ${p.stock}, 'demo/${p.img}.jpg', ${!p.pending}, ${!!p.featured}, now() - interval '${i * 2} days')`).join(',\n') + ';\n');
if (!SELLERS.length) throw new Error('no sellers');

L.push('------------------------------------------------------------------ training');
for (const [i, loc] of LOCATIONS.entries()) {
  const lid = `d0d0d0d0-0000-4000-9000-${String(i + 1).padStart(12, '0')}`;
  L.push(`insert into public.training_locations (id, trainer_id, name, address, map_url) values ('${lid}', '${id(loc.trainer)}', ${q(loc.name)}, ${q(loc.address)}, ${q(loc.map)});`);
  L.push(`insert into public.training_slots (trainer_id, location_id, starts_at, price, note)
  select '${id(loc.trainer)}', '${lid}', ((current_date + d) + make_time(h, 0, 0)) at time zone 'Africa/Cairo', ${loc.price}, ${q(loc.note)}
  from generate_series(1, 10) d, unnest(array[${loc.hours.join(', ')}]) h
  where extract(isodow from current_date + d) <> 5;`);
}
L.push('');

L.push('--------------------------------------------------------------- tournaments');
for (const { t, key, status, days, maxPlayers } of TOURS) {
  const { organizerId: _o, ...state } = { ...t, id: key };
  const day = `current_date + ${days}`;
  L.push(`insert into public.tournaments (id, organizer_id, name, date, status, auto_accept, max_players, state, created_at)
values ('${key}', '${id(ORGANIZER)}', ${q(t.name)}, ${day}, '${status}', false, ${maxPlayers ?? 'null'},
  ${q(JSON.stringify(state))}::jsonb || jsonb_build_object('date', to_char(${day}, 'YYYY-MM-DD'), 'createdAt', to_char((now() - interval '${Math.max(3, -days + 7)} days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  now() - interval '${Math.max(3, -days + 7)} days');`);
}
L.push(`-- Two players already asked to join the open tournament.
insert into public.registrations (tournament_id, player_id, status) values
  ('demo-juniors', '${id(PLAYERS[10])}', 'pending'), ('demo-juniors', '${id(PLAYERS[11])}', 'pending');

commit;
`);

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL('demo_content.sql', OUT), L.join('\n'));
writeFileSync(new URL('demo_remove.sql', OUT), remove);
console.log('wrote supabase/seed/demo_content.sql and demo_remove.sql');
