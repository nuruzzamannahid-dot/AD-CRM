# CarryBee AD CRM — Daily Call Tracking Dashboard

Pixel-match rebuild of the `ad_crm_ui_design.html` mock, now a working app:
Node/Express backend, Turso (libSQL) for persistence, vanilla JS frontend
(no build step). Matches the CarryBee AD tooling stack (see kam-solution-dashboard
and merchant-pulse-dashboard for the same pattern).

## What's wired up

- **Metric cards** — calls logged, dissatisfaction rate, newly onboarded,
  business inactive — computed live from the `calls` table, compared to
  yesterday.
- **AD call funnel** — assigned / called / reached / dissatisfied /
  resolved, computed per selected AD manager.
- **Recent call log** — live table, filterable by the reason-tag chips,
  date range, and AD manager.
- **Dissatisfaction breakdown** — sub-tag share bars, computed from actual
  logged calls (not hardcoded percentages).
- **New call entry form** — merchant search/autocomplete, AD manager,
  reason tag, conditional dissatisfaction sub-tag chips, follow-up date,
  notes. Submits to Turso via `POST /api/calls`.

## 1. Create the Turso database

```bash
turso db create carrybee-ad-crm
turso db show carrybee-ad-crm --url
turso db tokens create carrybee-ad-crm
```

Copy `.env.example` to `.env` and paste the URL + token in.

## 2. Install & seed

```bash
npm install
npm run seed     # reason tags, sub-tags, and 2 sample managers/merchants
```

The schema (`db/schema.sql`) is applied automatically on first server start,
so you don't need to run migrations by hand.

## 3. Run

```bash
npm start
```

Open http://localhost:3000 — the dashboard, funnel, and call log all pull
live from Turso from the first load.

## Notes / things you'll likely want to extend

- **Auth**: not wired up yet. The rest of your AD tooling gates on Google
  OAuth restricted to `@carrybee.com` — this app doesn't have that yet;
  add it the same way as kam-solution-dashboard before putting it in front
  of the team.
- **"Assigned to AD team"** in the funnel currently counts all rows in
  `merchants` (or the selected manager's merchants). If assignment is
  actually a daily/rotating thing on your side, you'll want an
  `assignments` table instead of treating the merchant list as static.
- **Reached vs. no-answer**: the form always logs `status = 'reached'`
  today, since the UI mock doesn't have a field for it. Add a toggle in
  the form once you want no-answer calls tracked separately.
- Merchant list is seeded with the 5 sample merchants from the mock —
  swap `db/seed.js` for a real import from your merchant sheet/pipeline
  (same pattern as the merchant-pulse-dashboard Apps Script → Turso feed)
  whenever you're ready to point this at real data.
