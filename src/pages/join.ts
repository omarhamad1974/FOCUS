/**
 * Landing pages for the launch posters: #/join (who is Pingo for) and
 * #/join/player, #/join/organizer, #/join/trainer, #/join/seller.
 * Each poster's QR code opens its role's page. The pages are static: they
 * work without an account and without Supabase.
 */
import { icon } from '../ui/icons';
import { esc } from '../ui/util';
import { session } from '../app/ctx';
import { whatsappLink } from './faq';

export type JoinRole = 'player' | 'organizer' | 'trainer' | 'seller';
export const JOIN_ROLES: JoinRole[] = ['player', 'organizer', 'trainer', 'seller'];

type Item = [icon: string, title: string, text: string];
type Price = { amount: string; unit: string; note?: string };

interface RolePage {
  icon: string;
  name: string;
  /** Short tag line for the overview card. */
  tag: string;
  title: string;
  lead: string;
  /** The four advantages, also printed on the poster. */
  highlights: Item[];
  /** Every feature the role has in the app today. */
  features: Item[];
  steps: string[];
  prices: Price[];
  priceNote: string;
  cta: string;
}

/** Launch prices from Omar's plan (2026-11-22). The admin can change them later in the app. */
export const PAGES: Record<JoinRole, RolePage> = {
  player: {
    icon: 'ball',
    name: 'اللاعبون',
    tag: 'بطولات، نتائج مباشرة، ترتيب وحجز تدريب',
    title: 'العب. نافس. اصعد الترتيب.',
    lead: 'كل بطولات تنس الطاولة حولك في مكان واحد، بنتائج مباشرة وإحصائيات لك وحدك. مجاناً بالكامل.',
    highlights: [
      ['trophy', 'انضم للبطولات بضغطة', 'تصفح البطولات المفتوحة حسب المكان والموعد وانضم من هاتفك.'],
      ['bolt', 'نتائج مباشرة', 'مجموعتك وجدول الترتيب والأدوار الإقصائية لحظة بلحظة.'],
      ['star', 'إحصائياتك وترتيبك', 'مبارياتك ونسبة فوزك وميدالياتك ومكانك بين اللاعبين.'],
      ['calendar', 'احجز حصة تدريب', 'اختر مدرباً قريباً منك واحجز ساعة أونلاين.'],
    ],
    features: [
      ['phone', 'حساب واحد برقم موبايلك', 'رقم الموبايل هو اسم المستخدم. حساب واحد لكل البطولات، وصورتك تظهر مع اسمك.'],
      ['search', 'كل البطولات أمامك', 'فلتر حسب الحالة (التسجيل مفتوح، جارية، انتهت) والموعد والمكان.'],
      ['check', 'انضمام وانسحاب بسهولة', 'اطلب الانضمام من صفحة البطولة، وتستطيع الانسحاب ما دام التسجيل مفتوحاً.'],
      ['bell', 'دعوات من المنظمين', 'تصلك الدعوة في صفحتك الرئيسية، والقبول يسجلك في البطولة مباشرة.'],
      ['grid', 'صفحة لكل بطولة', 'المجموعات وجداول الترتيب والمباريات والإقصائيات والصور والفيديو.'],
      ['shield', 'قواعد واضحة وعادلة', 'الفوز بنقطة، والتعادل يُحسم بالمواجهات بين المتعادلين فقط. الثالث والرابع يكملون في بطولة الترضية.'],
      ['trophy', 'احتفال البطل', 'بطاقة بطل كرتونية بصورتك أنت تظهر للجميع عند الفوز بالبطولة.'],
      ['image', 'بطاقات نتائج للمشاركة', 'صورة جاهزة لنتيجة مباراتك أو جدول مجموعتك أو منصة التتويج لواتساب وفيسبوك.'],
      ['star', 'ملفك وإحصائياتك', 'عدد المباريات والانتصارات ونسبة الفوز والميداليات وترتيبك بين لاعبي بينجو.'],
      ['coach', 'حجز التدريب', 'مواعيد المدربين بالساعة ومكان كل تدريب، والدفع للمدرب في الحصة.'],
      ['shop', 'متجر الأدوات', 'مضارب وكرات وأحذية من بائعين معتمدين، والدفع عند الاستلام.'],
      ['news', 'أخبار ونصائح', 'أخبار البطولات ونصائح اللعب والأدوات في مكان واحد.'],
    ],
    steps: ['سجّل برقم موبايلك', 'اختر بطولة وانضم', 'العب وتابع نتائجك مباشرة', 'شارك إنجازك واصعد الترتيب'],
    prices: [{ amount: 'مجاناً', unit: 'دائماً', note: 'كل مزايا اللاعب بدون أي رسوم' }],
    priceNote: 'رسوم البطولات وحصص التدريب يحددها المنظم أو المدرب وتُدفع له مباشرة.',
    cta: 'سجّل كلاعب مجاناً',
  },
  organizer: {
    icon: 'trophy',
    name: 'المنظمون',
    tag: 'من التسجيل حتى البطل في مكتب واحد',
    title: 'نظّم بطولتك من هاتفك… من التسجيل حتى البطل.',
    lead: 'مكتب المنظم يأخذك خطوة بخطوة: التسجيل، الرسوم، المجموعات، الإقصائيات، ثم التتويج. بدون أوراق وبدون حسابات يدوية.',
    highlights: [
      ['users', 'تسجيل اللاعبين ودعوتهم', 'طلبات انضمام، حد أقصى، قائمة انتظار ودعوات بالاسم.'],
      ['grid', 'مجموعات وترتيب تلقائي', 'توزيع تلقائي مع تعديل بالسحب، وجداول محسوبة بالقواعد.'],
      ['trophy', 'إقصائيات وبطولة ترضية', 'الأول والثاني للرئيسية، والثالث والرابع لبطولة الترضية.'],
      ['money', 'تحصيل الرسوم بسهولة', 'علامة «مدفوع» لكل لاعب، والمحصّل والمتبقي أمامك.'],
    ],
    features: [
      ['bolt', 'مكتب المنظم', 'بطولاتك فقط في شاشة واحدة بخمس خطوات واضحة، مع طلبات الانضمام والمباريات المتبقية والرسوم المحصلة.'],
      ['users', 'التسجيل كما تريد', 'قبول الطلبات يدوياً أو تلقائياً، حد أقصى للاعبين وقائمة انتظار، ودعوة أي مستخدم مسجل بالاسم.'],
      ['grid', 'المجموعات بالسحب والإفلات', 'توزيع عشوائي بضغطة، ثم عدّل بالسحب. أسماء الطاولات اختيارية وتُعدّل في أي وقت.'],
      ['racket', 'نظام المباريات لكل مرحلة', 'أفضل 3 أو 5 أشواط للمجموعات والأدوار الأولى ونصف النهائي والنهائي كلٌ على حدة.'],
      ['check', 'النتيجة بضغطة واحدة', 'سجّل نتيجة المباراة بالأشواط بضغطة، أو فعّل نقاط كل شوط إن أردت التفاصيل.'],
      ['shield', 'القواعد محسوبة لك', 'الفوز بنقطة، الانسحاب يُحسب 3-0، والتعادل بين ثلاثة يُحسم بفارق الأشواط بينهم فقط، والحسم النهائي لك.'],
      ['trophy', 'بطولة الترضية تلقائياً', 'الثالث والرابع من كل مجموعة يلعبون بطولة موازية تسميها أنت، مع مباراة المركز الثالث.'],
      ['user', 'مساعدون للنتائج', 'اختر أي مستخدم مسجل كمساعد يُدخل النتائج فقط من على الطاولة.'],
      ['plus', 'لاعب مكمّل للمجموعات', 'أكمل مجموعة ناقصة بلاعب من مجموعة أخرى، ويتأهل فقط من مجموعته الأصلية.'],
      ['money', 'متابعة الرسوم', 'حدد رسوم الاشتراك وعلّم من دفع، والإجمالي يتحدث تلقائياً.'],
      ['image', 'صور وفيديو البطولة', 'صورة رئيسية للبطولة وألبوم صور وروابط فيديو للجمهور.'],
      ['eye', 'صفحة عامة للجمهور', 'اللاعبون والجمهور يتابعون النتائج مباشرة، وبطاقات النتائج جاهزة للمشاركة.'],
      ['user', 'صفحتك العامة', 'نبذة عنك وكل البطولات التي نظمتها في صفحة واحدة تبني سمعتك.'],
      ['spark', 'جرّب قبل البطولة الحقيقية', 'محاكاة كاملة بلاعبين تجريبيين بصورهم: انضمام، دفع، جولات حتى البطل.'],
    ],
    steps: ['سجّل واختر «منظم بطولات»', 'توافق الإدارة ويبدأ اشتراكك', 'أنشئ بطولتك وافتح التسجيل', 'أدر الجولات حتى تتويج البطل'],
    prices: [
      { amount: '500 ج.م', unit: 'شهرياً' },
      { amount: '5000 ج.م', unit: 'سنوياً', note: 'وفّر 1000 ج.م' },
    ],
    priceNote: 'الدفع نقداً أو بالتحويل عن طريق إدارة بينجو، وتواصل معنا على واتساب لأي استفسار.',
    cta: 'سجّل كمنظم بطولات',
  },
  trainer: {
    icon: 'coach',
    name: 'المدربون',
    tag: 'مواعيد بالساعة وحجز أونلاين ومدفوعات',
    title: 'مواعيدك أونلاين… واللاعبون يحجزون بأنفسهم.',
    lead: 'اعرض ساعاتك المتاحة ومكان التدريب، ودع اللاعبين يحجزون من هواتفهم. حجوزاتك ومدفوعاتك في مكتب واحد.',
    highlights: [
      ['calendar', 'مواعيد بالساعة', 'أنشئ ساعاتك لأسابيع قادمة بضغطة واحدة.'],
      ['pin', 'مكانك وعنوانك', 'مكان التدريب وعنوانه بجانب كل موعد.'],
      ['bolt', 'حجز أونلاين فوري', 'اللاعب يحجز الساعة المتاحة وتصلك فوراً.'],
      ['money', 'متابعة المدفوعات', 'علامة «مدفوع» لكل حصة والمحصّل أمامك.'],
    ],
    features: [
      ['calendar', 'جدول بالساعة', 'اختر الأيام والساعات وعدد الأسابيع، وتُنشأ كل الحصص (ساعة لكل حصة) دفعة واحدة.'],
      ['pin', 'أماكن التدريب', 'اسم الصالة والعنوان مع كل موعد، ليعرف اللاعب أين يذهب.'],
      ['bolt', 'حجز فوري', 'اللاعب يحجز الساعة المتاحة من هاتفه، وتختفي من المتاح تلقائياً.'],
      ['home', 'ظهور في الصفحة الرئيسية', 'أقرب المواعيد المتاحة تظهر لكل زوار بينجو في الصفحة الرئيسية.'],
      ['coach', 'مكتب المدرب', 'الساعات المتاحة والحجوزات القادمة والسابقة وعدد اللاعبين في شاشة واحدة.'],
      ['money', 'المدفوعات', 'اللاعب يدفع لك في الحصة أو مقدماً، وتعلّم «مدفوع» لتعرف المحصّل والمتبقي.'],
      ['x', 'إلغاء ومرونة', 'ألغِ أي حجز لتعود الساعة متاحة للحجز من جديد.'],
      ['user', 'صفحة المدرب العامة', 'نبذة عن خبرتك وإنجازاتك بجانب مواعيدك، تبني ثقة اللاعبين.'],
      ['users', 'جمهور جاهز', 'لاعبو البطولات على بينجو هم عملاؤك القادمون.'],
      ['spark', 'جرّب قبل الإطلاق', 'محاكاة حجوزات بلاعبين تجريبيين لترى كيف يعمل كل شيء.'],
    ],
    steps: ['سجّل واختر «مدرب»', 'توافق الإدارة ويبدأ اشتراكك', 'أضف مكانك وساعاتك المتاحة', 'استقبل الحجوزات وتابع المدفوعات'],
    prices: [
      { amount: '500 ج.م', unit: 'شهرياً' },
      { amount: '5000 ج.م', unit: 'سنوياً', note: 'وفّر 1000 ج.م' },
    ],
    priceNote: 'ثمن الحصة تحدده أنت ويدفعه اللاعب لك مباشرة. اشتراك بينجو يُدفع عن طريق الإدارة.',
    cta: 'سجّل كمدرب',
  },
  seller: {
    icon: 'shop',
    name: 'البائعون',
    tag: 'متجرك أمام كل لاعبي تنس الطاولة',
    title: 'متجرك أمام كل لاعبي تنس الطاولة.',
    lead: 'اعرض مضاربك وكراتك وأدواتك أمام جمهور يلعب كل أسبوع، واستقبل الطلبات وتابع التسليم والتحصيل من مكتب البائع.',
    highlights: [
      ['shop', 'اعرض منتجاتك', 'صور ووصف وسعر ومخزون لكل منتج.'],
      ['star', 'فرصة الظهور المميز', 'منتجات مختارة تظهر في الصفحة الرئيسية.'],
      ['box', 'طلبات منظّمة', 'تأكيد وتسليم وإلغاء، والمخزون يقل تلقائياً.'],
      ['money', 'تحصيل واضح', 'الدفع عند الاستلام أو مقدماً مع علامة «مدفوع».'],
    ],
    features: [
      ['image', 'صفحة لكل منتج', 'صورة ووصف وسعر وتصنيف ومخزون، والعميل يطلب بالكمية التي يريدها.'],
      ['shield', 'منتجات معتمدة', 'كل منتج تراجعه الإدارة قبل عرضه، فيثق المشتري في المتجر.'],
      ['star', 'المنتجات المميزة', 'الإدارة تختار منتجات مميزة تظهر لكل الزوار في الصفحة الرئيسية.'],
      ['box', 'إدارة الطلبات', 'الطلبات المفتوحة وغير المدفوعة والكل، مع تأكيد ثم تسليم أو إلغاء.'],
      ['tag', 'مخزون تلقائي', 'المخزون يقل مع كل طلب، والمنتج النافد لا يُطلب.'],
      ['money', 'المدفوعات', 'الدفع عند الاستلام أو مقدماً، وتعلّم «مدفوع» لترى المحصّل والمتبقي.'],
      ['shop', 'مكتب البائع', 'منتجاتك والطلبات الواردة والتوصيل والمدفوعات في شاشة واحدة.'],
      ['user', 'نبذة عنك', 'نبذة عن متجرك تظهر بجانب منتجاتك وفي صفحتك العامة.'],
      ['users', 'جمهور متخصص', 'كل زائر لبينجو لاعب أو مدرب أو منظم يحتاج أدوات تنس الطاولة.'],
      ['spark', 'جرّب قبل الإطلاق', 'محاكاة طلبات من عملاء تجريبيين لترى دورة الطلب كاملة.'],
    ],
    steps: ['سجّل واختر «بائع»', 'توافق الإدارة ويبدأ اشتراكك', 'أضف منتجاتك وتنتظر المراجعة', 'استقبل الطلبات وسلّم وحصّل'],
    prices: [
      { amount: '20 ج.م', unit: 'للمنتج شهرياً', note: 'حتى 20 منتجاً' },
      { amount: '500 ج.م', unit: 'شهرياً', note: 'منتجات بلا حدود' },
    ],
    priceNote: 'ثمن المنتجات يدفعه العميل لك مباشرة. اشتراك بينجو يُدفع عن طريق الإدارة.',
    cta: 'سجّل كبائع',
  },
};

