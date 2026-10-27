// Test-only stand-in for the Supabase gateway, so the real Next.js app can run end to end
// against the real migrations on a local PostgreSQL. It implements just what the app uses:
//   - GoTrue: /auth/v1/signup, /auth/v1/token?grant_type=password|refresh_token, /auth/v1/user, /auth/v1/logout
//   - PostgREST: POST /rest/v1/rpc/<fn> (runs as role `authenticated` with request.jwt.claims, like PostgREST)
//   - Realtime: Phoenix websocket with postgres_changes on public.live_ticker (driven by LISTEN/NOTIFY)
// Not used in production.
import http from "node:http";
import crypto from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.MOCK_PORT ?? 54321);
const DB = process.env.TEST_DB ?? "bob_e2e";
const SECRET = "e2e-test-secret";
const base = { host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5433), user: process.env.PGUSER ?? "postgres" };
const root = new URL("../../", import.meta.url).pathname;

async function setup() {
  const a = new pg.Client({ ...base, database: "postgres" });
  await a.connect();
  await a.query(`drop database if exists ${DB} with (force)`);
  await a.query(`create database ${DB}`);
  await a.end();
  const c = new pg.Client({ ...base, database: DB });
  await c.connect();
  await c.query("set client_min_messages = error");
  await c.query(readFileSync(root + "tests/db/supabase-stub.sql", "utf8"));
  for (const f of readdirSync(root + "supabase/migrations").sort()) await c.query(readFileSync(root + "supabase/migrations/" + f, "utf8"));
  // Stands in for Supabase's WAL-based change feed.
  await c.query(`
    create table auth.mock_passwords (user_id uuid primary key, hash text not null);
    create or replace function public.mock_notify_ticker() returns trigger language plpgsql as $$
    begin perform pg_notify('live_ticker', row_to_json(new)::text); return new; end $$;
    create trigger mock_notify after update on public.live_ticker for each row execute function public.mock_notify_ticker();`);
  await c.end();
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");
function sign(payload) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
function verify(token) {
  if (!token) return null;
  const [h, b, s] = token.split(".");
  if (!s) return null;
  const expect = crypto.createHmac("sha256", SECRET).update(`${h}.${b}`).digest("base64url");
  if (expect !== s) return null;
  const claims = JSON.parse(Buffer.from(b, "base64url").toString());
  if (claims.exp * 1000 < Date.now()) return null;
  return claims;
}
const hash = (p) => crypto.createHash("sha256").update("salt:" + p).digest("hex");

let pool;
const refreshTokens = new Map();

function userJson(u) {
  return {
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email,
    user_metadata: u.raw_user_meta_data ?? {},
    app_metadata: { provider: "email" },
    created_at: u.created_at,
  };
}

function session(u) {
  const now = Math.floor(Date.now() / 1000);
  const access_token = sign({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600 });
  const refresh_token = crypto.randomBytes(16).toString("hex");
  refreshTokens.set(refresh_token, u.id);
  return { access_token, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token, user: userJson(u) };
}

function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

const readBody = (req) =>
  new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d ? JSON.parse(d) : {}));
  });

