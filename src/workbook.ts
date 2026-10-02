import { read, utils, type WorkBook } from 'xlsx';

export const SHEET_ID = '1wSaCSENqwvkcEdve9QO9KBpRzoiF8zRc4j_g1q-XFTs';
export const EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;

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
  const res = await fetch(EXPORT_URL, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return workbookToSheets(read(await res.arrayBuffer()));
}
