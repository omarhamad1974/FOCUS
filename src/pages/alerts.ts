/**
 * Notifications: the 🔔 in the header with its unread count and drop-down list,
 * the #/alerts page (all alerts, and the settings tab: phone notifications and
 * each alert type on or off), the "turn on phone notifications" card on the
 * home page, and the ⭐ follow button of sports shops.
 *
 * Alerts are made by the database (migration 0020) whenever something happens
 * for someone; phone notifications go out through the send-push Edge Function
 * to the devices that allowed them (pwa/sw.js shows them).
 */
import { online } from '../config';
import { canOrganize, isAdmin, isSeller, render, rendering, session } from '../app/ctx';
import * as data from '../data/alerts';
import type { Alert, AlertKind, Prefs } from '../data/alerts';
import { platform, standalone } from '../pwa';
import { icon } from '../ui/icons';
import { esc, toast } from '../ui/util';

/* ------------------------------------------------------------ alert types */

interface KindInfo { label: string; hint: string; ic: string; tone: string; who: () => boolean }
const everyone = () => true;
export const KIND_INFO: Record<AlertKind, KindInfo> = {
  invites: { label: 'دعوات البطولات', hint: 'عندما يدعوك منظم لبطولة', ic: 'mail', tone: 'gold', who: everyone },
  entries: { label: 'قبولك في البطولات', hint: 'قبول أو رفض طلبك، والخروج من قائمة الانتظار', ic: 'check', tone: 'green', who: everyone },
  results: { label: 'القرعة والنتائج', hint: 'بدء البطولة، نتيجة كل مباراة لك، والبطل', ic: 'trophy', tone: 'gold', who: everyone },
  payments: { label: 'المدفوعات', hint: 'تأكيد دفعك، وإيصالات تصلك إن كنت تستقبل مدفوعات', ic: 'money', tone: 'green', who: everyone },
  bookings: { label: 'الحجوزات', hint: 'تأكيد أو إلغاء حجز صالة أو تدريب، وحجوزات جديدة لديك', ic: 'calendar', tone: 'blue', who: everyone },
  orders: { label: 'الطلبات', hint: 'حالة طلباتك من المتجر، وطلبات جديدة للبائع', ic: 'cart', tone: 'blue', who: everyone },
  promos: { label: 'عروض المتاجر المفضلة', hint: 'عرض جديد من متجر تتابعه ⭐', ic: 'gift', tone: 'red', who: everyone },
  requests: { label: 'طلبات الانضمام والانسحاب', hint: 'لاعب يطلب الانضمام أو ينسحب أو يعتذر عن دعوة', ic: 'userPlus', tone: 'blue', who: () => canOrganize() },
  capacity: { label: 'اقتراب اكتمال العدد', hint: 'عند 80% من الحد الأقصى وعند الاكتمال', ic: 'users', tone: 'gold', who: () => canOrganize() },
  products: { label: 'المنتجات', hint: isAdminText('منتجات تنتظر الموافقة', 'الموافقة على منتجاتك'), ic: 'shop', tone: 'blue', who: () => isSeller() || isAdmin() },
  roles: { label: 'الأدوار والاشتراكات', hint: 'نتيجة طلب دور، واشتراك يقترب من نهايته', ic: 'star', tone: 'red', who: everyone },
};
function isAdminText(a: string, b: string): string { return `${b}، أو ${a} للإدارة`; }

const visibleKinds = () => data.KINDS.filter((k) => KIND_INFO[k].who());

/* ------------------------------------------------------------ state */

let items: Alert[] | null = null;
let count = 0;
let open = false;
let loading = false;
let missing = false;
/** Alerts that were unread when the list was opened: they stay highlighted this time. */
const fresh = new Set<string>();
let prefs: Prefs | null = null;
let devices: number | null = null;
let pushBusy = false;
let timer: number | undefined;
let follows: Set<string> | null = null;
const followerCount = new Map<string, number>();
const NUDGE_KEY = 'pingo.pushNudgeHide';

const signedIn = () => online() && !!session.profile && rendering.preview === 'off';

export function reset(): void {
  items = null; count = 0; open = false; prefs = null; devices = null; follows = null; fresh.clear(); followerCount.clear();
  setBadge(0);
}

