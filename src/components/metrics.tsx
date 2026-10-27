"use client";

import type { Highlights, ProductMetrics } from "@/lib/analytics";
import type { CategoryRow, Dashboard } from "@/lib/types";
import { CATEGORY_LABELS, productColor } from "@/lib/labels";
import { fmtDec, fmtInt, fmtPct } from "@/lib/format";

export function KpiCard({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`print-break rounded-2xl p-4 text-white ${accent ? "bg-blue shadow-lg shadow-blue/30" : "bg-white/10 ring-1 ring-white/15"}`}>
      <div className="text-[11px] font-black uppercase tracking-wider text-blue-soft">{label}</div>
      <div className="display tabular mt-1 text-[34px] leading-none" data-testid={`kpi-${label}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs font-semibold text-white/75">{sub}</div>}
    </div>
  );
}

export function KpiGrid({ d }: { d: Dashboard }) {
  const k = d.kpis;
  return (
    <div className="wrapper-stripes grid grid-cols-2 gap-2.5 rounded-3xl bg-navy p-3 sm:p-4 md:grid-cols-4">
      <KpiCard accent label="Tickets earned" value={fmtInt(k.total_tickets)} sub={d.voided.count ? `${fmtInt(d.voided.tickets)} voided tickets excluded` : "From completed sales"} />
      <KpiCard label="Bars sold" value={fmtInt(k.total_bars)} sub={`of ${fmtInt(d.inventory.available_total)} available`} />
      <KpiCard label="Bars remaining" value={fmtInt(d.inventory.remaining)} />
      <KpiCard label="Inventory sold" value={fmtPct(d.inventory.pct_sold)} sub="bars sold ÷ bars available" />
      <KpiCard label="Transactions" value={fmtInt(k.transactions)} sub={d.voided.count ? `${fmtInt(d.voided.count)} voided, not counted` : undefined} />
      <KpiCard label="Unique customers" value={fmtInt(k.unique_customers)} sub="distinct NetIDs" />
      <KpiCard label="Avg tickets / sale" value={fmtDec(k.avg_tickets_per_transaction)} sub="tickets ÷ transactions" />
      <KpiCard label="Avg bars / sale" value={fmtDec(k.avg_bars_per_transaction)} sub="bars ÷ transactions" />
    </div>
  );
}

function leaderText(l: { names: string[]; value: number } | null, unit: string) {
  if (!l) return { title: "—", sub: "No sales yet" };
  return { title: l.names.join(" & "), sub: `${fmtInt(l.value)} ${unit}${l.names.length > 1 ? " each (tie)" : ""}` };
}

export function HighlightCards({ h }: { h: Highlights }) {
  const cards = [
    { label: "Best seller (packages)", ...leaderText(h.bestByPackages, "packages") },
    { label: "Top ticket revenue", ...leaderText(h.topTickets, "tickets") },
    { label: "Uses most inventory", ...leaderText(h.mostInventory, "bars") },
    { label: "Slowest seller", ...leaderText(h.slowest, "packages") },
  ];
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="print-break sky rounded-2xl p-3.5 text-white">
          <div className="text-[11px] font-black uppercase tracking-wider text-blue-soft">{c.label}</div>
          <div className="display mt-1 text-lg leading-tight">{c.title}</div>
          <div className="text-xs font-semibold text-white/75">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

export function ProductTable({ rows, ranked = false }: { rows: ProductMetrics[]; ranked?: boolean }) {
  const totals = rows.reduce(
    (a, r) => ({ packages: a.packages + r.packages, bars: a.bars + r.bars, tickets: a.tickets + r.tickets }),
    { packages: 0, bars: 0, tickets: 0 }
  );
  return (
    <div className="overflow-x-auto">
      <table className="tabular w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b-2 border-navy text-left text-[11px] font-black uppercase tracking-wider text-muted">
            {ranked && <th className="py-2 pr-2">#</th>}
            <th className="py-2 pr-2">Product</th>
            <th className="py-2 pr-2 text-right">Packages sold</th>
            <th className="py-2 pr-2 text-right">Bars consumed</th>
            <th className="py-2 pr-2 text-right">Tickets</th>
            <th className="py-2 pr-2 text-right">% of tickets</th>
            <th className="py-2 pr-2 text-right">% of sales with it</th>
            <th className="py-2 text-right">Avg qty / sale with it</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className="border-b border-line">
              {ranked && <td className="py-2.5 pr-2 font-black text-navy">{i + 1}</td>}
              <td className="py-2.5 pr-2 font-bold text-navy">
                <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: productColor(r.id) }} />
                {r.name}
              </td>
              <td className="py-2.5 pr-2 text-right font-bold">{fmtInt(r.packages)}</td>
              <td className="py-2.5 pr-2 text-right">{fmtInt(r.bars)}</td>
              <td className="py-2.5 pr-2 text-right font-bold">{fmtInt(r.tickets)}</td>
              <td className="py-2.5 pr-2 text-right">{fmtPct(r.ticketShare)}</td>
              <td className="py-2.5 pr-2 text-right">{fmtPct(r.transactionShare)}</td>
              <td className="py-2.5 text-right">{fmtDec(r.avgQtyPerTransaction)}</td>
            </tr>
          ))}
          <tr className="font-black text-navy">
            {ranked && <td />}
            <td className="py-2.5 pr-2">Total</td>
            <td className="py-2.5 pr-2 text-right">{fmtInt(totals.packages)}</td>
            <td className="py-2.5 pr-2 text-right">{fmtInt(totals.bars)}</td>
            <td className="py-2.5 pr-2 text-right">{fmtInt(totals.tickets)}</td>
            <td className="py-2.5 pr-2 text-right">{totals.tickets ? "100.0%" : "—"}</td>
            <td className="py-2.5 pr-2 text-right text-muted" colSpan={2}>
              a sale can contain several products
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function CategoryTable({ rows }: { rows: CategoryRow[] }) {
  const t = rows.reduce((a, r) => ({ c: a.c + r.customers, x: a.x + r.transactions, k: a.k + r.tickets }), { c: 0, x: 0, k: 0 });
  return (
    <table className="tabular w-full text-sm">
      <thead>
        <tr className="border-b-2 border-navy text-left text-[11px] font-black uppercase tracking-wider text-muted">
          <th className="py-2 pr-2">Category</th>
          <th className="py-2 pr-2 text-right">Customers</th>
          <th className="py-2 pr-2 text-right">Sales</th>
          <th className="py-2 text-right">Tickets</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.category} className="border-b border-line">
            <td className="py-2 pr-2 font-bold text-navy">{CATEGORY_LABELS[r.category]}</td>
            <td className="py-2 pr-2 text-right">{fmtInt(r.customers)}</td>
            <td className="py-2 pr-2 text-right">{fmtInt(r.transactions)}</td>
            <td className="py-2 text-right">{fmtInt(r.tickets)}</td>
          </tr>
        ))}
        <tr className="font-black text-navy">
          <td className="py-2 pr-2">Total</td>
          <td className="py-2 pr-2 text-right">{fmtInt(t.c)}</td>
          <td className="py-2 pr-2 text-right">{fmtInt(t.x)}</td>
          <td className="py-2 text-right">{fmtInt(t.k)}</td>
        </tr>
      </tbody>
    </table>
  );
}

export const CATEGORY_DEFINITION =
  "Each customer (NetID) is counted once, under the most recent category they gave. Customers who never gave one are “Not specified”.";
