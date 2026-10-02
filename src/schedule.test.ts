import { describe, expect, it } from 'vitest';
import type { Sheet } from './workbook';
import {
  buildRoster,
  currentOccupants,
  extractAssignments,
  loadSchedule,
  matchSoldiers,
  normalizeKey,
  parseSheetDate,
  parseTime,
  scheduleFor,
  slotNeighbors,
} from './schedule';

// These tests use made-up sheets laid out like the real one; every name here is invented. Tests against a
// snapshot of the real sheet live in the git-ignored schedule.real.test.ts (see README).

/** Builds a sheet from A1-style cells, e.g. { A2: 'שעה', B2: 'שג' }. */
function sheetFrom(name: string, cells: Record<string, string>): Sheet {
  const grid: string[][] = [];
  for (const [ref, text] of Object.entries(cells)) {
    const [, letter, row] = /^([A-Z])(\d+)$/.exec(ref)!;
    const r = Number(row) - 1;
    const c = letter!.charCodeAt(0) - 65;
    grid[r] ??= [];
    grid[r]![c] = text;
  }
  return { name, grid: Array.from(grid, (row) => Array.from(row ?? [], (t) => t ?? '')) };
}

// Thursday 10.09.2026, shaped like the real sheet: row-timed grid, column-timed blocks with times below
// (סיור, יזומה) and beside (חמל, כרמל חטיבה) the title, whole-day blocks, and the attendance lists.
const DAY_1 = sheetFrom('10.09', {
  A2: 'שעה', B2: 'שג', C2: 'בונקר', F2: 'קצין מוצב', H2: 'סיור', K2: 'חפק', M2: 'מטבח',
  A3: '14:00', B3: 'דני לוי', C3: 'רון כץ', F3: 'יוסי', H3: '14:00', I3: '22:00', J3: '06:00:00 יום שישי', K3: 'נעם גל', M3: 'אבי רז',
  A4: '18:00', B4: 'משה פרץ', C4: 'לוי דני', H4: 'רון כץ', I4: 'גיל שחר', J4: 'משה פרץ', K4: 'תום אור',
  A5: '22:00', B5: 'רון כץ', H5: 'עומר בר',
  A6: ' 02:00:00 יום שישי', B6: 'גיל שחר', M6: 'חמל', N6: '14:00', O6: '22:00', P6: '06:00',
  A7: '06:00', B7: 'עומר בר', N7: 'שחר', P7: 'דני',
  A8: '10:00', B8: 'משה פרץ', F8: 'יזומה',
  F9: '14:00', G9: '22:00', H9: '06:00:00 יום שישי',
  A10: 'נוכחים', B10: 'סה"כ: 9', F10: 'עומר בר', H10: 'רון כץ',
  A11: 'מחלקה 1', B11: 'מחלקה 2', C11: 'מחלקה 3', D11: 'מפלג, חמל, מסופחים',
  A12: 'דני לוי', B12: 'רון כץ', C12: 'גיל שחר', D12: 'נעם גל',
  A13: 'משה פרץ', B13: 'עומר בר', C13: 'תום אור', D13: 'אבי רז',
  A14: 'אריאל נחום', B14: 'אריאל בן נחום', C14: 'שי גולדשטיין', D14: 'ליאור אדרי',
  D15: 'משה כהן', F15: 'כרמל חטיבה', G15: '14:00', H15: '18:00', I15: '22:00', J15: '02:00:00 יום שישי',
  F16: 'מפקד', G16: 'משה פרץ', H16: 'תום אור', I16: 'משה פרץ', J16: 'גיל שחר',
  G17: 'דני לוי', I17: 'עומר בר',
  A18: 'יוצאים', B18: 'סה"כ: 1',
  A19: 'מחלקה 1', B19: 'מחלקה 2', C19: 'מחלקה 3', D19: 'מפלג, חמל, מסופחים',
  A20: 'כהן משה',
  F21: 'מגן שומרון', G21: '7+1',
  F22: 'תום אור', G22: 'עד 18: גולדשטיין',
  F23: 'אדרי ליאור',
});

