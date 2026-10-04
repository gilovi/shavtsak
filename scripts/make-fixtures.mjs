// Downloads the live sheet and snapshots the date-named sheets into src/__fixtures__/sheets.json
// (same cell-text conversion as src/workbook.ts) for the parser tests.
import { read, utils } from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';

// The sheet's ID comes from VITE_SHEET_ID in .env (see README); it isn't committed.
const id = process.env.VITE_SHEET_ID;
if (!id) throw new Error('VITE_SHEET_ID is not set: add it to .env (see README → Sheet ID).');
const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
const wb = read(await (await fetch(url)).arrayBuffer());
const sheets = wb.SheetNames.map((name) => {
  const grid = utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '', blankrows: true });
  // Trim trailing empty rows/cells to keep the fixture small.
  const trimmed = grid.map((row) => { const r = [...row]; while (r.length && r.at(-1) === '') r.pop(); return r; });
  while (trimmed.length && trimmed.at(-1).length === 0) trimmed.pop();
  return { name, grid: trimmed };
});
mkdirSync('src/__fixtures__', { recursive: true });
writeFileSync('src/__fixtures__/sheets.json', JSON.stringify(sheets));
console.log(`wrote ${sheets.length} sheets`);