/** After sign-in (and every refresh): count now, then keep it fresh while the app is on screen. */
export function start(): void {
  if (!online() || !session.profile) { stop(); return; }
  void poll(true);
  if (timer === undefined) {
    timer = window.setInterval(() => { if (document.visibilityState === 'visible') void poll(); }, 60_000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && session.profile) void poll(); });
    // A phone notification arrived while the app is open, or one was tapped.
    navigator.serviceWorker?.addEventListener('message', (e) => {
      const msg = e.data as { type?: string; link?: string } | null;
      if (msg?.type === 'pingo-alert') void poll();
      if (msg?.type === 'pingo-open' && msg.link) location.hash = msg.link;
    });
  }
  void resaveDevice();
}

function stop(): void {
  if (timer !== undefined) { clearInterval(timer); timer = undefined; }
}

async function poll(first = false): Promise<void> {
  if (!session.profile) return;
  try {
    if (first) await data.refresh().catch(() => undefined);
    const n = await data.unread();
    const changed = n !== count;
    count = n;
    setBadge(n);
    if (changed) {
      if (items !== null) items = await data.list();
      render();
    }
  } catch (e) {
    missing = data.isMissing(e);
  }
}

/** The number on the installed app's icon (where the phone supports it). */
function setBadge(n: number): void {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try { if (n > 0) void nav.setAppBadge?.(n).catch(() => undefined); else void nav.clearAppBadge?.().catch(() => undefined); } catch { /* not supported */ }
}

function loadList(markSeen: boolean): void {
  if (loading || !session.profile) return;
  loading = true;
  data.list().then(async (rows) => {
    items = rows;
    if (markSeen && rows.some((r) => !r.read_at)) {
      rows.filter((r) => !r.read_at).forEach((r) => fresh.add(r.id));
      await data.markRead(null);
      rows.forEach((r) => { r.read_at = r.read_at ?? new Date().toISOString(); });
      count = 0; setBadge(0);
    }
  }).catch((e) => { missing = data.isMissing(e); items = []; })
    .finally(() => { loading = false; render(); });
}

/* ------------------------------------------------------------ time */

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'الآن';
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? 'منذ دقيقة' : m === 2 ? 'منذ دقيقتين' : m <= 10 ? `منذ ${m} دقائق` : `منذ ${m} دقيقة`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? 'منذ ساعة' : h === 2 ? 'منذ ساعتين' : h <= 10 ? `منذ ${h} ساعات` : `منذ ${h} ساعة`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'أمس';
  if (d === 2) return 'منذ يومين';
  return d <= 10 ? `منذ ${d} أيام` : new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' }).format(new Date(iso));
}

function dayGroup(iso: string): string {
  const d = new Date(iso); const now = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 864e5);
  return diff <= 0 ? 'اليوم' : diff === 1 ? 'أمس' : diff < 7 ? 'هذا الأسبوع' : 'أقدم';
}

/* ------------------------------------------------------------ pieces */

function row(a: Alert, compact: boolean): string {
  const k = KIND_INFO[a.kind] ?? KIND_INFO.roles;
  const isNew = !a.read_at || fresh.has(a.id);
  return `<li class="al-item ${isNew ? 'new' : ''}">
    <button type="button" class="al-open" data-act="al-go" data-id="${a.id}" data-link="${esc(a.link ?? '#/alerts')}">
      <span class="al-ic tone-${k.tone}">${icon(a.icon || k.ic, compact ? 18 : 20)}</span>
      <span class="al-text"><b dir="auto">${esc(a.title)}${a.count > 1 ? ` <i class="al-count">×${a.count}</i>` : ''}</b>
        ${a.body ? `<small dir="auto">${esc(a.body)}</small>` : ''}
        <em>${ago(a.created_at)}${compact ? '' : ` · ${esc(k.label)}`}</em></span>
    </button>
    ${compact ? '' : `<button type="button" class="al-del" data-act="al-del" data-id="${a.id}" title="حذف" aria-label="حذف">${icon('x', 14)}</button>`}
  </li>`;
}

function emptyState(): string {
  return `<div class="al-empty"><span class="al-bellart" aria-hidden="true">${icon('bell', 34)}</span>
    <b>${missing ? 'التنبيهات قيد التفعيل' : 'لا توجد تنبيهات بعد'}</b>
    <small class="muted">${missing ? 'ستظهر هنا بعد تحديث قاعدة البيانات.' : 'سنخبرك هنا بالدعوات والقبول والنتائج والمدفوعات والحجوزات.'}</small></div>`;
}

