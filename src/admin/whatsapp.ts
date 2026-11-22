/**
 * Ready-made WhatsApp messages for the organizer (free wa.me links, nothing is
 * sent automatically): pick a message, adjust the text, then send it to the
 * tournament's WhatsApp group or to each player with one tap.
 */
import { dateFmt } from '../i18n/ar';
import { render } from '../app/ctx';
import { tournamentContacts, type Contact } from '../data/alerts';
import { waNumber } from '../data/pay';
import { feeOf } from '../domain/payments';
import type { Tournament } from '../domain/types';
import { icon } from '../ui/icons';
import { esc, toast } from '../ui/util';

type Tpl = 'open' | 'accepted' | 'reminder' | 'fee' | 'draw' | 'results';
type Who = 'all' | 'approved' | 'pending' | 'unpaid';

const TPLS: [Tpl, string, string][] = [
  ['open', 'tag', 'التسجيل مفتوح'],
  ['accepted', 'check', 'تم قبولك'],
  ['reminder', 'calendar', 'تذكير بالموعد'],
  ['fee', 'money', 'تذكير بالرسوم'],
  ['draw', 'grid', 'القرعة جاهزة'],
  ['results', 'trophy', 'النتائج والبطل'],
];

function text(tpl: Tpl, tm: Tournament): string {
  const link = `${location.origin}${location.pathname}#/t/${tm.id}`;
  const when = [tm.date ? dateFmt.format(new Date(tm.date)) : '', tm.time ? `الساعة ${tm.time}` : ''].filter(Boolean).join(' ');
  const where = tm.location ? `📍 ${tm.location}` : '';
  const fee = feeOf(tm);
  const lines: Record<Tpl, string[]> = {
    open: [`🏓 التسجيل مفتوح في بطولة «${tm.name}»`, when && `📅 ${when}`, where, fee ? `💰 رسوم الاشتراك ${fee} ج.م` : '', `سجّل من هنا: ${link}`],
    accepted: ['أهلاً {name} 👋', `تم قبولك في بطولة «${tm.name}» 🎉`, when && `📅 ${when}`, where, fee ? `💰 الرسوم ${fee} ج.م، ادفعها من صفحة البطولة.` : '', link],
    reminder: ['أهلاً {name} 👋', `تذكير بموعد بطولة «${tm.name}»`, when && `📅 ${when}`, where, 'برجاء الحضور قبل البداية بنصف ساعة.', link],
    fee: ['أهلاً {name} 👋', `برجاء دفع رسوم الاشتراك في بطولة «${tm.name}»${fee ? `: ${fee} ج.م` : ''}.`, 'ادفع من صفحة البطولة وارفع صورة الإيصال، أو ادفع نقداً عند الحضور.', link],
    draw: [`🎲 القرعة جاهزة في بطولة «${tm.name}»`, 'اعرف مجموعتك ومنافسيك وجدول المباريات:', link],
    results: [`🏆 انتهت بطولة «${tm.name}»`, 'شكراً لكل اللاعبين! شاهد البطل والترتيب والنتائج:', link],
  };
  return lines[tpl].filter(Boolean).join('\n');
}

const state = new Map<string, { tpl: Tpl; who: Who; text: string; contacts: Contact[] | null; loading: boolean; sent: Set<string> }>();

function stateOf(tm: Tournament) {
  let s = state.get(tm.id);
  if (!s) {
    const tpl: Tpl = tm.stage === 'setup' ? 'open' : tm.stage === 'groups' ? 'draw' : 'results';
    s = { tpl, who: 'all', text: text(tpl, tm), contacts: null, loading: false, sent: new Set() };
    state.set(tm.id, s);
  }
  return s;
}

function load(tm: Tournament): void {
  const s = stateOf(tm);
  if (s.contacts || s.loading) return;
  s.loading = true;
  tournamentContacts(tm.id).then((c) => { s.contacts = c; }).catch(() => { s.contacts = []; })
    .finally(() => { s.loading = false; render(); });
}

const personal = (msg: string, name: string) => msg.replace(/\{name\}/g, name.split(/\s+/)[0] || name);
const groupText = (msg: string) => msg.replace(/^أهلاً \{name\} 👋\n?/, 'أهلاً يا أبطال 👋\n').replace(/\{name\}/g, 'يا أبطال');
const waLink = (num: string | null, msg: string) => `https://wa.me/${num ?? ''}?text=${encodeURIComponent(msg)}`;

