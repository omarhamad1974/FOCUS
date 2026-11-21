import { describe, expect, it } from 'vitest';
import { demoPhoto, loginEmail, mobileOfEmail, normalizeMobile, parseCsv, parsePasted, rowsFromTable } from './mobile';
import { sheetRows, unzip, readXlsx } from './xlsx';
import { deflateRawSync } from 'node:zlib';

describe('normalizeMobile', () => {
  it('writes every form of an Egyptian mobile the same way', () => {
    for (const s of ['01006552256', '+20 100 655 2256', '00201006552256', '201006552256', '1006552256', '٠١٠٠٦٥٥٢٢٥٦', '010-0655-2256'])
      expect(normalizeMobile(s)).toBe('01006552256');
  });
  it('keeps other countries as digits and rejects non-numbers', () => {
    expect(normalizeMobile('+971 50 123 4567')).toBe('971501234567');
    expect(normalizeMobile('ahmed@x.com')).toBeNull();
    expect(normalizeMobile('1234')).toBeNull();
    expect(normalizeMobile('')).toBeNull();
  });
});

describe('login', () => {
  it('turns a mobile into the hidden login email and keeps real emails', () => {
    expect(loginEmail(' 0100 655 2256 ')).toBe('01006552256@phone.pingo.example');
    expect(loginEmail('Player@Player.com')).toBe('player@player.com');
    expect(loginEmail('abc')).toBeNull();
    expect(mobileOfEmail('01006552256@phone.pingo.example')).toBe('01006552256');
    expect(mobileOfEmail('player@player.com')).toBeNull();
  });
});

describe('rows from files and pasted text', () => {
  it('finds columns by Arabic headers in any order', () => {
    const r = rowsFromTable([['الموبايل', 'الاسم', 'النادي', 'النوع', 'سنة الميلاد'], ['01001234567', 'أحمد علي', 'الأهلي', 'ذكر', '2001'], ['1112345678', 'سارة', '', 'أنثى', '']]);
    expect(r.rows).toEqual([
      { full_name: 'أحمد علي', mobile: '01001234567', club: 'الأهلي', gender: 'male', birth_year: 2001 },
      { full_name: 'سارة', mobile: '01112345678', gender: 'female' },
    ]);
  });
  it('guesses name and mobile without a header and reports bad lines', () => {
    const r = rowsFromTable([['أحمد', '01001234567'], ['منى', ''], ['', '01001234568'], ['كريم', '123'], ['أحمد 2', '+20 100 123 4567']]);
    expect(r.rows.map((x) => x.full_name)).toEqual(['أحمد']);
    expect(r.problems.map((p) => p.reason)).toEqual(['noMobile', 'noName', 'badMobile', 'repeat']);
  });
  it('reads CSV with quotes and semicolons, and a BOM', () => {
    expect(parseCsv('﻿name;mobile\n"Ali; Jr";01001234567\n')).toEqual([['name', 'mobile'], ['Ali; Jr', '01001234567']]);
  });
  it('reads pasted lines with or without commas', () => {
    expect(parsePasted('أحمد علي, 01001234567\nسارة محمود، 01112345678').rows.map((r) => r.mobile)).toEqual(['01001234567', '01112345678']);
    const plain = parsePasted('1. يوسف حسن 0122 345 6789\n01001112223 منى');
    expect(plain.rows).toEqual([{ full_name: 'يوسف حسن', mobile: '01223456789' }, { full_name: 'منى', mobile: '01001112223' }]);
  });
});

describe('demo photos', () => {
  it('matches the gender', () => {
    expect(demoPhoto('female', 0)).toBe('demo/players/sp-03.jpg');
    expect(demoPhoto('male', 0)).toBe('demo/players/sp-01.jpg');
    expect(demoPhoto(null, 39)).toBe('demo/players/sp-40.jpg');
  });
});

/** A minimal zip (deflate) like the ones Excel writes. */
function zip(files: Record<string, string>): ArrayBuffer {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameB = enc.encode(name);
    const data = new Uint8Array(deflateRawSync(enc.encode(text)));
    const local = new Uint8Array(30 + nameB.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 8, true); lv.setUint32(18, data.length, true); lv.setUint16(26, nameB.length, true);
    local.set(nameB, 30);
    const c = new Uint8Array(46 + nameB.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 8, true); cv.setUint32(20, data.length, true); cv.setUint16(28, nameB.length, true); cv.setUint32(42, offset, true);
    c.set(nameB, 46);
    parts.push(local, data); central.push(c);
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(10, central.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out.buffer;
}

describe('xlsx', () => {
  it('reads shared strings, inline strings and big numbers', () => {
    const rows = sheetRows('<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>x &amp; y</t></is></c></row><row r="2"><c r="B2"><v>2.01006552256E+11</v></c></row></sheetData>', ['الاسم']);
    expect(rows).toEqual([['الاسم', '', 'x & y'], ['', '201006552256']]);
  });
  it('reads the first sheet of a workbook', async () => {
    const buf = zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Players" sheetId="1" r:id="rId3"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId3" Type="ws" Target="worksheets/sheet2.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>الاسم</t></si><si><t>الموبايل</t></si><si><r><t>أحمد </t></r><r><t>علي</t></r></si></sst>',
      'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1001234567</v></c></row></sheetData></worksheet>',
    });
    expect((await unzip(buf, () => true)).size).toBe(4);
    const table = await readXlsx(buf);
    expect(rowsFromTable(table).rows).toEqual([{ full_name: 'أحمد علي', mobile: '01001234567' }]);
  });
});