/** Header button and, when open, its drop-down. */
export function bell(): string {
  if (!signedIn()) return '';
  const panel = open ? `<div class="al-panel rise" role="dialog" aria-label="التنبيهات">
      <div class="al-phead"><b>${icon('bell', 18)} التنبيهات</b>
        <a class="al-gear" href="#/alerts/settings" data-act="al-close" title="إعدادات التنبيهات" aria-label="إعدادات التنبيهات">${icon('edit', 16)}</a></div>
      ${items === null ? `<p class="muted center al-wait"><span class="spin"></span></p>`
        : items.length ? `<ul class="al-list">${items.slice(0, 8).map((a) => row(a, true)).join('')}</ul>` : emptyState()}
      ${pushOffHint()}
      <a class="al-all" href="#/alerts" data-act="al-close">كل التنبيهات ${icon('chevron', 14)}</a>
    </div>` : '';
  return `<span class="al-wrap"><button type="button" class="helpbtn bellbtn ${count ? 'has-new' : ''}" data-act="al-toggle" aria-expanded="${open}"
      title="التنبيهات" aria-label="التنبيهات${count ? `: ${count} جديد` : ''}">${icon('bell', 19)}${count ? `<i class="al-badge">${count > 99 ? '99+' : count}</i>` : ''}</button>${panel}</span>`;
}

function pushOffHint(): string {
  const st = pushState();
  if (st !== 'off' && st !== 'install') return '';
  return `<a class="al-pushhint" href="#/alerts/settings" data-act="al-close">${icon('phone', 16)}
    <span>${st === 'install' ? 'ثبّت بينجو على الآيفون لتصلك الإشعارات على الشاشة' : 'فعّل إشعارات الموبايل لتصلك حتى والتطبيق مغلق'}</span></a>`;
}

/* ------------------------------------------------------------ phone push */

function pushFlag(): boolean {
  try { return localStorage.getItem('pingo.pushOn') === '1'; } catch { return false; }
}

type PushState = 'unsupported' | 'install' | 'denied' | 'off' | 'on' | 'dev';

function pushState(): PushState {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return platform() === 'ios' && !standalone() ? 'install' : 'unsupported';
  }
  if (!import.meta.env.PROD) return 'dev';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'granted' && pushFlag()) return 'on';
  return 'off';
}

function deviceName(): string {
  const p = platform();
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Firefox/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '';
  return `${p === 'ios' ? 'iPhone' : p === 'android' ? 'Android' : 'Computer'} ${browser}${standalone() ? ' (app)' : ''}`.trim();
}

function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function subscribeDevice(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const key = await data.pushKey();
  let sub = await reg.pushManager.getSubscription();
  if (sub && sub.options.applicationServerKey) {
    const old = new Uint8Array(sub.options.applicationServerKey);
    const want = keyBytes(key);
    if (old.length !== want.length || old.some((b, i) => b !== want[i])) { await sub.unsubscribe(); sub = null; }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  const j = sub.toJSON();
  await data.saveDevice(j.endpoint!, j.keys!.p256dh, j.keys!.auth, deviceName());
  try { localStorage.setItem('pingo.pushOn', '1'); } catch { /* ignore */ }
}

async function enablePush(): Promise<void> {
  const st = pushState();
  if (st === 'install') { location.hash = '#/install'; return; }
  if (st === 'unsupported') { toast('هذا المتصفح لا يدعم الإشعارات. جرّب كروم أو ثبّت التطبيق.'); return; }
  if (st === 'dev') { toast('إشعارات الموبايل تعمل في النسخة المنشورة فقط'); return; }
  if (st === 'denied') { toast('الإشعارات مرفوضة من إعدادات المتصفح. اسمح بها لموقع بينجو ثم جرّب مرة أخرى.'); return; }
  pushBusy = true; render();
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('لم يتم السماح بالإشعارات'); return; }
    await subscribeDevice();
    devices = null;
    toast('تم تفعيل إشعارات الموبايل 🔔');
  } catch (e) {
    toast(`تعذّر تفعيل الإشعارات (${(e instanceof Error ? e.message : String(e)).slice(0, 120)})`);
  } finally { pushBusy = false; render(); }
}

async function disablePush(): Promise<void> {
  pushBusy = true; render();
  try {
    await forgetDevice();
    toast('أُوقفت إشعارات الموبايل على هذا الجهاز');
  } finally { pushBusy = false; devices = null; render(); }
}

/** This device stops getting the signed-in person's pushes (also on sign-out). */
export async function forgetDevice(): Promise<void> {
  try { localStorage.removeItem('pingo.pushOn'); } catch { /* ignore */ }
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await data.removeDevice(sub.endpoint).catch(() => undefined);
      await sub.unsubscribe().catch(() => undefined);
    }
  } catch { /* nothing to forget */ }
  stop();
}

