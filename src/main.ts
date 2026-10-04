import './style.css';
import {
  currentOccupants,
  loadSchedule,
  scheduleFor,
  slotNeighbors,
  type Entry,
  type ScheduleData,
  type Slot,
} from './schedule';
import { fetchSheets } from './workbook';

const SOLDIER_KEY = 'shavtsak.soldier';
const SOLDIER_NAME_KEY = 'shavtsak.soldierName';
const CACHE_KEY = 'shavtsak.cache.v1';
/** Refetch when the app comes back to the foreground after this long. */
const STALE_MS = 5 * 60 * 1000;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $('status');
const pickerEl = $('picker');
const searchEl = $<HTMLInputElement>('search');
const namesEl = $<HTMLUListElement>('names');
const soldierEl = $('soldier');
const soldierNameEl = $('soldier-name');
const scheduleEl = $('schedule');
const nowEl = $('now');
const nowListEl = $('now-list');
const nowToggleEl = $<HTMLButtonElement>('now-toggle');
const refreshEl = $<HTMLButtonElement>('refresh');

type View = 'picker' | 'soldier' | 'now';

let data: ScheduleData | null = null;
let fetchedAt = 0;
let loading = false;
let failed = false;
let selected: string | null = storageGet(SOLDIER_KEY);
let view: View = selected ? 'soldier' : 'picker';
/** The view to return to from the "on duty now" screen. */
let backView: View = view;
/** Entries (by mission + start) whose before/after details are open. */
const expanded = new Set<string>();

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode / quota): the app still works, it just won't remember.
  }
}

function saveCache() {
  if (!data) return;
  const assignments = data.assignments.map((a) => ({ ...a, start: a.start.getTime(), end: a.end.getTime() }));
  storageSet(CACHE_KEY, JSON.stringify({ fetchedAt, roster: data.roster, assignments }));
}

function loadCache() {
  const raw = storageGet(CACHE_KEY);
  if (!raw) return;
  try {
    const cached = JSON.parse(raw);
    if (!Array.isArray(cached?.roster) || !Array.isArray(cached?.assignments)) return;
    data = {
      roster: cached.roster,
      assignments: cached.assignments.map((a: { start: number; end: number }) => ({
        ...a,
        start: new Date(a.start),
        end: new Date(a.end),
      })),
    };
    fetchedAt = Number(cached.fetchedAt) || 0;
  } catch {
    data = null;
  }
}

async function refresh() {
  if (loading) return;
  loading = true;
  failed = false;
  refreshEl.classList.add('spinning');
  refreshEl.disabled = true;
  renderStatus();
  try {
    data = loadSchedule(await fetchSheets(), new Date());
    fetchedAt = Date.now();
    saveCache();
  } catch (err) {
    console.error(err);
    failed = true;
  } finally {
    loading = false;
    refreshEl.classList.remove('spinning');
    refreshEl.disabled = false;
    render();
  }
}

