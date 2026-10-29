// Acceptance tests for the database layer (the 12 scenarios in the brief plus security checks).
// Runs the real migrations on a throwaway PostgreSQL database, with a small Supabase stub
// (auth.users, auth.uid(), anon/authenticated roles). Each call runs as the `authenticated`
// role with JWT claims set, exactly how PostgREST invokes the functions in Supabase.
//
//   PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres npm run test:db
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import pg from "pg";
import { transactionsToCsv, parseCsv } from "../../src/lib/csv.ts";

const DB = process.env.TEST_DB ?? "bob_accept";
const base = {
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? "postgres",
};
const root = new URL("../../", import.meta.url).pathname;

let pool;
const users = {};

async function setupDatabase() {
  const admin = new pg.Client({ ...base, database: "postgres" });
  await admin.connect();
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.query(`create database ${DB}`);
  await admin.end();
  const c = new pg.Client({ ...base, database: DB });
  await c.connect();
  await c.query("set client_min_messages = error");
  await c.query(readFileSync(root + "tests/db/supabase-stub.sql", "utf8"));
  for (const f of readdirSync(root + "supabase/migrations").sort()) {
    await c.query(readFileSync(root + "supabase/migrations/" + f, "utf8"));
  }
  await c.end();
}

function makePool() {
  return new pg.Pool({ ...base, database: DB, max: 40 });
}