// Friday 11.09: starts at 10:00 (taking over the end of 10.09), and a חמל block in 6h steps that
// continues on a second row of times.
const DAY_2 = sheetFrom('11.09', {
  A2: 'שעה', B2: 'שג', K2: 'חפק',
  A3: '10:00', B3: 'רון כץ', K3: 'נעם גל',
  A4: '14:00', B4: 'דני לוי',
  J8: 'חמל',
  J9: '12:00', K9: '18:00', L9: '00:00', M9: '06:00',
  J10: 'עומר בר', K10: 'תום אור', L10: 'גיל שחר', M10: 'רון כץ',
  J11: '12:00:00 יום שבת', K11: '18:00:00 יום שבת',
  J12: 'דני לוי', K12: 'משה פרץ',
});

const TODAY = new Date(2026, 9, 2, 12, 0);
const at = (day: number, month: number, h: number, m = 0) => new Date(2026, month - 1, day, h, m);
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const key = normalizeKey;

describe('parseSheetDate', () => {
  it('accepts names that are only a date', () => {
    expect(parseSheetDate('10.09', TODAY)).toEqual(at(10, 9, 0));
    expect(parseSheetDate('2.10', TODAY)).toEqual(at(2, 10, 0));
    expect(parseSheetDate(' 01.10 ', TODAY)).toEqual(at(1, 10, 0));
  });

  it('rejects other sheet names', () => {
    expect(parseSheetDate('יזומה 25.09', TODAY)).toBeNull();
    expect(parseSheetDate('מסגרת', TODAY)).toBeNull();
    expect(parseSheetDate('32.01', TODAY)).toBeNull();
  });

  it('finds a leap day in the nearest year that has one', () => {
    expect(parseSheetDate('29.02', new Date(2027, 5, 1))).toEqual(new Date(2028, 1, 29));
  });

  it('picks the year closest to today', () => {
    expect(parseSheetDate('02.01', new Date(2026, 11, 30))).toEqual(new Date(2027, 0, 2));
    expect(parseSheetDate('30.12', new Date(2027, 0, 2))).toEqual(new Date(2026, 11, 30));
  });
});

describe('parseTime', () => {
  it('parses plain times', () => {
    expect(parseTime('14:00')).toEqual({ minutes: 14 * 60 });
    expect(parseTime('6:30')).toEqual({ minutes: 6 * 60 + 30 });
  });

  it('parses times with a weekday label', () => {
    expect(parseTime(' 02:00:00 יום שישי')).toEqual({ minutes: 120, weekday: 5 });
    expect(parseTime('06:00 יום שבת')).toEqual({ minutes: 360, weekday: 6 });
    expect(parseTime('06:00:00 יום ראשון')).toEqual({ minutes: 360, weekday: 0 });
  });

  it('rejects non-times', () => {
    expect(parseTime('7+1')).toBeNull();
    expect(parseTime('0.5')).toBeNull();
    expect(parseTime('דני לוי')).toBeNull();
    expect(parseTime('יורד ב 14 עולה ב 18:')).toBeNull();
  });
});

describe('normalizeKey', () => {
  it('ignores word order, spacing and geresh style', () => {
    expect(normalizeKey('לוי  דני')).toBe(normalizeKey('דני לוי'));
    expect(normalizeKey('רז ג׳ורג׳')).toBe(normalizeKey("רז ג'ורג'"));
  });
});

