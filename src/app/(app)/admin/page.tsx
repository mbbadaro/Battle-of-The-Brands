"use client";

import { useState } from "react";
import { callRpc, useLive, useRpc } from "@/hooks/live";
import { useProfile } from "@/hooks/profile";
import type { AdminState, LiveState, Role } from "@/lib/types";
import type { AppError } from "@/lib/errors";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { productColor } from "@/lib/labels";
import { Button, Card, LoadingBlock, Notice, SectionTitle, Spinner, inputClass, selectClass } from "@/components/ui";
import { PageHero } from "@/components/brand";

function useAction() {
  const { refreshAll } = useLive();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  async function run(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await callRpc(fn, args);
      setMsg({ tone: "good", text: ok });
      refreshAll();
      return true;
    } catch (e) {
      setMsg({ tone: "bad", text: (e as AppError).message });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, msg, run };
}

const ACTION_LABELS: Record<string, string> = {
  user_signed_up: "Account created",
  member_role_changed: "Role changed",
  initial_inventory_set: "Initial inventory set",
  inventory_adjusted: "Inventory adjusted",
  product_availability_changed: "Product availability changed",
  product_package_changed: "Package changed",
  transaction_voided: "Sale voided",
  event_data_reset: "Sales data reset",
};

function InventorySetup({ live }: { live: LiveState }) {
  const [value, setValue] = useState(String(live.settings.initial_inventory));
  const action = useAction();
  const started = !!live.settings.sales_started_at;
  return (
    <Card>
      <SectionTitle>Initial inventory</SectionTitle>
      {started ? (
        <p className="text-sm text-muted">
          Locked at <b className="text-navy">{fmtInt(live.settings.initial_inventory)} bars</b> because sales started{" "}
          {fmtDateTime(live.settings.sales_started_at, live.settings.timezone)}. Use an adjustment below to add or remove bars.
        </p>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            action.run("set_initial_inventory", { p_value: Number(value) }, `Initial inventory set to ${value} bars.`);
          }}
        >
          <input className={inputClass} type="number" inputMode="numeric" min={0} max={100000} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Initial inventory in bars" />
          <Button type="submit" disabled={action.busy || value === "" || Number(value) < 0}>
            {action.busy && <Spinner />} Save
          </Button>
        </form>
      )}
      {action.msg && (
        <div className="mt-2">
          <Notice tone={action.msg.tone}>{action.msg.text}</Notice>
        </div>
      )}
    </Card>
  );
}

function AdjustmentForm() {
  const [kind, setKind] = useState<"restock" | "correction">("restock");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<1 | -1>(-1);
  const [reason, setReason] = useState("");
  const action = useAction();
  const n = Math.abs(Math.trunc(Number(amount) || 0));
  const delta = kind === "restock" ? n : direction * n;
  return (
    <Card>
      <SectionTitle>Adjust inventory</SectionTitle>
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await action.run("adjust_inventory", { p_kind: kind, p_delta: delta, p_reason: reason.trim() }, `Inventory ${delta > 0 ? "+" : ""}${delta} bars recorded.`);
          if (ok) {
            setAmount("");
            setReason("");
          }
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <select className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as "restock" | "correction")} aria-label="Adjustment type">
            <option value="restock">Restock (add bars)</option>
            <option value="correction">Correction (count fix)</option>
          </select>
          {kind === "correction" ? (
            <select className={selectClass} value={direction} onChange={(e) => setDirection(Number(e.target.value) as 1 | -1)} aria-label="Direction">
              <option value={-1}>Remove bars</option>
              <option value={1}>Add bars</option>
            </select>
          ) : (
            <div />
          )}
        </div>
        <input className={inputClass} type="number" inputMode="numeric" min={1} placeholder="Number of bars" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Number of bars" />
        <input className={inputClass} placeholder="Reason (required), e.g. 2 bars damaged" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} aria-label="Reason" />
        <Button type="submit" className="w-full" disabled={action.busy || n === 0 || reason.trim().length < 3}>
          {action.busy && <Spinner />} Record {delta > 0 ? "+" : ""}
          {delta} bars
        </Button>
        {action.msg && <Notice tone={action.msg.tone}>{action.msg.text}</Notice>}
      </form>
    </Card>
  );
}