// Run one RPC as a signed-in user (or anonymously when uid is null).
async function rpc(uid, fn, args = {}) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${uid ? "authenticated" : "anon"}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(uid ? { sub: uid, role: "authenticated" } : { role: "anon" }),
    ]);
    const names = Object.keys(args);
    const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`;
    const res = await client.query(sql, names.map((n) => args[n]));
    await client.query("commit");
    return res.rows[0].r;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function asUser(uid, sql, params = []) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
    const res = await client.query(sql, params);
    await client.query("commit");
    return res.rows;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function superQuery(sql, params = []) {
  return (await pool.query(sql, params)).rows;
}

async function signUp(email, name) {
  const [row] = await superQuery(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify({ display_name: name })]
  );
  return row.id;
}

const sale = (uid, netid, items, extra = {}) =>
  rpc(uid, "record_sale", {
    p_client_request_id: extra.requestId ?? randomUUID(),
    p_netid: netid,
    p_items: JSON.stringify(items),
    p_customer_name: extra.name ?? null,
    p_customer_category: extra.category ?? null,
    p_confirm_duplicate: extra.confirm ?? false,
  });

const remaining = async () => (await rpc(users.admin, "get_live_state")).inventory.remaining;

async function rejects(promise, code) {
  await assert.rejects(promise, (e) => {
    assert.equal(e.message, code, `expected ${code}, got ${e.message}: ${e.detail ?? ""}`);
    return true;
  });
}

// Ground truth straight from the tables, bypassing the app's functions.
async function truth() {
  const [r] = await superQuery(`
    select
      (select initial_inventory from event_settings) as initial,
      (select coalesce(sum(delta),0)::int from inventory_adjustments) as adj,
      (select coalesce(sum(total_bars),0)::int from transactions where status='completed') as bars,
      (select coalesce(sum(total_tickets),0)::int from transactions where status='completed') as tickets,
      (select count(*)::int from transactions where status='completed') as txns,
      (select coalesce(sum(i.bars),0)::int from transaction_items i join transactions t on t.id=i.transaction_id where t.status='completed') as item_bars,
      (select coalesce(sum(i.tickets),0)::int from transaction_items i join transactions t on t.id=i.transaction_id where t.status='completed') as item_tickets`);
  return { ...r, remaining: r.initial + r.adj - r.bars };
}

before(async () => {
  await setupDatabase();
  pool = makePool();
  users.admin = await signUp("admin@example.com", "Ana Admin");
  users.seller1 = await signUp("s1@example.com", "Sam Seller");
  users.seller2 = await signUp("s2@example.com", "Kim Seller");
  users.pending = await signUp("p@example.com", "Pat Pending");
});

after(async () => {
  await pool?.end();
});

test("first sign-up becomes admin, later ones wait for approval", async () => {
  assert.equal((await rpc(users.admin, "get_my_profile")).role, "admin");
  assert.equal((await rpc(users.seller1, "get_my_profile")).role, "pending");
  await rejects(sale(users.seller1, "ab1", { single_bar: 1 }), "NOT_AUTHORIZED");
  await rpc(users.admin, "set_member_role", { p_user_id: users.seller1, p_role: "seller" });
  await rpc(users.admin, "set_member_role", { p_user_id: users.seller2, p_role: "seller" });
  assert.equal((await rpc(users.seller1, "get_my_profile")).role, "seller");
});

test("seeded configuration: 200 bars, three products, no sales", async () => {
  const s = await rpc(users.seller1, "get_live_state");
  assert.equal(s.inventory.initial, 200);
  assert.equal(s.inventory.remaining, 200);
  assert.equal(s.inventory.transactions, 0);
  assert.deepEqual(
    s.products.map((p) => [p.name, p.bars_per_unit, p.tickets_per_unit]),
    [["Single Bar", 1, 3], ["Week Pack", 3, 6], ["Exam Week Bundle", 5, 8]]
  );
});

test("admin can set initial inventory before sales start", async () => {
  await rejects(rpc(users.seller1, "set_initial_inventory", { p_value: 150 }), "NOT_AUTHORIZED");
  await rpc(users.admin, "set_initial_inventory", { p_value: 150 });
  assert.equal(await remaining(), 150);
  await rpc(users.admin, "set_initial_inventory", { p_value: 200 });
  assert.equal(await remaining(), 200);
});

test("AT1 Single Bar: 200 -> 199 and 3 tickets", async () => {
  const r = await sale(users.seller1, "abc123", { single_bar: 1 });
  assert.equal(r.transaction.total_bars, 1);
  assert.equal(r.transaction.total_tickets, 3);
  assert.equal(r.inventory.remaining, 199);
  assert.equal(await remaining(), 199);
});

test("AT2 Week Pack: -3 bars and 6 tickets", async () => {
  const before = await remaining();
  const r = await sale(users.seller1, "def45", { week_pack: 1 });
  assert.equal(r.transaction.total_bars, 3);
  assert.equal(r.transaction.total_tickets, 6);
  assert.equal(await remaining(), before - 3);
});

test("AT3 Exam Week Bundle: -5 bars and 8 tickets", async () => {
  const before = await remaining();
  const r = await sale(users.seller2, "ghi6", { exam_week_bundle: 1 });
  assert.equal(r.transaction.total_bars, 5);
  assert.equal(r.transaction.total_tickets, 8);
  assert.equal(await remaining(), before - 5);
});

test("AT4 mixed transaction: 2 singles + 1 week + 1 exam = 10 bars, 20 tickets", async () => {
  const before = await remaining();
  const r = await sale(users.seller2, "jk789", { single_bar: 2, week_pack: 1, exam_week_bundle: 1 }, {
    name: "Jordan K", category: "second_year_mba",
  });
  assert.equal(r.transaction.total_bars, 2 * 1 + 1 * 3 + 1 * 5);
  assert.equal(r.transaction.total_tickets, 2 * 3 + 1 * 6 + 1 * 8);
  assert.deepEqual(r.transaction.items, { single_bar: 2, week_pack: 1, exam_week_bundle: 1 });
  assert.equal(await remaining(), before - 10);
});

test("AT5 sale without name or category succeeds with only a NetID", async () => {
  const r = await sale(users.seller1, "  LMN12@cornell.edu ", { single_bar: 1 });
  assert.equal(r.transaction.netid, "lmn12");
  assert.equal(r.transaction.customer_name, null);
  assert.equal(r.transaction.customer_category, null);
});

test("validation: NetID required, at least one product, whole quantities, known products", async () => {
  await rejects(sale(users.seller1, "", { single_bar: 1 }), "INVALID_NETID");
  await rejects(sale(users.seller1, "not a netid!", { single_bar: 1 }), "INVALID_NETID");
  await rejects(sale(users.seller1, "zz1", {}), "EMPTY_SALE");
  await rejects(sale(users.seller1, "zz1", { single_bar: 0, week_pack: 0 }), "EMPTY_SALE");
  await rejects(sale(users.seller1, "zz1", { single_bar: -1 }), "INVALID_QUANTITY");
  await rejects(sale(users.seller1, "zz1", { single_bar: 1.5 }), "INVALID_QUANTITY");
  await rejects(sale(users.seller1, "zz1", { single_bar: "2" }), "INVALID_QUANTITY");
  await rejects(sale(users.seller1, "zz1", { mystery_box: 1 }), "UNKNOWN_PRODUCT");
  await rejects(sale(users.seller1, "zz1", { single_bar: 1 }, { category: "alumni" }), "INVALID_CATEGORY");
});

test("AT6 sale exceeding inventory is rejected and changes nothing", async () => {
  const before = await truth();
  await rejects(sale(users.seller1, "big1", { exam_week_bundle: 100 }), "INSUFFICIENT_STOCK");
  assert.deepEqual(await truth(), before);
});

test("same NetID twice within the window needs confirmation", async () => {
  await sale(users.seller1, "dup1", { single_bar: 1 });
  await assert.rejects(sale(users.seller2, "dup1", { single_bar: 1 }), (e) => {
    assert.equal(e.message, "POSSIBLE_DUPLICATE");
    assert.ok(JSON.parse(e.detail).transaction_id > 0);
    return true;
  });
  const r = await sale(users.seller2, "dup1", { single_bar: 1 }, { confirm: true });
  assert.equal(r.transaction.netid, "dup1");
});

test("double tap / network retry with the same request id records one sale", async () => {
  const before = await truth();
  const requestId = randomUUID();
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () => sale(users.seller1, "tap1", { week_pack: 1 }, { requestId }))
  );
  assert.ok(results.every((r) => r.status === "fulfilled"), JSON.stringify(results.filter((r) => r.status === "rejected").map((r) => r.reason.message)));
  const ids = new Set(results.map((r) => r.value.transaction.id));
  assert.equal(ids.size, 1);
  assert.equal(results.filter((r) => !r.value.duplicate_request).length, 1);
  const after = await truth();
  assert.equal(after.bars, before.bars + 3);
  assert.equal(after.txns, before.txns + 1);
});

test("AT7 concurrent sales from two sellers never oversell", async () => {
  const start = await remaining();
  // 60 concurrent Exam Week Bundles (300 bars) against what's left.
  const attempts = Array.from({ length: 60 }, (_, i) =>
    sale(i % 2 ? users.seller1 : users.seller2, `rc${i}`, { exam_week_bundle: 1 })
  );
  const results = await Promise.allSettled(attempts);
  const ok = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected");
  assert.ok(failed.every((r) => r.reason.message === "INSUFFICIENT_STOCK"), "only stock errors expected");
  assert.equal(ok, Math.floor(start / 5));
  const t = await truth();
  assert.equal(t.remaining, start - ok * 5);
  assert.ok(t.remaining >= 0 && t.remaining < 5);
  assert.equal(t.bars, t.item_bars);
  assert.equal(t.tickets, t.item_tickets);
  console.log(`    concurrency: start=${start}, attempts=60, succeeded=${ok}, rejected=${failed.length}, remaining=${t.remaining}`);
});

test("inventory can never go below zero through sales or adjustments", async () => {
  const left = await remaining();
  await rejects(sale(users.seller1, "last1", { single_bar: left + 1 }), "INSUFFICIENT_STOCK");
  await rejects(rpc(users.admin, "adjust_inventory", { p_kind: "correction", p_delta: -(left + 1), p_reason: "count" }), "NEGATIVE_INVENTORY");
  assert.equal(await remaining(), left);
});

test("admin restock and correction are audited and feed the inventory formula", async () => {
  const before = await truth();
  await rejects(rpc(users.seller1, "adjust_inventory", { p_kind: "restock", p_delta: 10, p_reason: "box" }), "NOT_AUTHORIZED");
  await rejects(rpc(users.admin, "adjust_inventory", { p_kind: "restock", p_delta: 10, p_reason: "" }), "REASON_REQUIRED");
  await rpc(users.admin, "adjust_inventory", { p_kind: "restock", p_delta: 20, p_reason: "Found a second box" });
  await rpc(users.admin, "adjust_inventory", { p_kind: "correction", p_delta: -2, p_reason: "Two bars damaged" });
  const s = (await rpc(users.admin, "get_live_state")).inventory;
  assert.equal(s.adjustments_in, 20);
  assert.equal(s.adjustments_out, 2);
  // Remaining = Initial + positive adjustments − bars sold − negative adjustments
  assert.equal(s.remaining, s.initial + 20 - s.bars_sold - 2);
  assert.equal(s.remaining, before.remaining + 18);
  const audit = await superQuery("select count(*)::int as n from audit_log where action = 'inventory_adjusted'");
  assert.equal(audit[0].n, 2);
  await rejects(rpc(users.admin, "set_initial_inventory", { p_value: 300 }), "SALES_STARTED");
});

test("AT8 voiding restores inventory and metrics", async () => {
  const r = await sale(users.seller2, "void1", { exam_week_bundle: 2 });
  const before = await rpc(users.admin, "get_dashboard");
  await rejects(rpc(users.admin, "void_transaction", { p_transaction_id: r.transaction.id, p_reason: "" }), "REASON_REQUIRED");
  await rejects(rpc(users.seller1, "void_transaction", { p_transaction_id: r.transaction.id, p_reason: "not mine" }), "NOT_AUTHORIZED");
  await rpc(users.admin, "void_transaction", { p_transaction_id: r.transaction.id, p_reason: "Customer changed mind" });
  await rejects(rpc(users.admin, "void_transaction", { p_transaction_id: r.transaction.id, p_reason: "again" }), "ALREADY_VOIDED");
  const after = await rpc(users.admin, "get_dashboard");
  assert.equal(after.inventory.remaining, before.inventory.remaining + 10);
  assert.equal(after.kpis.total_tickets, before.kpis.total_tickets - 16);
  assert.equal(after.kpis.transactions, before.kpis.transactions - 1);
  const exam = (d) => d.products.find((p) => p.id === "exam_week_bundle");
  assert.equal(exam(after).packages_sold, exam(before).packages_sold - 2);
  assert.equal(after.voided.count, before.voided.count + 1);
});

test("sellers can undo their own recent sale; the window is enforced", async () => {
  const r = await sale(users.seller1, "undo1", { single_bar: 1 });
  const v = await rpc(users.seller1, "void_transaction", { p_transaction_id: r.transaction.id, p_reason: "Wrong product tapped" });
  assert.equal(v.transaction.status, "voided");
  const old = await sale(users.seller1, "undo2", { single_bar: 1 });
  await superQuery("update transactions set created_at = now() - interval '10 minutes' where id = $1", [old.transaction.id]);
  await rejects(rpc(users.seller1, "void_transaction", { p_transaction_id: old.transaction.id, p_reason: "late" }), "NOT_AUTHORIZED");
});

test("AT12 voided transactions never inflate totals", async () => {
  const d = await rpc(users.admin, "get_dashboard");
  const t = await truth();
  assert.equal(d.kpis.total_bars, t.bars);
  assert.equal(d.kpis.total_tickets, t.tickets);
  assert.equal(d.kpis.transactions, t.txns);
  assert.equal(d.inventory.remaining, t.remaining);
  const [all] = await superQuery("select sum(total_tickets)::int as t from transactions");
  assert.ok(all.t > t.tickets, "there are voided tickets in the table");
  // Per-product and per-category figures reconcile to the totals.
  assert.equal(d.products.reduce((s, p) => s + p.bars_sold, 0), d.kpis.total_bars);
  assert.equal(d.products.reduce((s, p) => s + p.tickets, 0), d.kpis.total_tickets);
  assert.equal(d.categories.reduce((s, c) => s + c.customers, 0), d.kpis.unique_customers);
  assert.equal(d.categories.reduce((s, c) => s + c.tickets, 0), d.kpis.total_tickets);
  assert.equal(d.categories.reduce((s, c) => s + c.transactions, 0), d.kpis.transactions);
  assert.equal(d.timeline.reduce((s, b) => s + b.tickets, 0), d.kpis.total_tickets);
  assert.equal(d.categories.length, 5);
  assert.equal(d.categories.find((c) => c.category === "second_year_mba").customers, 1);
});

test("AT11 CSV export matches the database records", async () => {
  await rejects(rpc(users.seller1, "export_transactions"), "NOT_AUTHORIZED");
  const rows = await rpc(users.admin, "export_transactions");
  const state = await rpc(users.admin, "get_live_state");
  const csv = transactionsToCsv(rows, state.products, "America/New_York");
  const parsed = parseCsv(csv);
  const [header, ...body] = parsed;
  const db = await superQuery("select id, netid, total_bars, total_tickets, status::text from transactions order by id");
  assert.equal(body.length, db.length);
  const col = (name) => header.indexOf(name);
  body.forEach((r, i) => {
    assert.equal(Number(r[col("transaction_id")]), Number(db[i].id));
    assert.equal(r[col("netid")], db[i].netid);
    assert.equal(Number(r[col("bars_consumed")]), db[i].total_bars);
    assert.equal(Number(r[col("tickets_charged")]), db[i].total_tickets);
    assert.equal(r[col("status")], db[i].status);
    const bars = Number(r[col("Single Bar (packages)")]) * 1 + Number(r[col("Week Pack (packages)")]) * 3 + Number(r[col("Exam Week Bundle (packages)")]) * 5;
    assert.equal(bars, db[i].total_bars);
  });
  const completedTickets = body.filter((r) => r[col("status")] === "completed").reduce((s, r) => s + Number(r[col("tickets_charged")]), 0);
  assert.equal(completedTickets, (await truth()).tickets);
});

test("history search and filters; sellers only see their own sales", async () => {
  const byNetid = await rpc(users.admin, "list_transactions", { p_search: "jk7" });
  assert.equal(byNetid.total, 1);
  const byName = await rpc(users.admin, "list_transactions", { p_search: "jordan" });
  assert.equal(byName.rows[0].netid, "jk789");
  const voided = await rpc(users.admin, "list_transactions", { p_status: "voided" });
  assert.ok(voided.rows.every((r) => r.status === "voided") && voided.total >= 2);
  const week = await rpc(users.admin, "list_transactions", { p_product: "week_pack", p_limit: 500 });
  assert.ok(week.rows.every((r) => r.items.week_pack > 0));
  const cat = await rpc(users.admin, "list_transactions", { p_category: "not_specified", p_limit: 500 });
  assert.ok(cat.rows.every((r) => r.customer_category === null));
  const mine = await rpc(users.seller1, "list_transactions", { p_seller: users.seller2, p_limit: 500 });
  assert.ok(mine.rows.length > 0 && mine.rows.every((r) => r.seller_id === users.seller1));
  const all = await rpc(users.admin, "list_transactions", { p_limit: 500 });
  const sorted = [...all.rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  assert.deepEqual(all.rows.map((r) => r.id), sorted.map((r) => r.id));
});

test("row level security: no direct writes, no cross-seller reads, no anonymous access", async () => {
  await assert.rejects(asUser(users.seller1, "insert into transactions (client_request_id, seller_id, netid, total_bars, total_tickets) values (gen_random_uuid(), auth.uid(), 'x1', 1, 3)"));
  await assert.rejects(asUser(users.admin, "update event_settings set initial_inventory = 999"));
  await assert.rejects(asUser(users.admin, "delete from transactions"));
  const visible = await asUser(users.seller1, "select distinct seller_id from transactions");
  assert.deepEqual(visible.map((r) => r.seller_id), [users.seller1]);
  assert.equal((await asUser(users.pending, "select * from transactions")).length, 0);
  assert.equal((await asUser(users.pending, "select * from live_ticker")).length, 0);
  assert.equal((await asUser(users.seller1, "select * from audit_log")).length, 0);
  await assert.rejects(rpc(null, "get_live_state"), /permission denied/);
  await assert.rejects(rpc(null, "record_sale", { p_client_request_id: randomUUID(), p_netid: "a1", p_items: '{"single_bar":1}' }), /permission denied/);
  await rejects(rpc(users.pending, "get_dashboard"), "NOT_AUTHORIZED");
  await rejects(rpc(users.seller1, "get_admin_state"), "NOT_AUTHORIZED");
  await rejects(rpc(users.admin, "set_member_role", { p_user_id: users.admin, p_role: "seller" }), "LAST_ADMIN");
});

test("AT10 realtime signal: every write bumps the published ticker", async () => {
  const v0 = (await rpc(users.seller2, "get_live_state")).version;
  await sale(users.seller1, "rt1", { single_bar: 1 }).catch(async (e) => {
    // Stock may be exhausted by the concurrency test; restock one bar and retry.
    if (e.message !== "INSUFFICIENT_STOCK") throw e;
    await rpc(users.admin, "adjust_inventory", { p_kind: "restock", p_delta: 1, p_reason: "realtime test" });
    await sale(users.seller1, "rt1", { single_bar: 1 });
  });
  const v1 = (await rpc(users.seller2, "get_live_state")).version;
  assert.ok(v1 > v0, `version ${v0} -> ${v1}`);
  const pub = await superQuery("select tablename from pg_publication_tables where pubname = 'supabase_realtime'");
  assert.deepEqual(pub.map((r) => r.tablename), ["live_ticker"]);
  assert.equal((await asUser(users.seller2, "select version from live_ticker")).length, 1);
});

test("product availability blocks sales of that product only", async () => {
  await rpc(users.admin, "adjust_inventory", { p_kind: "restock", p_delta: 10, p_reason: "availability test" });
  await rpc(users.admin, "set_product_active", { p_product_id: "week_pack", p_active: false });
  await rejects(sale(users.seller1, "av1", { week_pack: 1 }), "PRODUCT_UNAVAILABLE");
  await sale(users.seller1, "av1", { single_bar: 1 });
  await rpc(users.admin, "set_product_active", { p_product_id: "week_pack", p_active: true });
});

test("admins change package bars and tickets; past sales keep their recorded values", async () => {
  await rpc(users.admin, "adjust_inventory", { p_kind: "restock", p_delta: 10, p_reason: "package test" });
  const before = await sale(users.seller1, "pk1", { week_pack: 1 });
  assert.equal(before.transaction.total_bars, 3);
  assert.equal(before.transaction.total_tickets, 6);

  await rejects(rpc(users.seller1, "set_product_package", { p_product_id: "week_pack", p_bars: 4, p_tickets: 7 }), "NOT_AUTHORIZED");
  await rejects(rpc(users.admin, "set_product_package", { p_product_id: "week_pack", p_bars: 0, p_tickets: 7 }), "INVALID_PACKAGE");
  await rejects(rpc(users.admin, "set_product_package", { p_product_id: "week_pack", p_bars: 4, p_tickets: 0 }), "INVALID_PACKAGE");
  await rejects(rpc(users.admin, "set_product_package", { p_product_id: "nope", p_bars: 4, p_tickets: 7 }), "NOT_FOUND");

  const changed = await rpc(users.admin, "set_product_package", { p_product_id: "week_pack", p_bars: 4, p_tickets: 7 });
  assert.equal(changed.changed, true);
  const live = await rpc(users.seller1, "get_live_state");
  const wp = live.products.find((p) => p.id === "week_pack");
  assert.deepEqual([wp.bars_per_unit, wp.tickets_per_unit, wp.tagline], [4, 7, "4 protein bars"]);

  const after = await sale(users.seller1, "pk1", { week_pack: 1 }, { confirm: true });
  assert.equal(after.transaction.total_bars, 4);
  assert.equal(after.transaction.total_tickets, 7);

  const items = await superQuery(
    "select transaction_id, bars, tickets from transaction_items where transaction_id = any($1) order by transaction_id",
    [[before.transaction.id, after.transaction.id]]
  );
  assert.deepEqual(items.map((i) => [i.bars, i.tickets]), [[3, 6], [4, 7]]);
  const [t] = await superQuery("select total_bars, total_tickets from transactions where id = $1", [before.transaction.id]);
  assert.deepEqual([t.total_bars, t.total_tickets], [3, 6]);
  const hist = await rpc(users.admin, "export_transactions");
  assert.deepEqual(hist.find((r) => r.id === before.transaction.id).item_units, { week_pack: { bars: 3, tickets: 6 } });
  assert.deepEqual(hist.find((r) => r.id === after.transaction.id).item_units, { week_pack: { bars: 4, tickets: 7 } });

  const [log] = await superQuery("select details from audit_log where action = 'product_package_changed' order by id desc limit 1");
  assert.deepEqual(log.details, { name: "Week Pack", bars_from: 3, bars_to: 4, tickets_from: 6, tickets_to: 7 });

  assert.equal((await rpc(users.admin, "set_product_package", { p_product_id: "week_pack", p_bars: 3, p_tickets: 6 })).changed, true);
  assert.equal((await rpc(users.admin, "set_product_package", { p_product_id: "week_pack", p_bars: 3, p_tickets: 6 })).changed, false);
});

test("AT9 data persists across a database restart", async () => {
  if (!process.env.PG_RESTART_CMD) {
    console.log("    skipped restart (set PG_RESTART_CMD to run it)");
    return;
  }
  const before = await truth();
  await pool.end();
  execSync(process.env.PG_RESTART_CMD, { stdio: "ignore" });
  pool = makePool();
  assert.deepEqual(await truth(), before);
  assert.equal((await rpc(users.admin, "get_live_state")).inventory.remaining, before.remaining);
});

test("reset clears rehearsal sales but keeps configuration and audit trail", async () => {
  await rejects(rpc(users.admin, "reset_event_data", { p_confirmation: "yes" }), "CONFIRMATION_REQUIRED");
  await rejects(rpc(users.seller1, "reset_event_data", { p_confirmation: "RESET ALL SALES" }), "NOT_AUTHORIZED");
  const inv = await rpc(users.admin, "reset_event_data", { p_confirmation: "RESET ALL SALES" });
  assert.equal(inv.remaining, inv.initial);
  assert.equal(inv.transactions, 0);
  const [{ n }] = await superQuery("select count(*)::int as n from audit_log where action = 'event_data_reset'");
  assert.equal(n, 1);
  await rpc(users.admin, "set_initial_inventory", { p_value: 200 });
});