describe('extractAssignments', () => {
  const all = extractAssignments(DAY_1, at(10, 9, 0));
  const spans = (mission: string, text: string) =>
    all.filter((a) => a.mission === mission && a.text === text).map((a) => [a.start, a.end]);

  it('reads the row-timed grid in 4h slots, rolling over to the next day', () => {
    expect(spans('שג', 'משה פרץ')).toEqual([
      [at(10, 9, 18), at(10, 9, 22)],
      [at(11, 9, 10), at(11, 9, 14)],
    ]);
    expect(spans('שג', 'גיל שחר')).toEqual([[at(11, 9, 2), at(11, 9, 6)]]);
    // Unlabeled 06:00 after the labeled 02:00 row stays on Friday.
    expect(spans('שג', 'עומר בר')).toEqual([[at(11, 9, 6), at(11, 9, 10)]]);
    expect(spans('בונקר', 'לוי דני')).toEqual([[at(10, 9, 18), at(10, 9, 22)]]);
  });

  it('reads blocks with times below the title (סיור, יזומה) as 8h', () => {
    expect(spans('סיור', 'משה פרץ')).toEqual([[at(11, 9, 6), at(11, 9, 14)]]);
    expect(spans('סיור', 'עומר בר')).toEqual([[at(10, 9, 14), at(10, 9, 22)]]);
    expect(spans('יזומה', 'עומר בר')).toEqual([[at(10, 9, 14), at(10, 9, 22)]]);
    expect(spans('יזומה', 'רון כץ')).toEqual([[at(11, 9, 6), at(11, 9, 14)]]);
  });

  it('reads blocks with times beside the title (כרמל חטיבה 4h, חמל 8h)', () => {
    expect(spans('כרמל חטיבה', 'משה פרץ')).toEqual([
      [at(10, 9, 14), at(10, 9, 18)],
      [at(10, 9, 22), at(11, 9, 2)],
    ]);
    expect(spans('חמל', 'שחר')).toEqual([[at(10, 9, 14), at(10, 9, 22)]]);
    // Unlabeled 06:00 after 22:00 rolls over to Friday.
    expect(spans('חמל', 'דני')).toEqual([[at(11, 9, 6), at(11, 9, 14)]]);
  });

  it('reads untimed missions as whole-day from the day start for 24h', () => {
    const wholeDay = all.filter((a) => a.allDay).map((a) => `${a.mission}: ${a.text}`);
    expect(wholeDay).toEqual([
      'חפק: נעם גל',
      'חפק: תום אור',
      'מטבח: אבי רז',
      'מגן שומרון: תום אור',
      'מגן שומרון: עד 18: גולדשטיין',
      'מגן שומרון: אדרי ליאור',
    ]);
    for (const a of all.filter((x) => x.allDay)) expect([a.start, a.end]).toEqual([at(10, 9, 14), at(11, 9, 14)]);
  });

  it('does not take labels, counts, other sections or other posts as names', () => {
    const texts = new Set(all.map((a) => a.text));
    for (const junk of ['חמל', 'מגן שומרון', '7+1', 'מפקד', 'כרמל חטיבה', 'יזומה', '14:00', 'נוכחים', 'מחלקה 1', 'יוסי']) {
      expect(texts.has(junk), junk).toBe(false);
    }
    expect(all.some((a) => a.sheet !== '10.09')).toBe(false);
  });

  it('ends a slot early when the next time comes sooner, and reads a second row of times', () => {
    const hamal = extractAssignments(DAY_2, at(11, 9, 0)).filter((a) => a.mission === 'חמל');
    expect(hamal.map((a) => `${a.text} ${a.start.getDate()} ${hhmm(a.start)}-${hhmm(a.end)}`)).toEqual([
      'עומר בר 11 12:00-18:00',
      'תום אור 11 18:00-00:00',
      'גיל שחר 12 00:00-06:00',
      'רון כץ 12 06:00-12:00',
      'דני לוי 12 12:00-18:00',
      'משה פרץ 12 18:00-02:00',
    ]);
  });
});

