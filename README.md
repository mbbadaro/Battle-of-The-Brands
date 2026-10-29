# Battle of the Brands: CLIF Builders sales tracker

A mobile-first web app for the Cornell MBA Battle of the Brands. The team sells CLIF Builders White Fudge OREO flavor protein bars in three bundles, priced in tickets, from a shared stock of 200 bars. Several sellers record sales on their own phones at the same time, and everyone sees inventory and results update live.

| Product | Bars per package | Tickets |
|---|---|---|
| Single Bar | 1 | 3 |
| Week Pack | 3 | 6 |
| Exam Week Bundle | 5 | 8 |

## Architecture

```
Phones / laptops (Next.js 15 + React 19, TypeScript, Tailwind)
   │  supabase-js with the signed-in user's JWT (anon key only; no secrets in the browser)
   ▼
Supabase
   ├─ Auth (email + password)
   ├─ PostgREST → RPC functions (all writes and reads go through them)
   ├─ Postgres: tables + row level security + SECURITY DEFINER functions
   └─ Realtime: one "ticker" row; every write bumps it, every client refetches
```

- **The database is the server.** Every sale, void and adjustment is a Postgres function (`record_sale`, `void_transaction`, `adjust_inventory`, …). It checks the caller's role, validates input, recomputes bars and tickets from the product table, and checks stock. The browser only previews the numbers.
- **No overselling.** Each inventory-changing function first locks the single `event_settings` row (`SELECT … FOR UPDATE`). Sales, voids and adjustments therefore run one at a time, and the stock check happens inside the lock. Tested with 60 concurrent sales.
- **Inventory is a ledger, not a counter.** `remaining = initial_inventory + Σ adjustments.delta − Σ bars of completed sales`. Voiding a sale flips its status, so its bars come back automatically, and nothing can drift.
- **Idempotent submissions.** Each sale attempt carries a `client_request_id` (UUID, unique in the table). Double taps and network retries reuse it, so the second call returns the first sale instead of creating another.
- **Realtime without leaking data.** Only the `live_ticker` table is published to Supabase Realtime. It holds a version number, not sales, so NetIDs never go over the realtime feed. Clients refetch aggregates through RPCs when it changes, poll every 15 seconds as a fallback, and refresh when the tab regains focus or the network comes back.

### Database design

| Table | Purpose |
|---|---|
| `profiles` | One row per team member: name, email, role (`pending`, `seller`, `admin`). Created by a trigger on sign-up. |
| `event_settings` | Singleton: initial inventory (200), time zone, `sales_started_at` (locks initial inventory), duplicate-NetID window (120 s), seller undo window (5 min). |
| `products` | The three products, with bars and tickets per package and an `active` flag. |
| `transactions` | One row per sale: NetID, optional name and category, total bars and tickets, seller, status (`completed`/`voided`), void time, voider and reason, `client_request_id`. |
| `transaction_items` | Quantity per product per sale, with the unit bars and tickets copied at sale time. |
| `inventory_adjustments` | Restocks and corrections: signed `delta`, required reason, who and when. |
| `audit_log` | Append-only record of sign-ups, role changes, inventory settings, adjustments, availability changes, voids and resets. |
| `live_ticker` | Version counter for realtime refresh. |

Migrations: `supabase/migrations/` (schema and RLS, functions, product and inventory configuration). `supabase/setup.sql` is all the migration files joined (`npm run db:bundle`), for pasting into the SQL editor.

### Authentication and permissions

- Email and password through Supabase Auth. **The first account created becomes the admin.** Everyone after that starts as `pending` and cannot see or do anything until an admin approves them in Admin → Team.
- **Seller:** records sales, sees inventory, dashboard and report, sees only the sales they recorded, and can undo their own sale within 5 minutes (reason required).
- **Admin:** everything a seller can do, plus sets initial inventory (before the first sale), records restocks and corrections, turns products on and off, edits how many bars and tickets each package has (past sales keep the values they were sold at), approves and changes roles, sees all transactions, voids any sale, exports CSV, reads the audit log, and can reset rehearsal data.
- Row level security is on for every table. Clients have **no** insert, update or delete rights on any table. `anon` has no table access and cannot call any function. Every function is `SECURITY DEFINER` with an empty `search_path` and checks the role itself.
- Privacy: NetID is required, while name and category are optional. The dashboard and report show only aggregates, with no NetIDs or names. The CSV export and the full history are for admins only.

## Setup

Requirements: Node 20.18 or newer (Node 22.18+ to run the database and browser tests) and a free Supabase project.

1. **Create the Supabase project** at supabase.com. Pick a region close to Ithaca (for example `us-east-1`).
2. **Run the SQL.** Either:
   - open the project's SQL editor, paste `supabase/setup.sql` and run it, or
   - with the CLI: `npx supabase login`, `npx supabase init` (keep the existing migrations), `npx supabase link --project-ref <ref>`, `npx supabase db push`.
3. **Auth settings** (Authentication → Providers → Email): keep Email enabled. To let teammates sign up without waiting for a confirmation email, turn off **Confirm email**. That is safe here because new accounts stay `pending` until an admin approves them. If you leave it on, people click the email link first.
4. **Realtime:** nothing to do. The migration adds `live_ticker` to the `supabase_realtime` publication. (Check Database → Publications if your project uses a custom publication.)
5. **Environment variables:** copy `.env.example` to `.env.local` and fill in from Project Settings → API:

   | Variable | Value | Secret? |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | No |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the `anon` / publishable key | No. It is designed to be public, and RLS plus the function checks are what protect the data. |

   Never add the `service_role` key. The app doesn't use it.
