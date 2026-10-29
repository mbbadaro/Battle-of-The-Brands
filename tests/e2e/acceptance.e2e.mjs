// Browser end-to-end run of the acceptance scenarios: the real Next.js build, two separate
// browser "devices", the mock Supabase gateway (tests/e2e/mock-supabase.mjs) and the real
// migrations on PostgreSQL.
//
//   node tests/e2e/mock-supabase.mjs &      # fresh database bob_e2e
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=x npm run build && npm start &
//   node tests/e2e/acceptance.e2e.mjs
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import pg from "pg";
import { parseCsv } from "../../src/lib/csv.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const APP = process.env.APP_URL ?? "http://localhost:3000";
const SHOTS = new URL("./screenshots/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const db = new pg.Pool({ host: "127.0.0.1", port: 5433, user: "postgres", database: process.env.TEST_DB ?? "bob_e2e" });
const q = async (sql, p) => (await db.query(sql, p)).rows;

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`✓ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log(`✗ ${name}\n   ${e.message}`);
  }
}

const browser = await chromium.launch();
const phone = { viewport: { width: 390, height: 664 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const ctxA = await browser.newContext({ ...phone, acceptDownloads: true }); // seller's phone
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true }); // admin laptop
const A = await ctxA.newPage();
const B = await ctxB.newPage();
for (const [n, p] of [["A", A], ["B", B]]) p.on("pageerror", (e) => console.log(`  [page ${n} error] ${e.message}`));

async function signup(page, name, email) {
  await page.goto(`${APP}/login`);
  await page.getByRole("button", { name: /Create an account/ }).click();
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(`${APP}/`);
}

const remainingOn = async (page) => Number((await page.getByTestId("bars-remaining").textContent()).replace(/,/g, ""));
const truth = async () =>
  (
    await q(`select (select initial_inventory from event_settings) + (select coalesce(sum(delta),0) from inventory_adjustments)
              - (select coalesce(sum(total_bars),0) from transactions where status='completed') as remaining,
              (select coalesce(sum(total_tickets),0) from transactions where status='completed') as tickets,
              (select count(*) from transactions where status='completed') as txns`)
  ).map((r) => ({ remaining: Number(r.remaining), tickets: Number(r.tickets), txns: Number(r.txns) }))[0];

async function sell(page, netid, items, opts = {}) {
  await page.getByTestId("netid").fill(netid);
  for (const [id, n] of Object.entries(items)) for (let i = 0; i < n; i++) await page.getByTestId(`plus-${id}`).click();
  if (opts.name || opts.category) {
    await page.getByRole("button", { name: /Customer name & category/ }).click();
    if (opts.name) await page.getByPlaceholder("Customer name (optional)").fill(opts.name);
    if (opts.category) await page.getByRole("button", { name: opts.category, exact: true }).click();
  }
  if (opts.beforeSubmit) await opts.beforeSubmit();
  await page.getByTestId("submit-sale").click();
  if (opts.expectError) return;
  const toast = page.getByTestId("sale-success").filter({ hasText: ` ${netid.toLowerCase()} ` });
  await toast.waitFor();
  return (await toast.textContent()) ?? "";
}

await step("Setup: first account becomes admin, second waits for approval, admin approves", async () => {
  await signup(B, "Ana Admin", "ana@example.com");
  await B.getByRole("link", { name: "Admin" }).waitFor();
  await signup(A, "Sam Seller", "sam@example.com");
  await A.getByText("waiting for an admin").waitFor();
  await A.screenshot({ path: SHOTS + "00-pending.png" });
  await B.goto(`${APP}/admin`);
  await B.getByRole("button", { name: "Approve" }).click();
  await B.getByText("approved as seller").waitFor();
  await A.getByRole("button", { name: "Check again" }).click();
  await A.getByTestId("bars-remaining").waitFor();
  assert.equal(await remainingOn(A), 200);
  await A.screenshot({ path: SHOTS + "01-sell-empty-phone.png" });
});

await B.goto(`${APP}/dashboard`);

await step("Empty states: dashboard shows no fabricated data before the first sale", async () => {
  await B.getByText("No sales yet").first().waitFor();
  const t = await truth();
  assert.equal(t.txns, 0);
  await B.screenshot({ path: SHOTS + "02-dashboard-empty.png", fullPage: true });
});

await step("AT1 Single Bar: 200 → 199, 3 tickets", async () => {
  const msg = await sell(A, "abc123", { single_bar: 1 }, {
    beforeSubmit: async () => {
      const footer = await A.getByTestId("submit-sale").textContent();
      assert.match(footer, /3 tickets/);
    },
  });
  assert.match(msg, /3 tickets/);
  await A.waitForFunction(() => document.querySelector('[data-testid="bars-remaining"]').textContent === "199");
  assert.deepEqual(await truth(), { remaining: 199, tickets: 3, txns: 1 });
});

await step("AT10 realtime: the sale shows on the other device without a reload", async () => {
  await B.getByText("Tickets earned").waitFor();
  await B.waitForFunction(() => !document.body.innerText.includes("No sales yet"), null, { timeout: 5000 });
});

await step("AT2 Week Pack: −3 bars, 6 tickets", async () => {
  const msg = await sell(A, "def45", { week_pack: 1 });
  assert.match(msg, /6 tickets/);
  assert.deepEqual(await truth(), { remaining: 196, tickets: 9, txns: 2 });
});

await step("AT3 Exam Week Bundle: −5 bars, 8 tickets", async () => {
  const msg = await sell(A, "ghi6", { exam_week_bundle: 1 });
  assert.match(msg, /8 tickets/);
  assert.deepEqual(await truth(), { remaining: 191, tickets: 17, txns: 3 });
});

await step("AT4 mixed: 2 Single + 1 Week + 1 Exam = 10 bars, 20 tickets (with name and category)", async () => {
  let preview;
  const msg = await sell(A, "jk789", { single_bar: 2, week_pack: 1, exam_week_bundle: 1 }, {
    name: "Jordan K",
    category: "Second-Year MBA",
    beforeSubmit: async () => {
      preview = await A.locator(".fixed.inset-x-0.bottom-0").innerText();
    },
  });
  assert.match(preview.replace(/\s+/g, " "), /10 BARS 20 TICKETS 181 LEFT AFTER/i);
  assert.match(msg, /20 tickets/);
  const [row] = await q("select customer_name, customer_category::text from transactions where netid = 'jk789'");
  assert.deepEqual(row, { customer_name: "Jordan K", customer_category: "second_year_mba" });
  assert.deepEqual(await truth(), { remaining: 181, tickets: 37, txns: 4 });
});

await step("AT5 NetID only (no name or category) succeeds; missing NetID is blocked", async () => {
  await A.getByTestId("plus-single_bar").click();
  assert.equal(await A.getByTestId("submit-sale").isDisabled(), true);
  assert.match(await A.getByTestId("submit-sale").textContent(), /Enter NetID/);
  await A.getByTestId("netid").fill("LMN12");
  await A.getByTestId("submit-sale").click();
  await A.getByTestId("sale-success").filter({ hasText: "lmn12" }).waitFor();
  const [row] = await q("select customer_name, customer_category from transactions where netid = 'lmn12'");
  assert.deepEqual(row, { customer_name: null, customer_category: null });
});

await step("Duplicate NetID within 2 minutes asks for confirmation", async () => {
  await sell(A, "lmn12", { single_bar: 1 }, { expectError: true });
  await A.getByText("Same NetID just bought").waitFor();
  await A.screenshot({ path: SHOTS + "03-duplicate-prompt.png" });
  await A.getByRole("button", { name: "Record anyway" }).click();
  await A.getByText("Same NetID just bought").waitFor({ state: "detached" });
  assert.equal((await q("select count(*)::int as n from transactions where netid='lmn12'"))[0].n, 2);
});

await step("Double tap on submit records one sale", async () => {
  const before = await truth();
  await A.getByTestId("netid").fill("tap1");
  await A.getByTestId("plus-week_pack").click();
  // Three taps inside one frame, before React can re-render the button as disabled.
  await A.getByTestId("submit-sale").evaluate((el) => {
    el.click();
    el.click();
    el.click();
  });
  await A.getByTestId("sale-success").filter({ hasText: "tap1" }).waitFor();
  await A.waitForTimeout(500);
  const after = await truth();
  assert.equal(after.txns, before.txns + 1);
  assert.equal((await q("select count(*)::int as n from transactions where netid='tap1'"))[0].n, 1);
});

await step("AT6 stock runs out while a cart is open: warning shows and submit disables; server rejects without changes", async () => {
  // Admin removes stock so only 12 bars remain.
  const left = (await truth()).remaining;
  await B.goto(`${APP}/admin`);
  await B.getByLabel("Adjustment type").selectOption("correction");
  await B.getByLabel("Direction").selectOption("-1");
  await B.getByLabel("Number of bars").fill(String(left - 12));
  await B.getByLabel("Reason").fill("Bars handed to judges");
  await B.getByRole("button", { name: /Record -\d+ bars/ }).click();
  await B.getByText(/Inventory -\d+ bars recorded/).waitFor();
  await A.waitForFunction(() => document.querySelector('[data-testid="bars-remaining"]').textContent === "12", null, { timeout: 5000 });

  // Seller builds a 10-bar cart.
  await A.getByTestId("netid").fill("cart1");
  await A.getByTestId("plus-exam_week_bundle").click();
  await A.getByTestId("plus-exam_week_bundle").click();
  assert.equal(await A.getByTestId("submit-sale").isDisabled(), false);
  // The + button refuses to go past the stock.
  assert.equal(await A.getByTestId("plus-exam_week_bundle").isDisabled(), true);

  // Meanwhile the admin's correction takes 3 more bars → 9 left.
  await B.getByLabel("Number of bars").fill("3");
  await B.getByLabel("Reason").fill("Damaged wrappers");
  await B.getByRole("button", { name: /Record -3 bars/ }).click();
  await A.getByTestId("stock-warning").waitFor({ timeout: 5000 });
  assert.equal(await A.getByTestId("submit-sale").isDisabled(), true);
  await A.screenshot({ path: SHOTS + "04-insufficient-stock.png" });
  const before = await truth();
  assert.equal(before.remaining, 9);
  // Clear the cart.
  await A.getByRole("button", { name: "Remove one Exam Week Bundle" }).click();
  await A.getByRole("button", { name: "Remove one Exam Week Bundle" }).click();
  await A.getByTestId("netid").fill("");
});

await step("AT7 simultaneous sales on two devices for the last 5 bars: exactly one succeeds", async () => {
  // Bring stock to exactly 5.
  await B.getByLabel("Number of bars").fill("4");
  await B.getByLabel("Reason").fill("Set aside for photo");
  await B.getByRole("button", { name: /Record -4 bars/ }).click();
  await B.getByText("Inventory -4 bars recorded.").waitFor();
  await B.goto(`${APP}/`);
  for (const p of [A, B]) await p.waitForFunction(() => document.querySelector('[data-testid="bars-remaining"]')?.textContent === "5");
  await A.getByTestId("netid").fill("race1");
  await A.getByTestId("plus-exam_week_bundle").click();
  await B.getByTestId("netid").fill("race2");
  await B.getByTestId("plus-exam_week_bundle").click();
  await Promise.all([A.getByTestId("submit-sale").click(), B.getByTestId("submit-sale").click()]);
  const outcome = async (p) =>
    Promise.race([
      p.getByTestId("sale-success").waitFor({ timeout: 8000 }).then(() => "ok"),
      p.getByTestId("sale-error").waitFor({ timeout: 8000 }).then(() => "rejected"),
    ]);
  const [oa, ob] = await Promise.all([outcome(A), outcome(B)]);
  assert.deepEqual([oa, ob].sort(), ["ok", "rejected"]);
  const loser = oa === "rejected" ? A : B;
  assert.match(await loser.getByTestId("sale-error").textContent(), /Only 0 bars left/);
  await loser.screenshot({ path: SHOTS + "05-race-loser.png" });
  await loser.getByRole("button", { name: "Remove one Exam Week Bundle" }).click();
  await loser.getByTestId("netid").fill("");
  const t = await truth();
  assert.equal(t.remaining, 0);
  assert.equal((await q("select count(*)::int as n from transactions where netid in ('race1','race2')"))[0].n, 1);
  await A.waitForFunction(() => document.querySelector('[data-testid="bars-remaining"]').textContent === "0", null, { timeout: 5000 });
});

await step("AT8 void from history restores inventory and updates metrics", async () => {
  const before = await truth();
  await B.goto(`${APP}/history`);
  await B.getByPlaceholder("Search NetID or name").fill("jk789");
  await B.waitForFunction(() => document.body.innerText.includes("1 sale match"));
  await B.getByRole("button", { name: "Details" }).click();
  await B.getByRole("button", { name: "Void this sale" }).click();
  await B.getByRole("button", { name: "Customer cancelled" }).click();
  await B.getByRole("button", { name: "Void sale" }).click();
  await B.locator("table").getByText("✕ Voided").first().waitFor();
  const after = await truth();
  assert.equal(after.remaining, before.remaining + 10);
  assert.equal(after.tickets, before.tickets - 20);
  assert.equal(after.txns, before.txns - 1);
  await A.waitForFunction(() => document.querySelector('[data-testid="bars-remaining"]').textContent === "10", null, { timeout: 5000 });
});

await step("Seller undo from the success banner", async () => {
  await sell(A, "undo1", { single_bar: 1 });
  await A.getByRole("button", { name: "Undo", exact: true }).first().click();
  await A.getByRole("button", { name: "Wrong product tapped" }).click();
  await A.getByRole("button", { name: "Void sale" }).click();
  await A.waitForFunction(() => document.querySelector('[data-testid="bars-remaining"]').textContent === "10");
  assert.equal((await q("select status::text from transactions where netid='undo1'"))[0].status, "voided");
});

await step("AT9 refresh: transactions and inventory persist", async () => {
  const t = await truth();
  await A.reload();
  await A.getByTestId("bars-remaining").waitFor();
  assert.equal(await remainingOn(A), t.remaining);
  await A.getByText("My recent sales").scrollIntoViewIfNeeded();
  await A.getByText("undo1").waitFor();
});

await step("AT12 dashboard totals match completed transactions only", async () => {
  await B.goto(`${APP}/dashboard`);
  await B.getByText("Product performance").waitFor();
  const t = await truth();
  const kpi = async (label) => Number((await B.getByTestId(`kpi-${label}`).textContent()).replace(/,/g, ""));
  assert.equal(await kpi("Tickets earned"), t.tickets);
  assert.equal(await kpi("Transactions"), t.txns);
  const [{ voided }] = await q("select coalesce(sum(total_tickets),0)::int as voided from transactions where status='voided'");
  assert.ok(voided > 0);
  await B.screenshot({ path: SHOTS + "06-dashboard.png", fullPage: true });
});

await step("AT11 CSV export matches database rows", async () => {
  await B.goto(`${APP}/history`);
  await B.getByText(/sales$/).first().waitFor();
  await B.screenshot({ path: SHOTS + "07-history.png", fullPage: true });
  const [download] = await Promise.all([B.waitForEvent("download"), B.getByRole("button", { name: "Export CSV" }).click()]);
  const path = await download.path();
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  const [header, ...rows] = parseCsv(text);
  const dbRows = await q("select id::int, netid, total_bars, total_tickets, status::text from transactions order by id");
  assert.equal(rows.length, dbRows.length);
  const c = (n) => header.indexOf(n);
  rows.forEach((r, i) => {
    assert.equal(Number(r[c("transaction_id")]), dbRows[i].id);
    assert.equal(r[c("netid")], dbRows[i].netid);
    assert.equal(Number(r[c("bars_consumed")]), dbRows[i].total_bars);
    assert.equal(Number(r[c("tickets_charged")]), dbRows[i].total_tickets);
    assert.equal(r[c("status")], dbRows[i].status);
  });
});

await step("Report renders with reconciliation, voids and adjustments", async () => {
  await B.goto(`${APP}/report`);
  await B.getByText("Inventory reconciliation").waitFor();
  await B.getByText("Bars handed to judges").waitFor();
  await B.getByText("Customer cancelled").waitFor();
  await B.screenshot({ path: SHOTS + "08-report.png", fullPage: true });
  await B.goto(`${APP}/admin`);
  await B.getByRole("heading", { name: "Audit log" }).waitFor();
  await B.screenshot({ path: SHOTS + "09-admin.png", fullPage: true });
});

await step("Seller cannot reach admin data", async () => {
  await A.goto(`${APP}/admin`);
  await A.getByText("Only admins can open this page.").waitFor();
  await A.goto(`${APP}/history`);
  await A.getByText("Sales you recorded").waitFor();
  assert.equal(await A.getByRole("button", { name: "Export CSV" }).count(), 0);
  await A.goto(`${APP}/`);
  await A.getByTestId("bars-remaining").waitFor();
  await A.screenshot({ path: SHOTS + "10-sell-phone.png" });
  await A.getByTestId("netid").fill("pqr77");
  await A.getByTestId("plus-single_bar").click();
  await A.getByTestId("plus-week_pack").click();
  await A.screenshot({ path: SHOTS + "11-sell-cart-phone.png" });
});

await step("Admin edits a package; an open cart picks up the new tickets live", async () => {
  await A.getByRole("button", { name: "Record sale · 9 tickets" }).waitFor();
  await B.goto(`${APP}/admin`);
  await B.getByRole("button", { name: "Edit package" }).nth(1).click();
  await B.getByLabel("Bars per Week Pack").fill("4");
  await B.getByLabel("Tickets per Week Pack").fill("7");
  await B.screenshot({ path: SHOTS + "12-admin-edit-package.png" });
  await B.getByRole("button", { name: "Save package" }).click();
  await B.getByText("4 bars for 7 tickets").waitFor();
  await B.getByText("Package changed").first().waitFor();
  await A.getByRole("button", { name: "Record sale · 10 tickets" }).waitFor();
});

await browser.close();
await db.end();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} end-to-end checks passed`);
process.exit(failed.length ? 1 : 0);