describe('buildRoster', () => {
  const roster = buildRoster([DAY_1]);

  it('collects the attendance lists, merging reversed names and skipping headers', () => {
    expect(roster.map((s) => s.key).sort()).toEqual(
      [
        'דני לוי', 'רון כץ', 'גיל שחר', 'נעם גל', 'משה פרץ', 'עומר בר', 'תום אור', 'אבי רז',
        'אריאל נחום', 'אריאל בן נחום', 'שי גולדשטיין', 'ליאור אדרי', 'משה כהן',
      ].map(key).sort(),
    );
  });

  it('ignores sheets not named by a date', () => {
    expect(buildRoster([{ ...DAY_1, name: 'מסגרת' }])).toEqual([]);
  });
});

describe('matchSoldiers', () => {
  const roster = buildRoster([DAY_1]);
  const keys = (text: string) => matchSoldiers(text, roster).map((m) => m.key);

  it('matches full names in any order', () => {
    expect(matchSoldiers('לוי דני', roster)).toEqual([{ key: key('דני לוי'), partial: false }]);
  });

  it('matches a unique single word, but not an ambiguous one', () => {
    expect(matchSoldiers('שחר', roster)).toEqual([{ key: key('גיל שחר'), partial: true }]);
    expect(matchSoldiers('משה', roster)).toEqual([]);
  });

  it('tolerates a missing/extra ו, י or א', () => {
    expect(matchSoldiers('גולדשטין', roster)).toEqual([{ key: key('שי גולדשטיין'), partial: true }]);
    expect(matchSoldiers('לאור אדרי', roster)).toEqual([{ key: key('ליאור אדרי'), partial: true }]);
  });

  it('ignores times and filler words in notes', () => {
    expect(keys('עד 18: פרץ, מ 18: כץ')).toEqual([key('משה פרץ'), key('רון כץ')]);
    expect(keys('פרץ(יורד) כץ(עולה)')).toEqual([key('משה פרץ'), key('רון כץ')]);
    expect(keys('עומר בר->תום אור')).toEqual([key('עומר בר'), key('תום אור')]);
  });

  it('matches each person in a cell on their own', () => {
    expect(keys('משה לוי, דני כהן')).toEqual([]);
    expect(matchSoldiers('רון כץ, לאור אדרי', roster)).toEqual([
      { key: key('רון כץ'), partial: false },
      { key: key('ליאור אדרי'), partial: true },
    ]);
  });

  it("prefers the longer name when one soldier's name is contained in another's", () => {
    expect(keys('אריאל בן נחום')).toEqual([key('אריאל בן נחום')]);
    expect(keys('נחום אריאל')).toEqual([key('אריאל נחום')]);
  });
});