/** The "Pingo point": a ball flying along a dotted arc. Decorative. */
export function pingoPoint(cls = ''): string {
  const dots = [[18, 92, 3], [34, 70, 3.6], [52, 52, 4.2], [72, 38, 4.8], [94, 30, 5.4], [116, 30, 6]]
    .map(([x, y, r], i) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" opacity="${(0.25 + i * 0.12).toFixed(2)}"/>`).join('');
  return `<svg class="pp ${cls}" viewBox="0 0 200 120" aria-hidden="true">
    <defs><radialGradient id="ppBall" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#fff"/><stop offset=".7" stop-color="#f1f4f8"/><stop offset="1" stop-color="#c9d3e0"/></radialGradient></defs>
    ${dots}
    <circle cx="160" cy="44" r="30" fill="#7ed957" opacity=".35"/>
    <circle cx="160" cy="44" r="22" fill="url(#ppBall)"/>
    <ellipse cx="153" cy="36" rx="6" ry="4" fill="#fff" opacity=".9"/>
  </svg>`;
}

export const FOR_WHO: Record<JoinRole, string> = { player: 'بينجو للاعبين', organizer: 'بينجو للمنظمين', trainer: 'بينجو للمدربين', seller: 'بينجو للبائعين' };

const signupHref = (role: JoinRole) => (session.profile ? '#/me' : `#/login/signup${role === 'player' ? '' : '/' + role}`);

function overview(): string {
  const card = (r: JoinRole) => {
    const p = PAGES[r];
    return `<a class="jn-role jr-${r} rise" href="#/join/${r}">
      <span class="jn-role-ic">${icon(p.icon, 30)}</span>
      <b>${p.name}</b><small>${p.tag}</small>
      <span class="jn-role-go">التفاصيل ${icon('chevron', 16)}</span></a>`;
  };
  return `<section class="jn-hero jr-all">
    <div class="jn-hero-text"><span class="jn-soon">${icon('spark', 16)} قريباً</span>
      <h1>بينجو: ملتقى لاعبي تنس الطاولة</h1>
      <p>بطولات بنتائج مباشرة، تدريب بالحجز، ومتجر أدوات. اختر مكانك في بينجو قبل الإطلاق.</p></div>
    ${pingoPoint('jn-hero-pp')}</section>
  <div class="jn-roles">${JOIN_ROLES.map(card).join('')}</div>
  ${contact()}`;
}

function contact(): string {
  const wa = whatsappLink();
  return `<div class="card jn-contact"><div><b>عندك سؤال؟</b><p class="muted small">فريق بينجو يرد عليك على واتساب، أو اقرأ الأسئلة الشائعة.</p></div>
    <div class="row">${wa ? `<a class="btn green" href="${wa}" target="_blank" rel="noopener">${icon('whatsapp')} تواصل معنا</a>` : ''}
    <a class="btn soft" href="#/faq">${icon('help')} الأسئلة الشائعة</a></div></div>`;
}

function rolePage(r: JoinRole): string {
  const p = PAGES[r];
  const others = JOIN_ROLES.filter((x) => x !== r);
  return `<section class="jn-hero jr-${r}">
    <div class="jn-hero-text">
      <span class="jn-soon">${icon('spark', 16)} قريباً · ${FOR_WHO[r]}</span>
      <h1>${esc(p.title)}</h1>
      <p>${esc(p.lead)}</p>
      <div class="row"><a class="btn gold" href="${signupHref(r)}">${icon('user')} ${p.cta}</a>
        <button class="btn ghost" type="button" data-act="jn-scroll">${icon('grid')} كل المزايا</button></div>
    </div>
    <div class="jn-hero-art"><span class="jn-hero-ic">${icon(p.icon, 64)}</span>${pingoPoint('jn-hero-pp')}</div>
  </section>
  <div class="jn-highs">${p.highlights.map(([ic, h, s], i) => `<div class="jn-high rise"><span class="jn-num">${i + 1}</span><span class="jn-high-ic">${icon(ic, 26)}</span><b>${h}</b><small>${s}</small></div>`).join('')}</div>
  <div class="sec-head" id="jn-features"><h2>${icon('star', 22)} كل ما تحصل عليه</h2></div>
  <div class="jn-feats">${p.features.map(([ic, h, s]) => `<div class="jn-feat rise"><span class="jn-feat-ic">${icon(ic, 22)}</span><div><b>${h}</b><p>${s}</p></div></div>`).join('')}</div>
  <div class="jn-split">
    <div class="card jn-steps"><h2>${icon('bolt', 22)} كيف تبدأ</h2>
      <ol>${p.steps.map((s) => `<li><span>${esc(s)}</span></li>`).join('')}</ol></div>
    <div class="card jn-price"><h2>${icon('money', 22)} ${r === 'player' ? 'السعر' : 'أسعار الإطلاق'}</h2>
      <div class="jn-plans">${p.prices.map((x) => `<div class="jn-plan"><b>${x.amount}</b><span>${x.unit}</span>${x.note ? `<em>${x.note}</em>` : ''}</div>`).join('')}</div>
      <p class="muted small">${p.priceNote}</p>
      <a class="btn green block" href="${signupHref(r)}">${icon('user')} ${p.cta}</a></div>
  </div>
  <div class="sec-head"><h2>${icon('users', 22)} بينجو لغيرك أيضاً</h2><a class="more" href="#/join">الكل ${icon('chevron', 16)}</a></div>
  <div class="jn-roles small">${others.map((x) => `<a class="jn-role jr-${x}" href="#/join/${x}"><span class="jn-role-ic">${icon(PAGES[x].icon, 24)}</span><b>${PAGES[x].name}</b><small>${PAGES[x].tag}</small></a>`).join('')}</div>
  ${contact()}`;
}

export function route(parts: string[]): string | null {
  if (parts[0] !== 'join') return null;
  const r = parts[1] as JoinRole;
  return JOIN_ROLES.includes(r) ? rolePage(r) : overview();
}