/** Push already allowed here: make sure this device is still linked to whoever is signed in now. */
async function resaveDevice(): Promise<void> {
  if (pushState() !== 'on') return;
  try { await subscribeDevice(); } catch { /* try again next time */ }
}

async function testNotification(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('بينجو 🏓', {
      body: 'هكذا ستصلك التنبيهات: الدعوات والقبول والنتائج والمدفوعات.',
      icon: `${import.meta.env.BASE_URL}brand/icon-192.png`, badge: `${import.meta.env.BASE_URL}brand/icon-192.png`,
      dir: 'rtl', lang: 'ar', tag: 'pingo-test', data: { link: '#/alerts' },
    });
  } catch { toast('تعذّر عرض إشعار تجريبي'); }
}

/* ------------------------------------------------------------ cards */

/** Home page: one friendly nudge to turn phone notifications on. */
export function homeNudge(): string {
  if (!signedIn()) return '';
  const st = pushState();
  if (st !== 'off') return '';
  try { if (Date.now() - Number(localStorage.getItem(NUDGE_KEY) ?? 0) < 21 * 864e5) return ''; } catch { /* show */ }
  return `<section class="card al-nudge rise">
    <span class="al-nudge-art" aria-hidden="true">${icon('bell', 30)}<i></i></span>
    <div><b>لا تفوّت دعوة أو نتيجة</b><small class="muted">فعّل إشعارات الموبايل: تصلك الدعوات والقبول والنتائج وتأكيد الدفع حتى والتطبيق مغلق.</small></div>
    <div class="row"><button type="button" class="btn gold" data-act="al-push-on" ${pushBusy ? 'disabled' : ''}>${icon('bell', 18)} فعّل الإشعارات</button></div>
    <button type="button" class="pwa-x" data-act="al-nudge-hide" title="إخفاء" aria-label="إخفاء">${icon('x', 16)}</button>
  </section>`;
}

/** #/me: shortcut to the alert settings. */
export function meCard(): string {
  if (!signedIn()) return '';
  const st = pushState();
  const label = st === 'on' ? 'مفعّلة على هذا الجهاز' : st === 'install' ? 'ثبّت التطبيق أولاً (آيفون)' : st === 'denied' ? 'مرفوضة من المتصفح' : 'غير مفعّلة';
  return `<a class="card al-mecard" href="#/alerts/settings"><span class="al-ic tone-gold">${icon('bell', 22)}</span>
    <span><b>التنبيهات والإشعارات</b><small class="muted">إشعارات الموبايل: ${label}. اختر ما يصلك من كل نوع.</small></span>${icon('chevron', 18)}</a>`;
}

/* ------------------------------------------------------------ page */

export function page(parts: string[]): string {
  if (!session.profile) return '';
  const tab = parts[1] === 'settings' ? 'settings' : 'list';
  if (tab === 'list' && items === null) loadList(true);
  if (tab === 'list' && items && count > 0) loadList(true);
  const head = `<section class="banner b-alerts slim rise"><div><h1>${icon('bell', 26)} التنبيهات</h1>
    <p>كل ما يخصك في بينجو في مكان واحد، ويصلك على الموبايل إن فعّلت الإشعارات.</p></div></section>
    <div class="al-tabs" role="tablist">
      <a role="tab" href="#/alerts" aria-selected="${tab === 'list'}">${icon('bell', 16)} التنبيهات</a>
      <a role="tab" href="#/alerts/settings" aria-selected="${tab === 'settings'}">${icon('edit', 16)} الإعدادات</a></div>`;
  return head + (tab === 'list' ? listView() : settingsView());
}

function listView(): string {
  if (items === null) return `<div class="card center muted"><span class="spin"></span></div>`;
  if (!items.length) return `<div class="card">${emptyState()}</div>${pushCard()}`;
  const groups = new Map<string, Alert[]>();
  items.forEach((a) => { const g = dayGroup(a.created_at); groups.set(g, [...(groups.get(g) ?? []), a]); });
  return `${pushState() === 'off' || pushState() === 'install' ? pushCard() : ''}
    ${[...groups].map(([g, rows]) => `<h3 class="al-day">${g}</h3><ul class="al-list card">${rows.map((a) => row(a, false)).join('')}</ul>`).join('')}
    <div class="row al-actions"><button type="button" class="btn ghost small" data-act="al-clear">${icon('trash', 16)} حذف المقروءة</button></div>`;
}

