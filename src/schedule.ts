import type { Sheet } from './workbook';

/** Missions whose names appear as column headers next to the `שעה` column, one name per time row. */
const ROW_TIMED = new Set(['שג', 'בונקר', 'מזרחית', 'דרומית']);
/** All missions, in display order. */
const MISSION_ORDER = [...ROW_TIMED, 'יזומה', 'כרמל חטיבה', 'חמל', 'סיור', 'חפק', 'מטבח', 'מגן שומרון'];
const MISSIONS = new Set(MISSION_ORDER);
const EIGHT_HOURS = new Set(['סיור', 'יזומה', 'חמל']);
const SECTIONS = new Set(['נוכחים', 'יוצאים', 'חוזרים']);
const WEEKDAYS: Record<string, number> = { ראשון: 0, שני: 1, שלישי: 2, רביעי: 3, חמישי: 4, שישי: 5, שבת: 6 };
const DEFAULT_DAY_START = 14 * 60;
const DAY = 24 * 60;

export interface Assignment {
  mission: string;
  start: Date;
  end: Date;
  allDay: boolean;
  /** The cell text the name was read from. */
  text: string;
  sheet: string;
}

export interface Soldier {
  key: string;
  name: string;
  tokens: string[];
}

export interface Match {
  key: string;
  /** Matched by a single word (nickname / surname) rather than the full name. */
  partial: boolean;
}

export interface ScheduleData {
  roster: Soldier[];
  assignments: (Assignment & { people: Match[] })[];
}

export interface Entry extends Assignment {
  partial: boolean;
  /** The cell says more than the soldier's name (a note, another person, a nickname) — show it. */
  showText: boolean;
  overlap: boolean;
}