/** Card on the organizer's tournament control room. */
export function card(tm: Tournament): string {
  const s = stateOf(tm);
  load(tm);
  const all = s.contacts ?? [];
  const pick = all.filter((c) => s.who === 'all' || (s.who === 'unpaid' ? c.status === 'approved' && !c.paid : c.status === s.who));
  const tpls = TPLS.filter(([k]) => k !== 'fee' || feeOf(tm) > 0);
  const whoChips: [Who, string][] = [['all', 'الكل'], ['approved', 'المقبولون'], ['pending', 'في الانتظار'], ...(feeOf(tm) > 0 ? [['unpaid', 'لم يدفعوا'] as [Who, string]] : [])];
  return `<section class="card wa-card">
    <div class="row between"><h2>${icon('whatsapp', 22)} رسائل واتساب جاهزة</h2><span class="badge green">مجانية</span></div>
    <p class="hint">اختر رسالة وعدّلها إن أردت، ثم أرسلها لمجموعة البطولة أو لكل لاعب بلمسة. يفتح واتساب والرسالة مكتوبة، وأنت تضغط إرسال.</p>
    <div class="wa-tpls" role="tablist">${tpls.map(([k, ic, label]) => `<button type="button" role="tab" class="wa-chip ${s.tpl === k ? 'on' : ''}" aria-selected="${s.tpl === k}" data-act="dk-wa-tpl" data-v="${k}" data-tid="${tm.id}">${icon(ic, 14)} ${label}</button>`).join('')}</div>
    <div class="wa-compose">
      <div class="wa-bubble"><textarea class="input" id="waText-${tm.id}" data-wa="${tm.id}" dir="auto" rows="6" aria-label="نص الرسالة">${esc(s.text)}</textarea>
        <small class="muted">{name} يُستبدل باسم اللاعب الأول تلقائياً.</small></div>
      <div class="wa-side">
        <a class="btn wa block" target="_blank" rel="noopener" href="${esc(waLink(null, groupText(s.text)))}">${icon('users', 18)} أرسل لمجموعة أو جهة اتصال</a>
        <button type="button" class="btn soft small block" data-act="dk-wa-copy" data-tid="${tm.id}">${icon('copy', 16)} نسخ النص</button>
        <button type="button" class="btn ghost small block" data-act="dk-wa-reset" data-tid="${tm.id}">${icon('back', 16)} النص الأصلي</button>
      </div>
    </div>
    <div class="row between wa-listhead"><b>${icon('user', 18)} لكل لاعب</b>
      <span class="wa-who">${whoChips.map(([k, label]) => `<button type="button" class="wa-chip small ${s.who === k ? 'on' : ''}" data-act="dk-wa-who" data-v="${k}" data-tid="${tm.id}">${label}</button>`).join('')}</span></div>
    ${s.contacts === null ? `<p class="muted"><span class="spin"></span></p>`
      : !pick.length ? `<p class="muted small">لا يوجد لاعبون مسجلون بحساب في هذه القائمة بعد.</p>`
      : `<ul class="wa-people">${pick.map((c) => {
        const num = waNumber(c.phone);
        const done = s.sent.has(c.player_id);
        return `<li class="${done ? 'done' : ''}"><span class="wa-name"><b dir="auto">${esc(c.full_name)}</b>
            <small class="muted" dir="ltr">${esc(c.phone ?? 'بدون رقم')}</small></span>
          ${c.status === 'pending' ? '<span class="badge gold">في الانتظار</span>' : feeOf(tm) > 0 ? (c.paid ? '<span class="badge green">دفع</span>' : '<span class="badge red">لم يدفع</span>') : ''}
          ${num ? `<a class="btn wa small" target="_blank" rel="noopener" data-act="dk-wa-sent" data-id="${c.player_id}" data-tid="${tm.id}" href="${esc(waLink(num, personal(s.text, c.full_name)))}">${done ? icon('check', 16) : icon('whatsapp', 16)} ${done ? 'أُرسلت' : 'أرسل'}</a>`
            : '<span class="muted small">لا يوجد رقم</span>'}</li>`;
      }).join('')}</ul>`}
  </section>`;
}

export async function onClick(act: string, el: HTMLElement, tm: Tournament | undefined): Promise<boolean> {
  if (!tm) return false;
  const s = stateOf(tm);
  if (act === 'dk-wa-tpl') { s.tpl = el.dataset.v as Tpl; s.text = text(s.tpl, tm); s.sent.clear(); render(); return true; }
  if (act === 'dk-wa-who') { s.who = el.dataset.v as Who; render(); return true; }
  if (act === 'dk-wa-reset') { s.text = text(s.tpl, tm); render(); return true; }
  if (act === 'dk-wa-copy') {
    try { await navigator.clipboard.writeText(groupText(s.text)); toast('تم نسخ النص'); } catch { toast('تعذّر النسخ'); }
    return true;
  }
  if (act === 'dk-wa-sent') { s.sent.add(el.dataset.id!); setTimeout(render, 300); return true; }
  return false;
}

/* The text box keeps what the organizer types (no redraw while typing). */
document.addEventListener('input', (e) => {
  const el = e.target as HTMLTextAreaElement;
  const id = el?.dataset?.wa;
  if (!id) return;
  const s = state.get(id);
  if (!s) return;
  s.text = el.value;
  const card = el.closest('.wa-card');
  const group = card?.querySelector<HTMLAnchorElement>('.wa-side a.btn.wa');
  if (group) group.href = waLink(null, groupText(s.text));
  card?.querySelectorAll<HTMLAnchorElement>('.wa-people a[data-id]').forEach((a) => {
    const c = s.contacts?.find((x) => x.player_id === a.dataset.id);
    const num = waNumber(c?.phone);
    if (c && num) a.href = waLink(num, personal(s.text, c.full_name));
  });
});
