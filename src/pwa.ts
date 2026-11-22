/**
 * Pingo as an installable app (PWA): service worker registration, the
 * «ثبّت التطبيق» button, the home card and the #/install guide page.
 *
 * Android and desktop Chrome/Edge fire `beforeinstallprompt`, so the button
 * opens the browser's own install dialog. iPhone Safari has no such prompt,
 * so the button opens the illustrated "Share, Add to Home Screen" guide.
 * Nothing shows once Pingo already runs as the installed app.
 */
import { render } from './app/ctx';
import { icon } from './ui/icons';
import { toast } from './ui/util';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type Platform = 'ios' | 'android' | 'desktop';

let deferred: InstallPromptEvent | null = null;
let justInstalled = false;
let tab: Platform | null = null;
const HIDE_KEY = 'pingo.installHide';
const HIDE_DAYS = 14;

const base = () => import.meta.env.BASE_URL;

/** Running as the installed app (home screen icon), not in a browser tab. */
export function standalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: minimal-ui)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function platform(): Platform {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

export const installed = () => justInstalled || standalone();
/** One tap installs (Android/desktop), or the iPhone guide helps. */
export const canOffer = () => !installed() && (!!deferred || platform() === 'ios');

function hiddenByUser(): boolean {
  try {
    const at = Number(localStorage.getItem(HIDE_KEY) ?? 0);
    return Date.now() - at < HIDE_DAYS * 864e5;
  } catch { return false; }
}

/* ------------------------------------------------------------ set up */

export function init(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    render();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    justInstalled = true;
    toast('تم تثبيت بينجو 🎉 تجده الآن على شاشتك الرئيسية');
    render();
  });
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const hadWorker = !!navigator.serviceWorker.controller;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${base()}sw.js`, { scope: base() }).then((reg) => {
      // Look for a new deploy whenever the app comes back to the screen.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reg.update(); });
    }).catch(() => { /* the site still works without it */ });
  });
  // A new deploy took over while this page was open: offer a reload instead of forcing one mid-match.
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadWorker) updateBar(); });
}

function updateBar(): void {
  if (document.getElementById('pwa-update')) return;
  const bar = document.createElement('div');
  bar.id = 'pwa-update';
  bar.className = 'pwa-update';
  bar.setAttribute('role', 'status');
  bar.innerHTML = `${icon('spark', 18)}<span>نسخة جديدة من بينجو جاهزة</span>
    <button type="button" class="btn small" data-act="pwa-reload">حدّث الآن</button>
    <button type="button" class="pwa-x" data-act="pwa-later" aria-label="لاحقاً">${icon('x', 16)}</button>`;
  document.body.append(bar);
}

/* ------------------------------------------------------------ pieces */

/** Header button: shown only while installing is possible. */
export function headerButton(): string {
  if (!canOffer()) return '';
  return `<button type="button" class="installbtn" data-act="pwa-install" title="ثبّت تطبيق بينجو" aria-label="ثبّت تطبيق بينجو">
    ${icon('download', 18)}<span class="hide-sm">ثبّت التطبيق</span></button>`;
}

/** Home page card, until installed or put away for two weeks. */
export function homeCard(): string {
  if (installed() || hiddenByUser()) return '';
  if (!canOffer() && platform() !== 'android') return '';
  return `<section class="card pwa-card rise">
    <img class="pwa-card-ic" src="${base()}brand/icon-192.png" alt="" width="64" height="64">
    <div class="pwa-card-text"><b>بينجو على موبايلك كتطبيق</b>
      <small class="muted">أيقونة على الشاشة الرئيسية، يفتح بملء الشاشة وأسرع، ومجاني بدون متجر تطبيقات.</small></div>
    <div class="row"><button type="button" class="btn" data-act="pwa-install">${icon('download', 18)} ثبّت التطبيق</button>
      <a class="btn soft small" href="#/install">الطريقة</a></div>
    <button type="button" class="pwa-x" data-act="pwa-hide" title="إخفاء" aria-label="إخفاء">${icon('x', 16)}</button>
  </section>`;
}

/** Link-style button for other pages (coming soon page, profile). */
export function linkButton(cls = 'btn ghost'): string {
  if (installed()) return '';
  return `<a class="${cls}" href="#/install">${icon('download')} ثبّت التطبيق</a>`;
}

/* ------------------------------------------------------- guide drawings */

/** A tiny phone screen with one part lit up: the drawings in each step. */
const phone = (inner: string, cls = '') => `<div class="mk ${cls}" aria-hidden="true"><div class="mk-screen">${inner}</div></div>`;
const pageLines = '<div class="mk-page"><i></i><i></i><i class="s"></i><i></i><i class="s"></i></div>';
const appIcon = (label = true) => `<span class="mk-app"><img src="${base()}brand/icon-192.png" alt="">${label ? '<small>بينجو</small>' : ''}</span>`;

const IOS_BAR = phone(`<div class="mk-url">${icon('search', 10)}<span class="mk-u">omarhamad1974.github.io</span></div>${pageLines}
  <div class="mk-bar">${icon('back', 14)}${icon('chevron', 14)}<span class="mk-hit">${icon('share', 16)}</span>${icon('book', 14)}${icon('copy', 14)}</div>`);
const IOS_SHEET = phone(`${pageLines}<div class="mk-sheet"><div class="mk-row">${icon('copy', 12)} نسخ</div>
  <div class="mk-row">${icon('star', 12)} إضافة إلى المفضلة</div>
  <div class="mk-row mk-hit">${icon('plusSquare', 12)} إضافة إلى الشاشة الرئيسية</div></div>`);
const IOS_ADD = phone(`<div class="mk-dialog"><div class="mk-dhead"><span>إلغاء</span><b>الشاشة الرئيسية</b><span class="mk-hit mk-word">إضافة</span></div>
  <div class="mk-dbody">${appIcon(false)}<div><b>بينجو</b><small>github.io</small></div></div>
  <div class="mk-toggle"><span>فتح كتطبيق ويب</span><i class="on"></i></div></div>`);
const HOME = phone(`<div class="mk-home">${'<span class="mk-blank"></span>'.repeat(6)}<span class="mk-hit mk-round">${appIcon()}</span>${'<span class="mk-blank"></span>'.repeat(5)}</div>`, 'mk-wall');

const AND_MENU = phone(`<div class="mk-url">${icon('search', 10)}<span class="mk-u">omarhamad1974.github.io</span> <span class="mk-hit mk-round">${icon('dotsV', 14)}</span></div>${pageLines}`);
const AND_LIST = phone(`<div class="mk-menu"><div class="mk-row">${icon('plus', 12)} علامة تبويب جديدة</div>
  <div class="mk-row">${icon('star', 12)} الإشارات المرجعية</div>
  <div class="mk-row mk-hit">${icon('download', 12)} تثبيت التطبيق</div>
  <div class="mk-row">${icon('share', 12)} مشاركة</div></div>${pageLines}`);
const AND_OK = phone(`${pageLines}<div class="mk-sheet"><div class="mk-dbody">${appIcon(false)}<div><b>تثبيت التطبيق</b><small>بينجو</small></div></div>
  <div class="mk-btns"><span>إلغاء</span><span class="mk-hit mk-word">تثبيت</span></div></div>`);

const PC_BAR = phone(`<div class="mk-url">${icon('search', 10)}<span class="mk-u">omarhamad1974.github.io</span> <span class="mk-hit mk-round">${icon('download', 13)}</span></div>${pageLines}`, 'mk-wide');
const PC_OK = phone(`${pageLines}<div class="mk-pop"><div class="mk-dbody">${appIcon(false)}<div><b>تثبيت التطبيق؟</b><small>بينجو</small></div></div>
  <div class="mk-btns"><span class="mk-hit mk-word">تثبيت</span><span>إلغاء</span></div></div>`, 'mk-wide');
const PC_WIN = phone(`<div class="mk-win"><span>${appIcon(false)} بينجو</span></div>${pageLines}`, 'mk-wide');

const GUIDES: Record<Platform, { name: string; ic: string; sub: string; steps: [string, string, string][]; note?: string }> = {
  ios: {
    name: 'آيفون وآيباد', ic: 'phone', sub: 'من متصفح Safari',
    steps: [
      [IOS_BAR, 'اضغط زر المشاركة', 'افتح بينجو في Safari واضغط زر المشاركة (مربع وسهم لأعلى). في iOS 26 اضغط ⋯ أولاً ثم «مشاركة».'],
      [IOS_SHEET, 'إضافة إلى الشاشة الرئيسية', 'مرّر القائمة لأسفل واختر «إضافة إلى الشاشة الرئيسية».'],
      [IOS_ADD, 'اضغط «إضافة»', 'اترك «فتح كتطبيق ويب» مفعّلاً، ثم اضغط «إضافة» أعلى الشاشة.'],
      [HOME, 'افتح بينجو من شاشتك', 'أيقونة بينجو الآن على شاشتك الرئيسية، افتحها مثل أي تطبيق.'],
    ],
    note: 'من كروم على آيفون (iOS 16.4 وأحدث): زر المشاركة في شريط العنوان، ثم نفس الخطوات.',
  },
  android: {
    name: 'أندرويد', ic: 'phone', sub: 'من متصفح كروم',
    steps: [
      [AND_MENU, 'افتح القائمة ⋮', 'افتح بينجو في كروم واضغط النقاط الثلاث أعلى الشاشة.'],
      [AND_LIST, '«تثبيت التطبيق»', 'اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».'],
      [AND_OK, 'اضغط «تثبيت»', 'وافق على التثبيت. لا يحتاج مساحة تقريباً ولا متجر تطبيقات.'],
      [HOME, 'افتح بينجو من شاشتك', 'ستجد أيقونة بينجو مع تطبيقاتك.'],
    ],
    note: 'في سامسونج إنترنت: القائمة ☰ ثم «إضافة صفحة إلى» ثم «الشاشة الرئيسية».',
  },
  desktop: {
    name: 'الكمبيوتر', ic: 'grid', sub: 'كروم أو إيدج',
    steps: [
      [PC_BAR, 'أيقونة التثبيت', 'اضغط أيقونة التثبيت في آخر شريط العنوان، أو القائمة ⋮ ثم «تثبيت بينجو».'],
      [PC_OK, 'اضغط «تثبيت»', 'وافق في النافذة الصغيرة.'],
      [PC_WIN, 'نافذة خاصة ببينجو', 'يفتح بينجو في نافذة مستقلة، وتجده في قائمة البرامج وشريط المهام.'],
    ],
    note: 'على ماك من Safari: قائمة «ملف» ثم «إضافة إلى Dock».',
  },
};

/* --------------------------------------------------------------- page */

export function installPage(): string {
  const here = platform();
  const show = tab ?? here;
  const g = GUIDES[show];
  const order: Platform[] = [here, ...(['ios', 'android', 'desktop'] as Platform[]).filter((p) => p !== here)];
  const perks: [string, string, string][] = [
    ['bolt', 'يفتح بلمسة', 'أيقونة بينجو على شاشتك الرئيسية بجانب تطبيقاتك.'],
    ['eye', 'ملء الشاشة', 'بدون شريط المتصفح، مثل أي تطبيق.'],
    ['wifiOff', 'أسرع ومع إشارة ضعيفة', 'الصفحات محفوظة على جهازك فتفتح فوراً.'],
    ['spark', 'يتحدّث وحده', 'كل جديد في بينجو يصلك تلقائياً بدون تحميل.'],
  ];
  const done = installed();
  return `<section class="pwa-hero rise">
    <div class="pwa-hero-text">
      <span class="kicker">${icon('download', 16)} تطبيق بينجو</span>
      <h1>${done ? 'بينجو مثبّت على جهازك ✓' : 'ثبّت بينجو على موبايلك'}</h1>
      <p>${done ? 'أنت تستخدم تطبيق بينجو الآن. افتحه في أي وقت من أيقونته على شاشتك.'
        : 'نفس موقع بينجو بحسابك وبياناتك، لكن كتطبيق على شاشتك. مجاني، بدون متجر تطبيقات، وحجمه صغير جداً.'}</p>
      ${done ? '' : deferred
        ? `<button type="button" class="btn gold big" data-act="pwa-install">${icon('download')} ثبّت الآن</button>`
        : `<button type="button" class="btn gold big" data-act="pwa-scroll">${icon('chevron')} شاهد الخطوات</button>`}
    </div>
    <div class="pwa-hero-art" aria-hidden="true">${HOME}</div>
  </section>
  <div class="pwa-perks">${perks.map(([ic, h, s], i) => `<div class="pwa-perk rise" style="--i:${i}"><span>${icon(ic, 24)}</span><b>${h}</b><small>${s}</small></div>`).join('')}</div>
  ${done ? '' : `<div class="sec-head" id="pwa-steps"><h2>${icon('book', 22)} طريقة التثبيت</h2></div>
  <div class="pwa-tabs" role="tablist">${order.map((p) => `<button type="button" role="tab" data-act="pwa-tab" data-p="${p}" aria-selected="${p === show}">
    ${icon(GUIDES[p].ic, 18)}<span><b>${GUIDES[p].name}</b><small>${p === here ? 'جهازك' : GUIDES[p].sub}</small></span></button>`).join('')}</div>
  <ol class="pwa-steps">${g.steps.map(([art, h, s], i) => `<li class="pwa-step rise" style="--i:${i}">${art}
    <div><span class="pwa-num">${i + 1}</span><b>${h}</b><p>${s}</p></div></li>`).join('')}</ol>
  ${g.note ? `<p class="muted small pwa-note">${icon('bulb', 16)} ${g.note}</p>` : ''}`}
  <a class="card faq-cta rise" href="#/faq"><span class="faq-ic">${icon('help', 26)}</span>
    <span><b>محتاج مساعدة؟</b><br><small class="muted">اقرأ الأسئلة الشائعة أو كلّمنا على واتساب من الزر الأخضر.</small></span>${icon('chevron', 18)}</a>`;
}

/* -------------------------------------------------------------- clicks */

export async function onClick(act: string, el: HTMLElement): Promise<void> {
  if (act === 'pwa-install') {
    if (!deferred) { location.hash = '#/install'; return; }
    const ev = deferred;
    deferred = null;
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    if (outcome === 'dismissed') toast('يمكنك تثبيت بينجو في أي وقت من زر «ثبّت التطبيق»');
    render();
  } else if (act === 'pwa-hide') {
    try { localStorage.setItem(HIDE_KEY, String(Date.now())); } catch { /* ignore */ }
    render();
  } else if (act === 'pwa-tab') {
    tab = el.dataset.p as Platform;
    render();
  } else if (act === 'pwa-scroll') {
    document.getElementById('pwa-steps')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (act === 'pwa-reload') {
    location.reload();
  } else if (act === 'pwa-later') {
    document.getElementById('pwa-update')?.remove();
  }
}
