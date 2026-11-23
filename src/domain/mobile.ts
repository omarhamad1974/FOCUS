/**
 * Mobile number as username (no SMS): every account made with a mobile number signs in with a
 * hidden email `<digits>@<MOBILE_DOMAIN>` that nobody receives mail on. The same rules live in
 * the admin-users Edge Function and in SQL (public.norm_mobile, migration 0014): keep them equal.
 */

export const MOBILE_DOMAIN = 'phone.pingo.example';
/** Password every account made by an organizer or the admin starts with. */
export const DEFAULT_PASSWORD = 'pingo123';

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Arabic and Persian digits → 0-9. */
export function westernDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => String(ARABIC_DIGITS.includes(d) ? ARABIC_DIGITS.indexOf(d) : PERSIAN_DIGITS.indexOf(d)));
}

/**
 * One way to write each number, so "+20 100 655 2256", "00201006552256" and "01006552256" are the
 * same login. Egyptian mobiles become 01xxxxxxxxx; other numbers keep their digits (country code
 * included, without + or 00). Returns null when it does not look like a phone number.
 */
export function normalizeMobile(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  let s = westernDigits(String(raw)).trim();
  if (!s || /[a-z@]/i.test(s)) return null;
  s = s.replace(/[^\d+]/g, '');
  s = s.replace(/^\+/, '').replace(/^00/, '');
  if (/\D/.test(s)) return null;
  // Egypt: 20 1x xxxx xxxx → 01x xxxx xxxx; a number pasted from Excel can lose its leading 0.
  if (/^201[0-9]{9}$/.test(s)) s = '0' + s.slice(2);
  else if (/^1[0-9]{9}$/.test(s)) s = '0' + s;
  if (s.length < 8 || s.length > 15) return null;
  return s;
}

export const mobileEmail = (mobile: string) => `${mobile}@${MOBILE_DOMAIN}`;

/** The mobile behind a hidden login email, or null for a real email. */
export function mobileOfEmail(email: string | null | undefined): string | null {
  const m = /^(\d{8,15})@(.+)$/.exec(String(email ?? '').toLowerCase());
  return m && m[2] === MOBILE_DOMAIN ? m[1] : null;
}

/**
 * What the login box holds → the email Supabase signs in with. An email stays an email
 * (older accounts keep working); anything else must be a mobile number.
 */
export function loginEmail(identifier: string): string | null {
  const s = identifier.trim();
  if (!s) return null;
  if (s.includes('@')) return s.toLowerCase();
  const m = normalizeMobile(s);
  return m ? mobileEmail(m) : null;
}

/* ------------------------------------------------------------ batch rows */

/**
 * A real name: at least 2 characters and at least one letter (Arabic or English), so a blank
 * field or a mobile typed in the name box is refused. Same rule as nameOk in the admin-users
 * function and public.is_real_name in SQL (migration 0023): keep the three equal.
 */
export function isRealName(raw: string | null | undefined): boolean {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return s.length >= 2 && /\p{L}/u.test(s);
}

export interface PlayerRow {
  full_name: string;
  mobile: string;
  club?: string;
  gender?: 'male' | 'female';
  birth_year?: number;
}

export interface RowProblem {
  /** 1-based line or sheet row. */
  line: number;
  text: string;
  reason: 'noName' | 'noMobile' | 'badMobile' | 'repeat';
}

export interface ParsedRows {
  rows: PlayerRow[];
  problems: RowProblem[];
}

type Col = 'name' | 'mobile' | 'club' | 'gender' | 'year';

const HEADERS: Record<Col, RegExp> = {
  name: /^(name|full ?name|player|الاسم|اسم|الإسم|اسم اللاعب|الاسم بالكامل|اللاعب)$/i,
  mobile: /^(mobile|phone|mobile number|phone number|tel|cell|whatsapp|الموبايل|موبايل|رقم الموبايل|المحمول|محمول|الهاتف|هاتف|التليفون|تليفون|رقم|الرقم|رقم الهاتف|واتساب|واتس)$/i,
  club: /^(club|team|النادي|نادي|الفريق|فريق)$/i,
  gender: /^(gender|sex|النوع|الجنس)$/i,
  year: /^(birth ?year|year|born|سنة الميلاد|الميلاد|مواليد|سنة)$/i,
};

const clean = (s: unknown) => westernDigits(String(s ?? '')).replace(/\s+/g, ' ').trim();

export function genderOf(s: string): 'male' | 'female' | undefined {
  const v = s.trim().toLowerCase();
  if (/^(m|male|man|boy|ذكر|رجل|ولد|د|ذ)$/.test(v)) return 'male';
  if (/^(f|female|woman|girl|أنثى|انثى|انثي|أنثي|سيدة|بنت|ث)$/.test(v)) return 'female';
  return undefined;
}

const looksMobile = (s: string) => !!normalizeMobile(s) && /^[\d\s+()\-.]+$/.test(s);