6. `npm install`, then `npm run dev` and open http://localhost:3000.
7. **Create the admin account first** (the first sign-up becomes admin), then have each seller sign up and approve them.

## Deploy (Vercel, free tier)

1. Push this folder to a GitHub repository.
2. On vercel.com: New Project → import the repo. The framework is detected as Next.js.
3. Add the two environment variables above (Production and Preview) and deploy.
4. In Supabase → Authentication → URL Configuration, set **Site URL** to the Vercel URL. Confirmation emails then link to the right place.
5. Open the URL on a phone and use Share → **Add to Home Screen** so sellers open it like an app.

Any Node host that runs `npm run build && npm start` works too (Netlify, Render, Railway, Fly).

## Running the event

**Before the event**
1. The admin signs up first, opens **Admin**, checks that initial inventory is 200 and all three products are available.
2. Every seller signs up on their own phone; the admin taps **Approve** for each.
3. Do a rehearsal: record a few sales on two phones, void one, and check the dashboard. Then, in **Admin → Reset rehearsal data**, type `RESET ALL SALES`. This deletes test sales and adjustments, keeps the team and the audit log, and unlocks initial inventory again.

**Recording a sale (Sell tab, about 5 seconds)**
1. Type the customer's NetID (for example `abc123`; `@cornell.edu` is stripped automatically).
2. Tap the product cards or **+** for each product. The bottom bar shows bars, tickets and bars left after the sale.
3. Optionally open *Customer name & category*.
4. Tap **Record sale · N tickets**. A green banner confirms it, and the form clears for the next customer.
- If the same NetID bought in the last 2 minutes, the app asks before recording again. That catches accidental repeats.
- If stock runs short (including because someone else just sold), the bottom bar turns red and the button disables.
- Wrong entry? Tap **Undo** on the green banner or in *My recent sales* (sellers: within 5 minutes; admins: any time) and pick a reason. The sale stays in the history as voided and its bars return to stock.

**During and after**
- **Dashboard:** live KPIs, product comparison, best seller, top ticket earner, most inventory used, slowest seller, timeline, and customer categories.
- **History** (admin): search by NetID or name, filter by status, product, category, seller and date, open details, void, export CSV.
- **Report:** final numbers with inventory reconciliation, product ranking, categories, timeline, voids and adjustments. Buttons export the transactions CSV (admin), a summary CSV, copy a text summary for the team chat, or print/save as PDF.
- Found a box of extra bars or some damaged ones? Admin → **Adjust inventory**, with a reason. It goes into the audit trail and the report.

## Metric definitions

All figures come from database records and exclude voided transactions.

- **Tickets earned** = Σ tickets of completed transactions.
- **Bars sold** = Σ bars of completed transactions (Single Bar × 1 + Week Pack × 3 + Exam Week Bundle × 5).
- **Packages sold** (per product) = Σ quantity of that product in completed transactions.
- **Bars remaining** = initial + positive adjustments − negative adjustments − bars sold.
- **% inventory sold / utilization** = bars sold ÷ (initial + positive − negative adjustments) × 100.
- **Unique customers** = distinct NetIDs with a completed transaction.
- **Average tickets per transaction** = tickets earned ÷ completed transactions.
- **% of tickets** (per product) = product tickets ÷ tickets earned.
- **% of transactions containing the product** = completed sales that include it ÷ completed sales. These don't add up to 100% because one sale can contain several products.
- **Average quantity per transaction containing the product** = packages ÷ sales that include it.
- **Customer category**: each NetID is counted once, under the most recent category it gave. NetIDs that never gave one are "Not specified". Customers, sales and tickets per category therefore add up exactly to the totals.
- **Highlights**: best seller = most packages; top revenue = most tickets; most inventory = most bars; slowest = fewest packages. Ties are shown together.

## Tests

| Command | What it checks |
|---|---|
| `npm test` | Unit tests: sale formulas, NetID rules, analytics, highlights and ties, timeline, CSV escaping. |
| `npm run test:db` | 26 database tests that run the real migrations on PostgreSQL (with a small stand-in for Supabase's `auth` schema): all 12 acceptance scenarios, 60 concurrent sales, idempotent retries, duplicate-NetID prompt, RLS (no direct writes, sellers can't see others' sales, `anon` blocked), restart persistence (`PG_RESTART_CMD`), reset. Needs a Postgres at `PGHOST`/`PGPORT` (default `127.0.0.1:5433`). |
| `npm run test:e2e` | 19 browser checks with Playwright: two separate devices (a phone and a laptop) using the production build against a test gateway (`tests/e2e/mock-supabase.mjs`) that speaks the Supabase Auth, RPC and Realtime protocols over the real migrated database. It covers every acceptance scenario, including the realtime sync between devices, the two-device race for the last 5 bars, and comparing the CSV download with the database. |

The test gateway exists only because a full local Supabase stack (Docker) wasn't available in the build environment. Against a real Supabase project the app talks to Supabase directly.
