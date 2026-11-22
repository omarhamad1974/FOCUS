/**
 * Admin-managed categories for the news, the Pingo Academy and the shop (migration 0021).
 * Posts and products store the category key (`slug`). Until the list is loaded, or when the
 * database has no categories table yet, the built-in categories below are used.
 */
import { db } from './remote';

export type CatSection = 'news' | 'academy' | 'shop';
export const SECTIONS: CatSection[] = ['news', 'academy', 'shop'];

export interface Category {
  id: string;
  section: CatSection;
  slug: string;
  name: string;
  icon: string;
  blurb: string | null;
  sort: number;
}

/** Icons the admin can pick for a category. */
export const ICONS = ['news', 'calendar', 'racket', 'ball', 'table', 'trophy', 'star', 'spark', 'bolt', 'gavel', 'target', 'bulb',
  'book', 'grad', 'coach', 'user', 'users', 'shop', 'tag', 'box', 'gift', 'image', 'map', 'clock', 'shield', 'grid', 'help', 'bell'];

const builtIn = (section: CatSection, rows: [string, string, string, string?][]): Category[] =>
  rows.map(([slug, name, icon, blurb], i) => ({ id: `builtin-${section}-${slug}`, section, slug, name, icon, blurb: blurb ?? null, sort: i }));

/** The categories that were fixed in the code before; migration 0021 copies the same list. */
export const DEFAULTS: Category[] = [
  ...builtIn('news', [['news', 'أخبار', 'news'], ['events', 'فعاليات', 'calendar'], ['gear', 'أدوات', 'racket'], ['other', 'متنوع', 'spark']]),
  ...builtIn('academy', [
    ['rules', 'القوانين', 'gavel', 'الإرسال، والعدّ، والزوجي'], ['training', 'التدريب', 'target', 'تمارين وضربات خطوة بخطوة'],
    ['tips', 'نصائح وحيل', 'bulb', 'أسرار صغيرة تكسب بها النقاط'], ['learn', 'أساسيات', 'book', 'المضرب، والأدوات، والبداية'],
  ]),
  ...builtIn('shop', [
    ['rackets', 'مضارب', 'racket'], ['rubbers', 'كاوتش', 'grid'], ['balls', 'كرات', 'ball'], ['tables', 'طاولات', 'table'],
    ['clothing', 'ملابس', 'user'], ['shoes', 'أحذية', 'bolt'], ['bags', 'حقائب', 'shop'], ['accessories', 'إكسسوارات', 'tag'], ['other', 'أخرى', 'box'],
  ]),
];

let rows: Category[] | null = null;
let loading: Promise<void> | null = null;
/** True once the database list is in use (false = built-in list, e.g. before migration 0021). */
let live = false;
const listeners: (() => void)[] = [];

/** Called after the list changes (main re-renders the page). */
export const onChange = (fn: () => void) => { listeners.push(fn); };
const changed = () => listeners.forEach((fn) => fn());

export function load(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = (async () => {
    try {
      const res = await db().from('categories').select('*').order('sort').order('created_at');
      if (res.error) throw new Error(res.error.message);
      const got = (res.data ?? []) as Category[];
      live = true;
      if (got.length) {
        const key = (l: Category[]) => JSON.stringify(l.map((c) => [c.id, c.slug, c.name, c.icon, c.blurb, c.sort]));
        const differs = key(got) !== key(rows ?? []);
        rows = got;
        // Re-draw only when something shows differently (keeps text typed in open forms).
        if (differs) changed();
      }
    } catch { /* no table yet or offline: keep the built-in list */ }
  })();
  return loading;
}

export const isLive = () => live;
const all = (): Category[] => rows ?? DEFAULTS;

/** Categories of one section, in the admin's order. */
export function list(section: CatSection): Category[] {
  return all().filter((c) => c.section === section).sort((a, b) => a.sort - b.sort);
}

const postSections: CatSection[] = ['news', 'academy'];

/** A post's or product's category; `shop` for products, news/academy for posts. */
export function find(slug: string, kind: 'post' | 'shop'): Category | undefined {
  const pool = all().filter((c) => (kind === 'shop' ? c.section === 'shop' : postSections.includes(c.section)));
  return pool.find((c) => c.slug === slug) ?? DEFAULTS.find((c) => c.slug === slug && (kind === 'shop' ? c.section === 'shop' : c.section !== 'shop'));
}

export const isAcademy = (slug: string): boolean => find(slug, 'post')?.section === 'academy';
export const postLabel = (slug: string) => find(slug, 'post')?.name ?? slug;
export const postIcon = (slug: string) => find(slug, 'post')?.icon ?? 'news';
export const productLabel = (slug: string) => find(slug, 'shop')?.name ?? slug;
export const productIcon = (slug: string) => find(slug, 'shop')?.icon ?? 'box';
export const blurb = (slug: string) => find(slug, 'post')?.blurb ?? '';

/* ---------------------------------------------------------- admin changes */

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export async function save(c: { id?: string; section: CatSection; name: string; icon: string; blurb: string | null }): Promise<void> {
  if (c.id) check(await db().from('categories').update({ name: c.name, icon: c.icon, blurb: c.blurb }).eq('id', c.id));
  else {
    const sort = list(c.section).reduce((m, x) => Math.max(m, x.sort + 1), 0);
    check(await db().from('categories').insert({ section: c.section, name: c.name, icon: c.icon, blurb: c.blurb, sort }));
  }
  await load(true);
}

export async function remove(id: string, moveTo: string | null): Promise<void> {
  check(await db().rpc('delete_category', { cat: id, move_to: moveTo }));
  await load(true);
}

export async function reorder(section: CatSection, ids: string[]): Promise<void> {
  // Show the new order at once, then save it.
  if (rows) for (const r of rows) if (r.section === section && ids.includes(r.id)) r.sort = ids.indexOf(r.id);
  changed();
  check(await db().rpc('reorder_categories', { ids }));
  await load(true);
}
