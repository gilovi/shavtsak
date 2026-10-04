import { read, utils, type WorkBook } from 'xlsx';

/** Set at build time from VITE_SHEET_ID (.env locally, the SHEET_ID secret in CI); never committed. */
const SHEET_ID: string | undefined = import.meta.env.VITE_SHEET_ID;
const EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;

/** A sheet as a grid of the cells' displayed text ('' for empty cells). */
export interface Sheet {
  name: string;
  grid: string[][];
}

export function workbookToSheets(wb: WorkBook): Sheet[] {
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name]!;
    const grid = utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '', blankrows: true });
    return { name, grid };
  });
}

export async function fetchSheets(timeoutMs = 30_000): Promise<Sheet[]> {
  if (!SHEET_ID) throw new Error('VITE_SHEET_ID is not set');
  const res = await fetch(EXPORT_URL, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return workbookToSheets(read(await res.arrayBuffer()));
}
