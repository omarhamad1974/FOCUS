import { describe, expect, it } from 'vitest';
import { cleanCode, fmtCode, parseNames } from './claim';

describe('batch names', () => {
  it('takes one name per line, tidy and without repeats', () => {
    expect(parseNames('  أحمد   علي \n\nسارة\r\nأحمد علي\nYoussef\nyoussef\n')).toEqual(['أحمد علي', 'سارة', 'Youssef']);
  });
  it('drops list numbers and bullets copied from WhatsApp or Excel', () => {
    expect(parseNames('1. منى\n2) كريم\n- ليلى\n• عمر\n10 - هادي')).toEqual(['منى', 'كريم', 'ليلى', 'عمر', 'هادي']);
  });
  it('skips names that are too long', () => {
    expect(parseNames('x'.repeat(81))).toEqual([]);
  });
});

describe('claim codes', () => {
  it('formats and cleans', () => {
    expect(fmtCode('K7PM3QXA')).toBe('K7PM-3QXA');
    expect(cleanCode(' k7pm-3qxa ')).toBe('K7PM3QXA');
  });
});
