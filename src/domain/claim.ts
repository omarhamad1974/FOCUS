/** Pure helpers for batch player entry and claim codes. */

/** "K7PM3QXA" → "K7PM-3QXA". */
export const fmtCode = (code: string) => code.replace(/^(.{4})(.{4})$/, '$1-$2');

/** Codes may be typed with a dash, spaces or small letters. */
export const cleanCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Names from a pasted list: one per line. List numbers and bullets ("1.", "2)", "-", "•")
 * are dropped, spaces tidied, and blank lines, names over 80 letters and repeats (any case) skipped.
 */
export function parseNames(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const name = line.replace(/^\s*(\d+\s*[.)\-]|[-•*])\s*/, '').replace(/\s+/g, ' ').trim();
    if (!name || name.length > 80 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}