const timeFmt = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'long' });
const dateFmt = new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit' });
const shortDayFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'short' });
const updatedFmt = new Intl.DateTimeFormat('he-IL', {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const normalizeSearch = (s: string) => s.replace(/[׳’`´]/g, "'").trim();
const range = (start: Date, end: Date) => `${timeFmt.format(start)}–${timeFmt.format(end)}`;
/** Whole-day duties span a day (at least 14:00 to a 10:00 next sheet); part of one, e.g. a מגן שומרון crew around a rotation, shows its times. */
const isFullDay = (s: { start: Date; end: Date; allDay: boolean }) =>
  s.allDay && s.end.getTime() - s.start.getTime() >= 20 * 60 * 60 * 1000;
const when = (s: { start: Date; end: Date; allDay: boolean }) => (isFullDay(s) ? 'כל היום' : range(s.start, s.end));
/** A crew's names, marking its commander. */
const crewNames = (names: string[], commander?: string) =>
  names.map((n) => (n === commander ? `${n} (מפקד)` : n)).join(', ');
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function renderStatus() {
  if (loading) statusEl.textContent = 'טוען…';
  else if (failed)
    statusEl.textContent = data
      ? `לא הצלחתי לרענן — מוצג מידע מ${updatedFmt.format(fetchedAt)}`
      : 'לא הצלחתי לטעון את השבצק. בדקו חיבור ונסו שוב.';
  else statusEl.textContent = data ? `עודכן ${updatedFmt.format(fetchedAt)}` : '';
  statusEl.classList.toggle('error', failed && !loading);
}

function renderPicker() {
  namesEl.replaceChildren();
  if (!data) return;
  const words = normalizeSearch(searchEl.value).split(/\s+/).filter(Boolean);
  for (const soldier of data.roster) {
    if (!words.every((w) => soldier.name.includes(w))) continue;
    const li = el('li');
    const button = el('button', soldier.key === selected ? 'name current' : 'name', soldier.name);
    button.type = 'button';
    button.addEventListener('click', () => {
      selected = soldier.key;
      storageSet(SOLDIER_KEY, soldier.key);
      storageSet(SOLDIER_NAME_KEY, soldier.name);
      view = 'soldier';
      expanded.clear();
      searchEl.value = '';
      render();
      window.scrollTo({ top: 0 });
    });
    li.append(button);
    namesEl.append(li);
  }
  if (!namesEl.childElementCount) namesEl.append(el('li', 'empty', 'לא נמצא שם מתאים'));
}

/** A muted row above/below an expanded mission: the same mission's previous or next slot. */
function renderNeighbor(slot: Slot | null, e: { start: Date; allDay: boolean }, side: 'prev' | 'next') {
  const row = el('div', `entry-row neighbor-row ${side}`);
  const time = el('span', 'time');
  if (slot) {
    time.append(el('span', '', when({ ...slot, allDay: e.allDay })));
    if (slot.start.toDateString() !== e.start.toDateString()) time.append(el('span', 'time-day', dayFmt.format(slot.start)));
  } else {
    time.textContent = '—';
  }
  const names = slot ? crewNames(slot.names, slot.commander) : side === 'prev' ? 'אין משמרת קודמת בשבצק' : 'עוד לא שובץ';
  row.append(time, el('span', slot ? 'neighbor-names' : 'neighbor-names none', names));
  return row;
}

/** When a whole-day duty begins (unless it's already on) and ends. */
function fullDayNote(s: { start: Date; end: Date }) {
  const until = `עד ${shortDayFmt.format(s.end)} ${timeFmt.format(s.end)}`;
  return s.start > new Date() ? `מ${shortDayFmt.format(s.start)} ${timeFmt.format(s.start)} ${until}` : until;
}

function toggle(id: string) {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
  render();
}

function renderEntry(e: Entry, now: Date) {
  const id = `${e.mission}|${e.start.getTime()}`;
  const open = expanded.has(id);
  const li = el('li', e.overlap ? 'entry overlap' : 'entry');
  const row = el('button', 'entry-row');
  row.type = 'button';
  row.setAttribute('aria-expanded', String(open));
  row.addEventListener('click', () => toggle(id));

  row.append(el('span', 'time', when(e)));
  const body = el('span', 'what');
  body.append(el('span', 'mission', e.commander ? `${e.mission} · מפקד` : e.mission));
  if (isFullDay(e)) body.append(el('span', 'note', fullDayNote(e)));
  if (e.showText) body.append(el('span', 'note', `רשום: ${e.text}`));
  // A whole-day duty already under way: the crew as it is now.
  const neighbors = open ? slotNeighbors(e.allDay && e.start < now ? { ...e, start: now } : e, data!) : null;
  if (neighbors?.with.length) body.append(el('span', 'note', `איתך: ${crewNames(neighbors.with, neighbors.commander)}`));
  row.append(body);
  const tags = el('span', 'tags');
  if (e.start <= now) tags.append(el('span', 'tag now', 'עכשיו'));
  if (e.overlap) tags.append(el('span', 'tag clash', 'חפיפה'));
  tags.append(el('span', open ? 'chevron open' : 'chevron', '‹'));
  row.append(tags);

  if (neighbors) li.append(renderNeighbor(neighbors.prev, e, 'prev'), row, renderNeighbor(neighbors.next, e, 'next'));
  else li.append(row);
  return li;
}

function renderSchedule() {
  if (!data || !selected) return;
  const soldier = data.roster.find((s) => s.key === selected);
  soldierNameEl.textContent = soldier?.name ?? storageGet(SOLDIER_NAME_KEY) ?? selected;
  const now = new Date();
  const entries = scheduleFor(selected, data, now);
  scheduleEl.replaceChildren();
  if (!entries.length) {
    scheduleEl.append(el('p', 'empty', 'אין משימות קרובות בשבצק.'));
    return;
  }
  let list: HTMLUListElement | null = null;
  let lastDay = '';
  for (const e of entries) {
    const day = e.start.toDateString();
    if (day !== lastDay || !list) {
      lastDay = day;
      const group = el('section', 'day');
      const head = el('h3');
      head.append(el('span', '', dayFmt.format(e.start)), el('span', 'date', dateFmt.format(e.start)));
      list = el('ul', 'entries');
      group.append(head, list);
      scheduleEl.append(group);
    }
    list.append(renderEntry(e, now));
  }
}

function renderNow() {
  if (!data) return;
  const now = new Date();
  const slots = currentOccupants(data, now);
  nowListEl.replaceChildren();
  if (!slots.length) {
    nowListEl.append(el('p', 'empty', 'אין משימות פעילות כרגע בשבצק.'));
    return;
  }
  for (const allDay of [false, true]) {
    const group = slots.filter((s) => s.allDay === allDay);
    if (!group.length) continue;
    const section = el('section', 'day');
    section.append(el('h3', '', allDay ? 'משימות יום' : 'משמרות'));
    const list = el('ul', 'entries');
    for (const s of group) {
      const id = `${s.mission}|${s.start.getTime()}`;
      const open = expanded.has(id);
      const li = el('li', 'entry');
      const row = el('button', 'entry-row');
      row.type = 'button';
      row.setAttribute('aria-expanded', String(open));
      row.addEventListener('click', () => toggle(id));
      row.append(el('span', 'time', when(s)));
      const body = el('span', 'what');
      body.append(el('span', 'mission', s.mission), el('span', 'names-line', crewNames(s.names, s.commander)));
      if (isFullDay(s)) body.append(el('span', 'note', fullDayNote(s)));
      const tags = el('span', 'tags');
      tags.append(el('span', open ? 'chevron open' : 'chevron', '‹'));
      row.append(body, tags);
      if (open) {
        const n = slotNeighbors(s, data);
        li.append(renderNeighbor(n.prev, s, 'prev'), row, renderNeighbor(n.next, s, 'next'));
      } else li.append(row);
      list.append(li);
    }
    section.append(list);
    nowListEl.append(section);
  }
}

function render() {
  renderStatus();
  const ready = Boolean(data);
  const current: View = view === 'soldier' && !selected ? 'picker' : view;
  pickerEl.hidden = !ready || current !== 'picker';
  soldierEl.hidden = !ready || current !== 'soldier';
  nowEl.hidden = !ready || current !== 'now';
  nowToggleEl.hidden = !ready;
  nowToggleEl.textContent = current === 'now' ? 'חזרה' : 'מי במשמרת עכשיו';
  if (!ready) return;
  if (current === 'picker') renderPicker();
  else if (current === 'soldier') renderSchedule();
  else renderNow();
}

searchEl.addEventListener('input', renderPicker);
$('change').addEventListener('click', () => {
  view = 'picker';
  render();
  searchEl.focus();
});
// The same header button opens the "on duty now" screen and, as "חזרה", returns from it.
nowToggleEl.addEventListener('click', () => {
  if (view === 'now') {
    view = backView;
  } else {
    backView = view;
    view = 'now';
  }
  render();
  window.scrollTo({ top: 0 });
});
refreshEl.addEventListener('click', () => void refresh());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - fetchedAt > STALE_MS) void refresh();
  else render(); // Drop missions that ended while the app was in the background.
});
// Keep "now" tags and finished missions current while the app stays open.
setInterval(() => {
  if (document.visibilityState === 'visible' && !loading) render();
}, 60_000);

loadCache();
render();
void refresh();

// Open instantly and offline next time (the deployed site only; it would cache stale files in dev).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.error(err));
}
