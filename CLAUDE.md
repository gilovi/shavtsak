# shavtsak

Static Vite + TypeScript app showing a soldier's missions from a public Google Sheet.

- `src/schedule.ts` — pure parsing/matching logic (sheet grid → assignments → per-soldier schedule). All logic changes go here, test-first in `src/schedule.test.ts`.
- `src/workbook.ts` — fetches the xlsx export and turns sheets into text grids.
- The sheet's ID is never committed: it comes from `VITE_SHEET_ID` (`.env` locally, git-ignored; the `SHEET_ID` repo secret in the deploy workflow).
- `src/main.ts` / `src/style.css` — UI (RTL Hebrew, light/dark).
- Committed tests (`src/schedule.test.ts`) use made-up sheets with invented names only. Never put real soldiers' names in any committed file (code, comments, docs, tests).
- `src/schedule.real.test.ts` + `src/__fixtures__/sheets.json` (made by `npm run fixtures`) test against the real sheet. They hold real names: git-ignored, never commit. Refreshing the snapshot may require re-checking those expectations against the sheet, not loosening them.
- Verify with `npm run typecheck && npm run lint && npm test`.
