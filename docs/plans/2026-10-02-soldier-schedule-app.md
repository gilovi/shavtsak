# Soldier schedule web app — plan

## Goal
A soldier picks his name and sees all his upcoming missions, sorted by time, read live
from the shared Google Sheet (`1wSaCSENqwvkcEdve9QO9KBpRzoiF8zRc4j_g1q-XFTs`).

## Architecture
- Static site (Vite + TypeScript), no backend. Each browser downloads the sheet's
  public `export?format=xlsx` (Google serves it with `Access-Control-Allow-Origin: *`)
  and parses it with SheetJS. Dozens of concurrent users = dozens of direct downloads
  from Google; no server of ours to scale.
- Fetch on open and on "refresh". Last soldier + last parsed result kept in
  `localStorage` so the page shows something immediately / offline.

## Sheet format (observed)
- Relevant sheets are named only by a date: `D.MM` / `DD.MM`. A sheet covers
  ~14:00 on that date to ~14:00 the next day.
- Times are either real time cells (`14:00`) or text like `02:00:00 יום שישי`
  (weekday ⇒ that day). Without a label, a time earlier than the previous one in the
  same sequence rolls to the next day.
- Block layouts:
  1. **Row-timed grid**: header row starting with `שעה`; times down that column;
     columns `שג`, `בונקר`, `מזרחית`, `דרומית` hold one name per time row.
  2. **Column-timed block**: mission title with a row of times either directly below
     it (starting at the title column) or to its right in the same row; names are
     listed under each time until an empty cell. (`סיור`, `יזומה`, `חמל`, `כרמל חטיבה`.)
  3. **Whole-day block**: mission title with no times; names below it (in the title
     column plus any adjacent filled title-row cells, e.g. `7+1`) until an empty row.
     (`חפק`, `מטבח`, `מגן שומרון`.) Spans the sheet's day start → +24h.
- Missions: שג, בונקר, מזרחית, דרומית, יזומה, כרמל חטיבה, חפק, מטבח, חמל, מגן שומרון,
  סיור. Durations: סיור/יזומה/חמל 8h, others 4h. Anything else (e.g. קצין מוצב) ignored.
- Roster (the names to choose from): the נוכחים / יוצאים / חוזרים lists (4 columns
  under the `מחלקה` headers) of all date sheets. Names appear in both orders
  (`כהן ישראל` / `ישראל כהן`), so identity = sorted token set.
- Matching a cell to a soldier: the cell contains all of the soldier's name tokens,
  or a single-word segment of the cell (split on parentheses/commas) is a token of
  exactly one roster name (`לוי` → `דני לוי`). Partial matches show the raw
  cell text.

## UI
- RTL, mobile-first. Search box + name list; selected name remembered.
- Upcoming missions (end > now) grouped by start date: `14:00–18:00 · כרמל חטיבה`.
- Overlapping missions painted red.
- Refresh button + "last updated" time.

## Acceptance criteria
1. The user's 10.09 example (one soldier) gives exactly:
   14–18 כרמל חטיבה, 18–22 שג, 22–02 כרמל חטיבה, 06–14 סיור (next day).
2. Times with a weekday label or that wrap past midnight land on the next day.
3. Whole-day missions (חפק, מטבח, מגן שומרון) are detected and span 24h.
4. Durations follow the mission table.
5. Overlapping missions are flagged.
6. Name variants (reversed order, single-word nicknames) match; ambiguous single
   words (a first name shared by two soldiers) don't.
7. Only sheets named by a date are read; year chosen closest to today.