/**
 * A table (from a CSV, an Excel sheet or pasted lines) → player rows. With a header row the
 * columns are found by name (Arabic or English); without one, the column of phone numbers is
 * the mobile and the first other text column is the name. Repeated mobiles are kept once.
 */
export function rowsFromTable(table: string[][]): ParsedRows {
  const cells = table.map((r) => r.map(clean)).filter((r) => r.some(Boolean));
  const out: ParsedRows = { rows: [], problems: [] };
  if (!cells.length) return out;
  const cols: Partial<Record<Col, number>> = {};
  let start = 0;
  cells[0].forEach((h, i) => {
    for (const k of Object.keys(HEADERS) as Col[]) if (cols[k] === undefined && HEADERS[k].test(h)) { cols[k] = i; break; }
  });
  if (cols.name !== undefined || cols.mobile !== undefined) start = 1;
  if (cols.mobile === undefined || cols.name === undefined) {
    // Guess from the data: the column with the most phone numbers is the mobile.
    const width = Math.max(...cells.map((r) => r.length));
    const body = cells.slice(start);
    const score = (i: number, test: (s: string) => boolean) => body.filter((r) => r[i] && test(r[i])).length;
    if (cols.mobile === undefined) {
      let best = -1, bestScore = 0;
      for (let i = 0; i < width; i++) { if (Object.values(cols).includes(i)) continue; const s = score(i, looksMobile); if (s > bestScore) { best = i; bestScore = s; } }
      if (best >= 0) cols.mobile = best;
    }
    if (cols.name === undefined) {
      for (let i = 0; i < width; i++) {
        if (Object.values(cols).includes(i)) continue;
        if (score(i, (s) => /\p{L}/u.test(s)) > 0) { cols.name = i; break; }
      }
    }
  }
  const seen = new Set<string>();
  cells.slice(start).forEach((r, k) => {
    const line = start + k + 1;
    const text = r.filter(Boolean).join(' · ');
    const name = cols.name !== undefined ? (r[cols.name] ?? '').replace(/^\s*(\d+\s*[.)\-]|[-•*])\s*/, '').trim() : '';
    const rawMobile = cols.mobile !== undefined ? r[cols.mobile] ?? '' : '';
    if (!isRealName(name)) { out.problems.push({ line, text, reason: 'noName' }); return; }
    if (!rawMobile) { out.problems.push({ line, text, reason: 'noMobile' }); return; }
    const mobile = normalizeMobile(rawMobile);
    if (!mobile) { out.problems.push({ line, text, reason: 'badMobile' }); return; }
    if (seen.has(mobile)) { out.problems.push({ line, text, reason: 'repeat' }); return; }
    seen.add(mobile);
    const row: PlayerRow = { full_name: name.slice(0, 80), mobile };
    const club = cols.club !== undefined ? r[cols.club] : '';
    if (club) row.club = club.slice(0, 80);
    const g = cols.gender !== undefined ? genderOf(r[cols.gender] ?? '') : undefined;
    if (g) row.gender = g;
    const y = cols.year !== undefined ? Number((r[cols.year] ?? '').replace(/\D/g, '')) : 0;
    if (y >= 1920 && y <= 2030) row.birth_year = y;
    out.rows.push(row);
  });
  return out;
}

/** CSV text (comma, semicolon or tab; quotes allowed) → table. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', ';', '\t', '،'].reduce((a, b) => (first.split(b).length > first.split(a).length ? b : a), ',');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * Pasted lines: "name, mobile" or "name mobile" or "mobile name" per line, or a block copied
 * from Excel (tab separated). Lines without a separator are split at the phone number.
 */
export function parsePasted(text: string): ParsedRows {
  const table = text.split(/\r?\n/).map((line) => {
    const s = westernDigits(line);
    if (s.includes('\t')) return s.split('\t');
    if (/[,;،]/.test(s)) return s.split(/[,;،]/);
    const m = /(\+?[\d][\d\s\-()]{6,}\d)/.exec(s);
    if (!m) return [s];
    return [(s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).trim(), m[1]];
  });
  return rowsFromTable(table);
}

/* ------------------------------------------------------ simulation photos */

/** The demo portraits shipped with the app (public/demo/players, CC0): sp-03, 06, … and 40 are women. */
const DEMO_PHOTOS = Array.from({ length: 40 }, (_, i) => i + 1);
const isFemalePhoto = (k: number) => k % 3 === 0 || k === 40;

/** A realistic demo photo for a simulated player, matching the gender when it is known. */
export function demoPhoto(gender: 'male' | 'female' | undefined | null, seed: number): string {
  const pool = gender ? DEMO_PHOTOS.filter((k) => isFemalePhoto(k) === (gender === 'female')) : DEMO_PHOTOS;
  const k = pool[Math.abs(Math.floor(seed)) % pool.length];
  return `demo/players/sp-${String(k).padStart(2, '0')}.jpg`;
}