describe('scheduleFor', () => {
  const day1 = loadSchedule([DAY_1], TODAY);
  const list = (name: string, now: Date, data = day1) =>
    scheduleFor(key(name), data, now).map((e) => `${hhmm(e.start)}-${hhmm(e.end)} ${e.mission}${e.overlap ? ' !' : ''}`);

  it("gives a soldier's missions sorted by time, flagging overlaps", () => {
    expect(list('משה פרץ', at(10, 9, 0))).toEqual([
      '14:00-18:00 כרמל חטיבה',
      '18:00-22:00 שג',
      '22:00-02:00 כרמל חטיבה',
      '06:00-14:00 סיור !',
      '10:00-14:00 שג !',
    ]);
  });

  it('only returns missions that have not ended yet', () => {
    expect(list('משה פרץ', at(10, 9, 19))).toEqual([
      '18:00-22:00 שג',
      '22:00-02:00 כרמל חטיבה',
      '06:00-14:00 סיור !',
      '10:00-14:00 שג !',
    ]);
  });

  it('does not flag whole-day duties as overlapping', () => {
    expect(list('תום אור', at(10, 9, 0))).toEqual(['14:00-14:00 חפק', '14:00-14:00 מגן שומרון', '18:00-22:00 כרמל חטיבה']);
  });

  it("shows the cell text when it's more than the soldier's name", () => {
    const [note] = scheduleFor(key('שי גולדשטיין'), day1, at(10, 9, 0));
    expect([note!.mission, note!.text, note!.showText]).toEqual(['מגן שומרון', 'עד 18: גולדשטיין', true]);
    expect(scheduleFor(key('משה פרץ'), day1, at(10, 9, 0)).every((e) => !e.showText)).toBe(true);
  });

  it("lets the next date's sheet take over from its start", () => {
    const both = loadSchedule([DAY_1, DAY_2], TODAY);
    // 11.09 starts at 10:00 and reassigns the Friday 10:00 שג slot.
    expect(list('משה פרץ', at(10, 9, 0), both)).not.toContain('10:00-14:00 שג !');
    // (It also clashes with his יזומה 06:00–14:00.)
    expect(list('רון כץ', at(11, 9, 9), both)).toContain('10:00-14:00 שג !');
    // Whole-day duties end when the next sheet starts.
    const hapak = both.assignments.filter((a) => a.mission === 'חפק' && a.text === 'נעם גל');
    expect(hapak.map((a) => [a.start, a.end])).toEqual([
      [at(10, 9, 14), at(11, 9, 10)],
      [at(11, 9, 10), at(12, 9, 10)],
    ]);
  });

  it('dedupes the same slot matched twice', () => {
    const twice = sheetFrom('05.10', { A2: 'שעה', B2: 'שג', A3: '14:00', B3: 'משה פרץ (משה פרץ)' });
    expect(scheduleFor(key('משה פרץ'), loadSchedule([DAY_1, twice], TODAY), at(5, 10, 0))).toHaveLength(1);
  });
});

describe('slotNeighbors', () => {
  const data = loadSchedule([DAY_1], TODAY);
  const entries = scheduleFor(key('משה פרץ'), data, at(10, 9, 0));
  const entry = (mission: string, h: number) => entries.find((e) => e.mission === mission && e.start.getHours() === h)!;

  it('gives who is before and after in a one-person post', () => {
    expect(slotNeighbors(entry('שג', 18), data)).toEqual({
      prev: { start: at(10, 9, 14), end: at(10, 9, 18), names: ['דני לוי'] },
      with: [],
      next: { start: at(10, 9, 22), end: at(11, 9, 2), names: ['רון כץ'] },
    });
  });

  it('lists the crews of the neighbouring slots and who shares the slot', () => {
    expect(slotNeighbors(entry('כרמל חטיבה', 22), data)).toEqual({
      prev: { start: at(10, 9, 18), end: at(10, 9, 22), names: ['תום אור'] },
      with: ['עומר בר'],
      next: { start: at(11, 9, 2), end: at(11, 9, 6), names: ['גיל שחר'] },
    });
  });

  it('returns null when there is no earlier slot', () => {
    const n = slotNeighbors(entry('כרמל חטיבה', 14), data);
    expect([n.prev, n.with]).toEqual([null, ['דני לוי']]);
  });
});

describe('currentOccupants', () => {
  const data = loadSchedule([DAY_1], TODAY);

  it('lists who is on each mission now, timed missions first, in mission order', () => {
    const occ = currentOccupants(data, at(10, 9, 19));
    expect(occ.filter((o) => !o.allDay).map((o) => `${o.mission} ${hhmm(o.start)}: ${o.names.join(', ')}`)).toEqual([
      'שג 18:00: משה פרץ',
      'בונקר 18:00: לוי דני',
      'יזומה 14:00: עומר בר',
      'כרמל חטיבה 18:00: תום אור',
      'חמל 14:00: שחר',
      'סיור 14:00: רון כץ, עומר בר',
    ]);
    expect(occ.filter((o) => o.allDay).map((o) => o.mission)).toEqual(['חפק', 'מטבח', 'מגן שומרון']);
  });

  it('is empty when nothing is running', () => {
    expect(currentOccupants(data, at(1, 9, 0))).toEqual([]);
  });
});
