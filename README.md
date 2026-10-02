# השבצק שלי

A small web app: a soldier picks his name and sees his upcoming missions, sorted by time,
read live from the shavtsak Google Sheet. Overlapping missions are shown in red.

- Static site, no backend: each browser downloads the sheet's public xlsx export directly from
  Google and parses it (SheetJS). Works for dozens of simultaneous users.
- Data is fetched when the app opens, when it returns to the foreground after 5+ minutes, and
  on the refresh button. The last chosen soldier and last data are kept in `localStorage`.
- The sheet must stay shared as "anyone with the link can view".

## Commands

```bash
npm install
npm run dev        # local dev server
npm test           # parser tests (made-up sheet; plus the real-sheet tests if you have them)
npm run fixtures   # snapshot the live sheet into src/__fixtures__/ for the real-sheet tests
npm run typecheck
npm run lint
npm run build      # static site in dist/
```

The committed tests use a made-up sheet with invented names. Tests against the real sheet live in
`src/schedule.real.test.ts` and use the snapshot; both contain soldiers' names, so both are
git-ignored and never uploaded (keep a private copy if you want them). CI runs typecheck, lint,
the committed tests and the build.

## Deploy

`dist/` can be hosted anywhere static. With GitHub: push to `main` and enable
Settings → Pages → Source: GitHub Actions; `.github/workflows/deploy.yml` builds and publishes.

## How the sheet is read

See [docs/plans/2026-10-02-soldier-schedule-app.md](docs/plans/2026-10-02-soldier-schedule-app.md).
Parsing lives in `src/schedule.ts`; if the sheet layout changes in a new way, add the new sheet
to `src/schedule.test.ts` as a made-up example (no real names), and optionally a real-sheet test
in `src/schedule.real.test.ts`.