function pushCard(): string {
  const st = pushState();
  const states: Record<PushState, [string, string, string]> = {
    on: ['green', 'مفعّلة على هذا الجهاز ✓', 'تصلك التنبيهات على شاشة الموبايل حتى والتطبيق مغلق.'],
    off: ['gold', 'غير مفعّلة على هذا الجهاز', 'فعّلها لتصلك الدعوات والقبول والنتائج وتأكيد الدفع فوراً.'],
    install: ['gold', 'على الآيفون: ثبّت بينجو أولاً', 'آبل تسمح بالإشعارات للتطبيق المثبّت على الشاشة الرئيسية فقط (iOS 16.4 وأحدث). ثبّته ثم افتحه من أيقونته وفعّل الإشعارات.'],
    denied: ['red', 'مرفوضة من إعدادات المتصفح', 'افتح إعدادات الموقع في المتصفح واسمح بالإشعارات لبينجو، ثم ارجع هنا.'],
    unsupported: ['', 'هذا المتصفح لا يدعم الإشعارات', 'جرّب كروم على أندرويد أو الكمبيوتر، أو سفاري على آيفون بعد تثبيت التطبيق.'],
    dev: ['', 'تعمل في النسخة المنشورة فقط', 'الإشعارات تحتاج نسخة الموقع المنشورة (https مع عامل الخدمة).'],
  };
  const [tone, h, s] = states[st];
  if (st === 'on' && devices === null && session.profile) {
    devices = -1;
    data.myDevices().then((n) => { devices = n; render(); }).catch(() => { devices = 0; });
  }
  return `<section class="card al-push">
    <span class="al-push-art tone-${tone || 'muted'}" aria-hidden="true">${icon('phone', 30)}<i>${icon('bell', 14)}</i></span>
    <div class="al-push-text"><span class="lbl">إشعارات الموبايل</span><b>${h}</b><small class="muted">${s}</small>
      ${st === 'on' && devices && devices > 0 ? `<small class="muted">${icon('phone', 12)} أجهزتك المفعّلة: ${devices}</small>` : ''}</div>
    <div class="row">
      ${st === 'off' || st === 'denied' ? `<button type="button" class="btn gold" data-act="al-push-on" ${pushBusy ? 'disabled' : ''}>${icon('bell', 18)} فعّل الإشعارات</button>` : ''}
      ${st === 'install' ? `<a class="btn gold" href="#/install">${icon('download', 18)} طريقة التثبيت</a>` : ''}
      ${st === 'on' ? `<button type="button" class="btn soft small" data-act="al-push-test">${icon('spark', 16)} إشعار تجريبي</button>
        <button type="button" class="btn ghost small" data-act="al-push-off" ${pushBusy ? 'disabled' : ''}>${icon('x', 16)} أوقفها هنا</button>` : ''}
    </div></section>`;
}

function settingsView(): string {
  if (prefs === null && session.profile) {
    prefs = { app_off: [], push_off: [] };
    data.prefs().then((p) => { prefs = p; render(); }).catch((e) => { missing = data.isMissing(e); });
  }
  const p = prefs!;
  const sw = (kind: AlertKind, which: 'app' | 'push', on: boolean, disabled = false) =>
    `<button type="button" class="al-switch" role="switch" aria-checked="${on}" data-act="al-pref" data-k="${kind}" data-w="${which}" ${disabled ? 'disabled' : ''}
      aria-label="${which === 'app' ? 'داخل التطبيق' : 'على الموبايل'}: ${esc(KIND_INFO[kind].label)}"><i></i></button>`;
  return `${pushCard()}
  <section class="card">
    <h2>${icon('bell', 22)} ماذا يصلك؟</h2>
    <p class="hint">اختر لكل نوع: يظهر في الجرس داخل التطبيق، و/أو يصلك إشعاراً على الموبايل. نوع موقوف داخل التطبيق لا يصل للموبايل أيضاً.</p>
    <div class="al-prefs">
      <div class="al-prow al-phead2"><span></span><small>${icon('bell', 14)} التطبيق</small><small>${icon('phone', 14)} الموبايل</small></div>
      ${visibleKinds().map((k) => {
        const appOn = !p.app_off.includes(k);
        const pushOn = appOn && !p.push_off.includes(k);
        return `<div class="al-prow"><span class="al-plabel"><span class="al-ic tone-${KIND_INFO[k].tone}">${icon(KIND_INFO[k].ic, 18)}</span>
          <span><b>${KIND_INFO[k].label}</b><small class="muted">${KIND_INFO[k].hint}</small></span></span>
          ${sw(k, 'app', appOn)}${sw(k, 'push', pushOn, !appOn)}</div>`;
      }).join('')}
    </div>
    <p class="small muted">${icon('whatsapp', 14)} لا نرسل رسائل بريد أو واتساب تلقائية. المنظم يرسل رسائل واتساب جاهزة بنفسه بلمسة.</p>
  </section>`;
}

