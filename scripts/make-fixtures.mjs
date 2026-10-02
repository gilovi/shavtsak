// Downloads the live sheet and snapshots the date-named sheets into src/__fixtures__/sheets.json
// (same cell-text conversion as src/workbook.ts) for the parser tests.
import { read, utils } from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';

const url = 'https://docs.google.com/spreadsheets/d/1u6LK8HKb9dB8tkMcwddxr1myVsFTQ-UvbAeRTrS5EFc/export?format=xlsx';
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