function PackageEditor({ product, onDone }: { product: LiveState["products"][number]; onDone: () => void }) {
  const [bars, setBars] = useState(String(product.bars_per_unit));
  const [tickets, setTickets] = useState(String(product.tickets_per_unit));
  const action = useAction();
  const b = Number(bars);
  const t = Number(tickets);
  const valid = Number.isInteger(b) && b >= 1 && b <= 100 && Number.isInteger(t) && t >= 1 && t <= 10000;
  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await action.run("set_product_package", { p_product_id: product.id, p_bars: b, p_tickets: t }, `${product.name} is now ${b} bar${b > 1 ? "s" : ""} for ${t} tickets.`)) onDone();
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-bold text-muted">
          Bars per package
          <input className={inputClass} type="number" inputMode="numeric" min={1} max={100} value={bars} onChange={(e) => setBars(e.target.value)} aria-label={`Bars per ${product.name}`} />
        </label>
        <label className="text-xs font-bold text-muted">
          Tickets per package
          <input className={inputClass} type="number" inputMode="numeric" min={1} max={10000} value={tickets} onChange={(e) => setTickets(e.target.value)} aria-label={`Tickets per ${product.name}`} />
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={action.busy || !valid}>
          {action.busy && <Spinner />} Save package
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} disabled={action.busy}>
          Cancel
        </Button>
      </div>
      {action.msg?.tone === "bad" && <Notice tone="bad">{action.msg.text}</Notice>}
    </form>
  );
}

function ProductsCard({ live }: { live: LiveState }) {
  const action = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <Card>
      <SectionTitle>Products</SectionTitle>
      <ul className="divide-y divide-line">
        {live.products.map((p) => (
          <li key={p.id} className="py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 font-bold text-navy">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: productColor(p.id) }} />
                  {p.name}
                </div>
                <div className="text-xs text-muted">
                  {p.bars_per_unit} bar{p.bars_per_unit > 1 ? "s" : ""} for {p.tickets_per_unit} tickets · {fmtInt(p.packages_sold)} sold
                  {editing !== p.id && (
                    <>
                      {" · "}
                      <button type="button" className="font-bold text-blue underline" onClick={() => setEditing(p.id)}>
                        Edit package
                      </button>
                    </>
                  )}
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm font-bold">
                <span className={p.active ? "text-good" : "text-bad"}>{p.active ? "Available" : "Unavailable"}</span>
                <input
                  type="checkbox"
                  className="h-6 w-6 accent-[#1e6bff]"
                  checked={p.active}
                  disabled={action.busy}
                  onChange={(e) => action.run("set_product_active", { p_product_id: p.id, p_active: e.target.checked }, `${p.name} updated.`)}
                />
              </label>
            </div>
            {editing === p.id && <PackageEditor product={p} onDone={() => setEditing(null)} />}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">A new package size applies to sales from now on. Past sales keep the bars and tickets they were recorded with.</p>
      {action.msg?.tone === "bad" && <Notice tone="bad">{action.msg.text}</Notice>}
    </Card>
  );
}

function TeamCard({ state, meId }: { state: AdminState; meId: string }) {
  const action = useAction();
  const pending = state.members.filter((m) => m.role === "pending").length;
  return (
    <Card>
      <SectionTitle aside={pending ? <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-black text-warn">{pending} waiting</span> : null}>
        Team
      </SectionTitle>
      <ul className="divide-y divide-line">
        {state.members.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate font-bold text-navy">
                {m.display_name} {m.id === meId && <span className="text-xs text-muted">(you)</span>}
              </div>
              <div className="truncate text-xs text-muted">
                {m.email} · {fmtInt(m.sales)} sales
              </div>
            </div>
            {m.role === "pending" ? (
              <Button className="shrink-0 px-3 py-2" disabled={action.busy} onClick={() => action.run("set_member_role", { p_user_id: m.id, p_role: "seller" }, `${m.display_name} approved as seller.`)}>
                Approve
              </Button>
            ) : (
              <select
                className={`${selectClass} !w-36 shrink-0 py-2 text-sm`}
                value={m.role}
                disabled={action.busy}
                onChange={(e) => action.run("set_member_role", { p_user_id: m.id, p_role: e.target.value as Role }, `${m.display_name} is now ${e.target.value}.`)}
                aria-label={`Role for ${m.display_name}`}
              >
                <option value="seller">Seller</option>
                <option value="admin">Admin</option>
                <option value="pending">Remove access</option>
              </select>
            )}
          </li>
        ))}
      </ul>
      {action.msg && (
        <div className="mt-2">
          <Notice tone={action.msg.tone}>{action.msg.text}</Notice>
        </div>
      )}
    </Card>
  );
}