const normalizeText = (s: string) => s.replace(/[׳’`´]/g, "'").replace(/\s+/g, ' ').trim();
const tokens = (s: string) => normalizeText(s).split(/[\s(),+/\\:.;<>-]+/).filter(Boolean);
/** Words in notes that are never (part of) a name. */
const FILLER = new Set(['עד', 'מ', 'משעה', 'ב', 'ו', 'אחרי', 'לפני', 'עולה', 'יורד', 'עולים', 'יורדים']);

/** Same word up to one added/dropped ו, י or א (e.g. "דוד" / "דויד"). */
function similarWord(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) !== 1) return false;
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && long[i] === short[i]) i++;
  return 'ויא'.includes(long[i]!) && long.slice(i + 1) === short.slice(i);
}

/** Identity of a name regardless of word order ("כהן ישראל" = "ישראל כהן"). */
export const normalizeKey = (name: string) => [...tokens(name)].sort().join(' ');

const SHEET_DATE = /^(\d{1,2})\.(\d{1,2})$/;

/** Date (local midnight) for a sheet named only by a date, in the year closest to `today`. */
export function parseSheetDate(name: string, today: Date): Date | null {
  const m = SHEET_DATE.exec(name.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]) - 1;
  let best: Date | null = null;
  for (const year of [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]) {
    const d = new Date(year, month, day);
    if (d.getMonth() !== month || d.getDate() !== day) continue; // e.g. 29.02 outside a leap year
    if (!best || Math.abs(d.getTime() - today.getTime()) < Math.abs(best.getTime() - today.getTime())) best = d;
  }
  return best;
}

const TIME = /^(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*יום\s+(\S+))?$/;

export function parseTime(text: string): { minutes: number; weekday?: number } | null {
  const m = TIME.exec(normalizeText(text));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const weekday = m[3] === undefined ? undefined : WEEKDAYS[m[3]];
  return weekday === undefined ? { minutes: h * 60 + min } : { minutes: h * 60 + min, weekday };
}

/**
 * Minutes from the sheet date's midnight for a sequence of time cells. A weekday label sets the day;
 * an unlabeled time that isn't later than the previous one rolls over to the next day.
 */
function resolveTimes(texts: string[], date: Date): number[] {
  let offset = 0;
  let prev = -Infinity;
  return texts.map((text) => {
    const t = parseTime(text)!;
    if (t.weekday !== undefined) offset = (t.weekday - date.getDay() + 7) % 7;
    let abs = offset * DAY + t.minutes;
    while (t.weekday === undefined && abs <= prev) {
      offset++;
      abs += DAY;
    }
    prev = abs;
    return abs;
  });
}

const addMinutes = (date: Date, minutes: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, minutes);
const durationOf = (mission: string) => (EIGHT_HOURS.has(mission) ? 8 : 4) * 60;
/** A slot lasts the mission's length, unless the next time in its sequence comes sooner. */
const slotEnds = (times: number[], mission: string) =>
  times.map((t, n) => Math.min(t + durationOf(mission), times[n + 1] ?? Infinity));
const isMission = (text: string) => MISSIONS.has(normalizeText(text));
const isMarker = (text: string) => isMission(text) || parseTime(text) !== null || normalizeText(text) === 'שעה';

/** Minutes from the sheet date's midnight at which the sheet's day starts (its first `שעה` row). */
export function findDayStart(sheet: Sheet, date: Date): number {
  for (const [r, row] of sheet.grid.entries()) {
    const c = row.findIndex((text) => normalizeText(text) === 'שעה');
    const first = sheet.grid[r + 1]?.[c] ?? '';
    if (c >= 0 && parseTime(first)) return resolveTimes([first], date)[0]!;
  }
  return DEFAULT_DAY_START;
}

export function extractAssignments(sheet: Sheet, date: Date, dayStart = findDayStart(sheet, date)): Assignment[] {
  const { grid } = sheet;
  const cell = (r: number, c: number) => (grid[r]?.[c] ?? '').trim();
  const out: Assignment[] = [];
  const add = (mission: string, startMin: number, endMin: number, text: string, allDay = false) =>
    out.push({ mission, start: addMinutes(date, startMin), end: addMinutes(date, endMin), allDay, text, sheet: sheet.name });
  const isName = (text: string) => text !== '' && !isMarker(text);

  // Row-timed grid: `שעה` header, times down its column, row-timed missions across.
  const gridHeaders = new Set<string>();
  grid.forEach((row, r) =>
    row.forEach((text, c) => {
      if (normalizeText(text) !== 'שעה') return;
      const rows: number[] = [];
      for (let i = r + 1; parseTime(cell(i, c)); i++) rows.push(i);
      if (rows.length === 0) return;
      const times = resolveTimes(rows.map((i) => cell(i, c)), date);
      for (let k = c + 1; k < row.length; k++) {
        const mission = normalizeText(cell(r, k));
        if (!ROW_TIMED.has(mission)) continue;
        gridHeaders.add(`${r},${k}`);
        const ends = slotEnds(times, mission);
        rows.forEach((i, n) => {
          const name = cell(i, k);
          if (isName(name)) add(mission, times[n]!, ends[n]!, name);
        });
      }
    }),
  );

  grid.forEach((row, r) =>
    row.forEach((raw, c) => {
      const mission = normalizeText(raw);
      if (!MISSIONS.has(mission) || gridHeaders.has(`${r},${c}`)) return;

      // Column-timed block: a row of times directly below the title, or to its right.
      const [tr, tc] = parseTime(cell(r + 1, c)) ? [r + 1, c] : parseTime(cell(r, c + 1)) ? [r, c + 1] : [-1, -1];
      if (tr >= 0) {
        // The block may continue with another row of times right under the names (seen in a חמל block).
        const slots: { row: number; col: number }[] = [];
        for (let row = tr; ; ) {
          for (let k = tc; parseTime(cell(row, k)); k++) slots.push({ row, col: k });
          let next = row + 1;
          while (isName(cell(next, tc))) next++;
          if (next === row + 1 || !parseTime(cell(next, tc))) break;
          row = next;
        }
        const times = resolveTimes(slots.map((s) => cell(s.row, s.col)), date);
        const ends = slotEnds(times, mission);
        slots.forEach(({ row, col }, n) => {
          for (let i = row + 1; isName(cell(i, col)); i++) add(mission, times[n]!, ends[n]!, cell(i, col));
        });
        return;
      }

      // Whole-day block: names below the title (and below any filled cells beside it, e.g. "7+1").
      const cols = [c];
      while (cell(r, cols.at(-1)! + 1) !== '' && !isMarker(cell(r, cols.at(-1)! + 1))) cols.push(cols.at(-1)! + 1);
      for (let i = r + 1; ; i++) {
        const texts = cols.map((k) => cell(i, k));
        if (texts.every((t) => t === '') || texts.some(isMarker)) break;
        for (const t of texts) if (t !== '') add(mission, dayStart, dayStart + DAY, t, true);
      }
    }),
  );
  return out;
}

const isHeader = (text: string) => /^(מחלקה|מפלג|סה"כ)/.test(text) || SECTIONS.has(text);

/** Soldiers listed in the attendance sections (נוכחים / יוצאים / חוזרים) of the date sheets. */
export function buildRoster(sheets: Sheet[]): Soldier[] {
  const spellings = new Map<string, Map<string, number>>();
  for (const { name, grid } of sheets) {
    if (!SHEET_DATE.test(name.trim())) continue;
    const cell = (r: number, c: number) => normalizeText(grid[r]?.[c] ?? '');
    grid.forEach((row, r) =>
      row.forEach((text, c) => {
        if (!SECTIONS.has(normalizeText(text))) return;
        for (let i = r + 1; i < grid.length && !SECTIONS.has(cell(i, c)); i++) {
          const texts = [0, 1, 2, 3].map((d) => cell(i, c + d));
          if (i > r + 1 && texts.every((t) => t === '')) break;
          for (const t of texts) {
            if (t === '' || isHeader(t) || /\d/.test(t) || tokens(t).length < 2) continue;
            const key = normalizeKey(t);
            const counts = spellings.get(key) ?? new Map<string, number>();
            // Re-inserting moves the spelling last, so later sheets win ties below.
            const n = (counts.get(t) ?? 0) + 1;
            counts.delete(t);
            counts.set(t, n);
            spellings.set(key, counts);
          }
        }
      }),
    );
  }
  return [...spellings]
    .map(([key, counts]) => {
      let name = '';
      let best = 0;
      for (const [spelling, n] of counts) if (n >= best) [name, best] = [spelling, n];
      return { key, name, tokens: key.split(' ') };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

/** Separators between the people/notes within one cell ("לוי->ישראל כהן", "עד 18: לוי, מ 18: כהן"). */
const SEGMENT = /->|[(),+/\\;:<>-]/;

/** Drops soldiers whose name is part of another matched soldier's name ("ישראל כהן" in "ישראל דוד כהן"). */
const longestNames = (found: Soldier[]) =>
  found.filter((s) => !found.some((o) => o.tokens.length > s.tokens.length && s.tokens.every((t) => o.tokens.includes(t))));

/**
 * Soldiers a cell refers to. Each part of the cell is matched on its own: every word of a soldier's name
 * appears (exactly, or else up to spelling variants), or its one meaningful word names exactly one soldier.
 */
export function matchSoldiers(text: string, roster: Soldier[]): Match[] {
  const out: Match[] = [];
  const add = (soldiers: Soldier[], partial: boolean) => {
    for (const s of soldiers) if (!out.some((m) => m.key === s.key)) out.push({ key: s.key, partial });
  };
  for (const segment of text.split(SEGMENT)) {
    const words = tokens(segment);
    const named = (eq: (a: string, b: string) => boolean) =>
      longestNames(roster.filter((s) => s.tokens.every((t) => words.some((w) => eq(w, t)))));
    const exact = named((a, b) => a === b);
    if (exact.length) {
      add(exact, false);
      continue;
    }
    const fuzzy = named((a, b) => a === b || similarWord(a, b));
    if (fuzzy.length) {
      add(fuzzy, true);
      continue;
    }
    const meaningful = words.filter((w) => !FILLER.has(w) && w.length > 1 && !/\d/.test(w));
    if (meaningful.length !== 1) continue;
    const word = meaningful[0]!;
    let candidates = roster.filter((s) => s.tokens.includes(word));
    if (candidates.length === 0) candidates = roster.filter((s) => s.tokens.some((t) => similarWord(word, t)));
    if (candidates.length === 1) add(candidates, true);
  }
  return out;
}

export function loadSchedule(sheets: Sheet[], today: Date): ScheduleData {
  const roster = buildRoster(sheets);
  const dated = sheets.flatMap((sheet) => {
    const date = parseSheetDate(sheet.name, today);
    if (!date) return [];
    const dayStart = findDayStart(sheet, date);
    return [{ sheet, date, dayStart, start: addMinutes(date, dayStart) }];
  });
  const assignments = dated.flatMap(({ sheet, date, dayStart }) => {
    // The next date's sheet takes over from its start (some sheets start at 10:00): whole-day duties end
    // then, and slots it also covers are its to assign.
    const next = dated.find((d) => d.date.getTime() === addMinutes(date, DAY).getTime());
    return extractAssignments(sheet, date, dayStart)
      .filter((a) => a.allDay || !next || a.start < next.start)
      .map((a) => ({
        ...a,
        end: a.allDay && next && next.start < a.end ? next.start : a.end,
        people: matchSoldiers(a.text, roster),
      }));
  });
  return { roster, assignments };
}

/** The soldier's missions that haven't ended by `now`, sorted, with overlapping timed missions flagged. */
export function scheduleFor(key: string, data: ScheduleData, now: Date): Entry[] {
  const seen = new Set<string>();
  const entries: Entry[] = [];
  for (const { people, ...a } of data.assignments) {
    const match = people.find((p) => p.key === key);
    if (!match || a.end <= now) continue;
    const id = `${a.mission}|${a.start.getTime()}|${a.end.getTime()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({ ...a, partial: match.partial, showText: match.partial || normalizeKey(a.text) !== key, overlap: false });
  }
  entries.sort((x, y) => x.start.getTime() - y.start.getTime() || x.mission.localeCompare(y.mission, 'he'));
  // Only missions with set times can clash; whole-day duties have no times to overlap.
  const timed = entries.filter((e) => !e.allDay);
  for (const x of timed) {
    for (const y of timed) if (x !== y && x.start < y.end && y.start < x.end) x.overlap = true;
  }
  return entries;
}

/** A time slot of one mission and everyone listed in it. */
export interface Slot {
  start: Date;
  end: Date;
  names: string[];
}

function slotsOf(assignments: Assignment[]): Slot[] {
  const byStart = new Map<number, Slot>();
  for (const a of assignments) {
    const slot = byStart.get(a.start.getTime()) ?? { start: a.start, end: a.end, names: [] };
    if (a.end > slot.end) slot.end = a.end;
    if (!slot.names.includes(a.text)) slot.names.push(a.text);
    byStart.set(a.start.getTime(), slot);
  }
  return [...byStart.values()].sort((x, y) => x.start.getTime() - y.start.getTime());
}

/** Who is on the same mission in the slot before and after the entry's, and who shares its slot. */
export function slotNeighbors(entry: Entry, data: ScheduleData): { prev: Slot | null; with: string[]; next: Slot | null } {
  const slots = slotsOf(data.assignments.filter((a) => a.mission === entry.mission));
  const i = slots.findIndex((s) => s.start.getTime() === entry.start.getTime());
  return {
    prev: slots[i - 1] ?? null,
    with: slots[i]?.names.filter((n) => n !== entry.text) ?? [],
    next: slots[i + 1] ?? null,
  };
}

/** Who is on each mission at `now`: timed missions first, each group in mission order. */
export function currentOccupants(data: ScheduleData, now: Date): (Slot & { mission: string; allDay: boolean })[] {
  const running = data.assignments.filter((a) => a.start <= now && now < a.end);
  const out: (Slot & { mission: string; allDay: boolean })[] = [];
  for (const allDay of [false, true]) {
    for (const mission of MISSION_ORDER) {
      const slots = slotsOf(running.filter((a) => a.mission === mission && a.allDay === allDay));
      out.push(...slots.map((slot) => ({ ...slot, mission, allDay })));
    }
  }
  return out;
}