/* ------------------------------------------------------------ shops */

/** ⭐ Follow a sports shop: its new promotions reach the follower as alerts. */
export function followButton(shopId: string, cls = 'btn soft'): string {
  if (!online()) return '';
  if (!followerCount.has(shopId)) {
    followerCount.set(shopId, -1);
    data.followers(shopId).then((n) => { followerCount.set(shopId, n); render(); }).catch(() => followerCount.set(shopId, 0));
  }
  const fans = followerCount.get(shopId) ?? -1;
  const fansText = fans > 0 ? ` <small class="al-fans">${fans}</small>` : '';
  if (!session.profile) return `<a class="${cls}" href="#/login">${icon('star', 18)} تابع المتجر${fansText}</a>`;
  if (follows === null) {
    follows = new Set();
    data.followedShops().then((ids) => { follows = new Set(ids); render(); }).catch(() => undefined);
  }
  const on = follows.has(shopId);
  return `<button type="button" class="${cls} al-follow ${on ? 'on' : ''}" data-act="al-follow" data-id="${shopId}" aria-pressed="${on}"
    title="${on ? 'تتابع هذا المتجر: تصلك عروضه الجديدة' : 'تابع المتجر لتصلك عروضه الجديدة'}">${icon('star', 18)} ${on ? 'تتابعه' : 'تابع المتجر'}${fansText}</button>`;
}

/* ------------------------------------------------------------ clicks */

export async function onClick(act: string, el: HTMLElement): Promise<void> {
  switch (act) {
    case 'al-toggle':
      open = !open;
      if (open) loadList(true);
      render();
      break;
    case 'al-close':
      open = false;
      break;
    case 'al-go': {
      open = false;
      const link = el.dataset.link || '#/alerts';
      if (location.hash === link) render(); else location.hash = link;
      break;
    }
    case 'al-del': {
      const id = el.dataset.id!;
      items = (items ?? []).filter((a) => a.id !== id);
      render();
      await data.remove(id).catch(() => toast('تعذّر الحذف'));
      break;
    }
    case 'al-clear':
      try { await data.clearRead(); items = (items ?? []).filter((a) => !a.read_at); fresh.clear(); } catch { toast('تعذّر الحذف'); }
      render();
      break;
    case 'al-pref': {
      if (!prefs) return;
      const k = el.dataset.k as AlertKind;
      const list = el.dataset.w === 'app' ? prefs.app_off : prefs.push_off;
      const i = list.indexOf(k);
      if (i >= 0) list.splice(i, 1); else list.push(k);
      render();
      try { await data.setPrefs(prefs); } catch { toast('تعذّر حفظ الإعدادات'); }
      break;
    }
    case 'al-push-on': await enablePush(); break;
    case 'al-push-off': await disablePush(); break;
    case 'al-push-test': await testNotification(); break;
    case 'al-nudge-hide':
      try { localStorage.setItem(NUDGE_KEY, String(Date.now())); } catch { /* ignore */ }
      render();
      break;
    case 'al-follow': {
      const id = el.dataset.id!;
      if (!follows) return;
      const on = !follows.has(id);
      if (on) follows.add(id); else follows.delete(id);
      const fans = followerCount.get(id) ?? 0;
      if (fans >= 0) followerCount.set(id, Math.max(0, fans + (on ? 1 : -1)));
      render();
      try {
        await data.follow(id, on);
        toast(on ? '⭐ تتابع المتجر الآن: ستصلك عروضه الجديدة' : 'ألغيت متابعة المتجر');
      } catch {
        if (on) follows.delete(id); else follows.add(id);
        toast('تعذّر الحفظ');
        render();
      }
      break;
    }
  }
}

/** Close the drop-down when tapping elsewhere. */
document.addEventListener('click', (e) => {
  if (!open) return;
  const t = e.target as HTMLElement;
  if (t.closest('.al-wrap')) return;
  open = false;
  render();
});
document.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') { open = false; render(); } });
window.addEventListener('hashchange', () => { open = false; });