function ResetCard() {
  const [text, setText] = useState("");
  const action = useAction();
  return (
    <Card className="border-bad/40">
      <SectionTitle>Reset rehearsal data</SectionTitle>
      <p className="text-sm text-muted">
        Deletes every sale and adjustment so the real event starts from zero. Products, team and the audit log are kept. Use this once, after practice
        runs and before the first real sale.
      </p>
      <div className="mt-2 flex gap-2">
        <input className={inputClass} placeholder="Type RESET ALL SALES" value={text} onChange={(e) => setText(e.target.value)} aria-label="Confirmation" />
        <Button
          variant="danger"
          disabled={action.busy || text !== "RESET ALL SALES"}
          onClick={async () => {
            if (await action.run("reset_event_data", { p_confirmation: text }, "All sales and adjustments were deleted.")) setText("");
          }}
        >
          Reset
        </Button>
      </div>
      {action.msg && (
        <div className="mt-2">
          <Notice tone={action.msg.tone}>{action.msg.text}</Notice>
        </div>
      )}
    </Card>
  );
}

export default function AdminPage() {
  const profile = useProfile();
  const isAdmin = profile.role === "admin";
  const live = useRpc<LiveState>("get_live_state", undefined, isAdmin);
  const admin = useRpc<AdminState>("get_admin_state", undefined, isAdmin);

  if (!isAdmin) return <Notice tone="warn">Only admins can open this page.</Notice>;
  if ((live.loading && !live.data) || (admin.loading && !admin.data)) return <LoadingBlock />;
  if (!live.data || !admin.data) return <Notice tone="bad">{live.error?.message ?? admin.error?.message ?? "Could not load admin data."}</Notice>;

  return (
    <div className="space-y-4">
      <PageHero kicker="Admin console" title="Admin" subtitle="Inventory, products, team and the audit trail." />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-4">
          <InventorySetup live={live.data} />
          <AdjustmentForm />
          <ProductsCard live={live.data} />
        </div>
        <div className="space-y-4">
          <TeamCard state={admin.data} meId={profile.id} />
          <Card>
            <SectionTitle>Adjustment history</SectionTitle>
            {admin.data.adjustments.length === 0 ? (
              <p className="text-sm text-muted">No adjustments yet.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {admin.data.adjustments.map((a) => (
                  <li key={a.id} className="tabular py-2">
                    <b className={a.delta > 0 ? "text-good" : "text-navy"}>
                      {a.delta > 0 ? "+" : ""}
                      {a.delta} bars
                    </b>{" "}
                    · {a.kind} · {a.reason}
                    <div className="text-xs text-muted">
                      {fmtDateTime(a.created_at, live.data!.settings.timezone)} · {a.created_by_name}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card>
        <SectionTitle>Audit log</SectionTitle>
        <ul className="max-h-96 divide-y divide-line overflow-y-auto text-sm">
          {admin.data.audit.map((l) => (
            <li key={l.id} className="py-2">
              <div className="flex flex-wrap justify-between gap-2">
                <b className="text-navy">{ACTION_LABELS[l.action] ?? l.action}</b>
                <span className="text-xs text-muted">
                  {fmtDateTime(l.created_at, live.data!.settings.timezone)} · {l.actor_name ?? "system"}
                </span>
              </div>
              <div className="break-words font-mono text-xs text-muted">
                {l.entity} {l.entity_id ? `#${l.entity_id.slice(0, 12)}` : ""} {JSON.stringify(l.details)}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <ResetCard />
    </div>
  );
}
