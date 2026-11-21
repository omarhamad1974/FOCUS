/**
 * Small Excel (.xlsx) reader: the first sheet as a table of text cells. An .xlsx file is a zip
 * of XML files; the browser's DecompressionStream unpacks it, so no library is needed.
 */

const dec = new TextDecoder();

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Files inside a zip, by name (only the ones `want` accepts are unpacked). */
export async function unzip(buf: ArrayBuffer, want: (name: string) => boolean): Promise<Map<string, string>> {
  const b = new Uint8Array(buf);
  const v = new DataView(buf);
  // End of central directory: search backwards for its signature.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  for (let k = 0; k < count; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = b.subarray(start, start + size);
    out.set(name, dec.decode(method === 0 ? raw : await inflate(raw)));
  }
  return out;
}

const unescapeXml = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

/** All <t> texts inside a piece of XML, joined (rich text runs). */
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');

/** "AB12" → 27 (0-based column). */
function colIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/** A number cell as plain digits: Excel stores 201006552256 as 2.01006552256E+11. */
function numberText(v: string): string {
  if (/e/i.test(v)) { const n = Number(v); if (Number.isFinite(n)) return n.toFixed(0); }
  return v.replace(/\.0+$/, '');
}

/** Worksheet XML + shared strings → rows of text. */
export function sheetRows(sheetXml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rm of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    let next = 0;
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/i.exec(attrs)?.[1];
      const i = ref ? colIndex(ref) : next;
      next = i + 1;
      const type = /\bt="(\w+)"/.exec(attrs)?.[1] ?? 'n';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = '';
      if (type === 's') text = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') text = texts(body);
      else if (v !== undefined) text = type === 'n' ? numberText(v) : unescapeXml(v);
      while (row.length < i) row.push('');
      row[i] = text;
    }
    rows.push(row);
  }
  return rows;
}

/** The first sheet of an .xlsx file as rows of text. */
export async function readXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  // The first sheet in the workbook's order (not always sheet1.xml).
  let path = '';
  const firstId = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(files.get('xl/workbook.xml') ?? '')?.[1];
  if (firstId) {
    const rel = [...(files.get('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b([^>]*)\/?>/g)]
      .map((m) => m[1]).find((a) => new RegExp(`\\bId="${firstId}"`).test(a));
    const target = rel && /\bTarget="([^"]+)"/.exec(rel)?.[1];
    if (target) path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheet = files.get(path) ?? files.get('xl/worksheets/sheet1.xml') ?? [...files.entries()].find(([n]) => n.startsWith('xl/worksheets/'))?.[1];
  if (!sheet) throw new Error('no sheet');
  return sheetRows(sheet, shared);
}