async function asUser(claims, sql, params) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${claims ? "authenticated" : "anon"}`);
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims ?? { role: "anon" })]);
    const r = await c.query(sql, params);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

async function handle(req, res) {
  if (req.method === "OPTIONS") return send(res, 204);
  const url = new URL(req.url, "http://x");
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer /i, "");
  const claims = verify(bearer);

  if (url.pathname === "/auth/v1/signup" && req.method === "POST") {
    const { email, password, data } = await readBody(req);
    const exists = await pool.query("select 1 from auth.users where email = $1", [email]);
    if (exists.rowCount) return send(res, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
    const { rows } = await pool.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning *", [email, data ?? {}]);
    await pool.query("insert into auth.mock_passwords values ($1, $2)", [rows[0].id, hash(password)]);
    return send(res, 200, session(rows[0]));
  }
  if (url.pathname === "/auth/v1/token" && req.method === "POST") {
    const body = await readBody(req);
    if (url.searchParams.get("grant_type") === "refresh_token") {
      const id = refreshTokens.get(body.refresh_token);
      if (!id) return send(res, 400, { error: "invalid_grant", error_description: "Invalid Refresh Token" });
      const { rows } = await pool.query("select * from auth.users where id = $1", [id]);
      return send(res, 200, session(rows[0]));
    }
    const { rows } = await pool.query(
      "select u.* from auth.users u join auth.mock_passwords p on p.user_id = u.id where u.email = $1 and p.hash = $2",
      [body.email, hash(body.password)]
    );
    if (!rows.length) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
    return send(res, 200, session(rows[0]));
  }
  if (url.pathname === "/auth/v1/user") {
    if (!claims) return send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
    const { rows } = await pool.query("select * from auth.users where id = $1", [claims.sub]);
    return send(res, 200, userJson(rows[0]));
  }
  if (url.pathname === "/auth/v1/logout") return send(res, 204);

  const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
  if (rpc && req.method === "POST") {
    if (bearer && !claims) return send(res, 401, { code: "PGRST301", message: "JWT expired", details: null, hint: null });
    const args = await readBody(req);
    const names = Object.keys(args);
    const values = names.map((n) => (args[n] === null ? null : typeof args[n] === "object" ? JSON.stringify(args[n]) : String(args[n])));
    const sql = `select public.${rpc[1]}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`;
    try {
      const r = await asUser(claims, sql, values);
      return send(res, 200, r.rows[0].r);
    } catch (e) {
      const status = /permission denied/.test(e.message) ? (claims ? 403 : 401) : 400;
      return send(res, status, { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
    }
  }
  send(res, 404, { message: "not found in mock" });
}

async function main() {
  await setup();
  pool = new pg.Pool({ ...base, database: DB, max: 30 });
  const server = http.createServer((req, res) => handle(req, res).catch((e) => send(res, 500, { message: e.message })));

  // Realtime (Phoenix protocol, serializer vsn 2.0.0: [join_ref, ref, topic, event, payload])
  const wss = new WebSocketServer({ server, path: "/realtime/v1/websocket" });
  const subs = new Set();
  wss.on("connection", (ws) => {
    let token = null;
    ws.on("message", async (raw) => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(raw.toString());
      const reply = (status, response = {}) => ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status, response }]));
      if (event === "heartbeat") return reply("ok");
      if (event === "access_token") {
        token = payload.access_token;
        for (const s of subs) if (s.ws === ws) s.token = token;
        return;
      }
      if (event === "phx_leave") {
        for (const s of subs) if (s.ws === ws && s.topic === topic) subs.delete(s);
        return reply("ok");
      }
      if (event === "phx_join") {
        token = payload.access_token ?? token;
        const changes = (payload.config?.postgres_changes ?? []).map((f, i) => ({ ...f, id: 1000 + i }));
        subs.add({ ws, topic, joinRef, token, ids: changes.map((c) => c.id) });
        reply("ok", { postgres_changes: changes });
        ws.send(JSON.stringify([joinRef, null, topic, "system", { status: "ok", extension: "postgres_changes", message: "Subscribed", channel: topic.replace("realtime:", "") }]));
      }
    });
    ws.on("close", () => {
      for (const s of subs) if (s.ws === ws) subs.delete(s);
    });
  });

  const listener = new pg.Client({ ...base, database: DB });
  await listener.connect();
  await listener.query("listen live_ticker");
  listener.on("notification", async (n) => {
    const record = JSON.parse(n.payload);
    for (const s of subs) {
      // Like Supabase, each change is checked against RLS for the subscriber's current token:
      // only approved team members may read live_ticker.
      const c = verify(s.token);
      const ok = c && (await asUser(c, "select count(*)::int as n from public.live_ticker", [])).rows[0].n > 0;
      if (!ok) continue;
      s.ws.send(
        JSON.stringify([
          s.joinRef,
          null,
          s.topic,
          "postgres_changes",
          { ids: s.ids, data: { type: "UPDATE", schema: "public", table: "live_ticker", commit_timestamp: new Date().toISOString(), record, old_record: {}, columns: [], errors: null } },
        ])
      );
    }
  });

  server.listen(PORT, () => console.log(`mock supabase on :${PORT} using database ${DB}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
