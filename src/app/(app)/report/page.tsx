"use client";

import { useState } from "react";
import { useRpc } from "@/hooks/live";
import { useProfile } from "@/hooks/profile";
import { useExportCsv } from "@/hooks/export";
import type { Report } from "@/lib/types";
import { buildTimeline, productMetrics, ranking } from "@/lib/analytics";
import { downloadText } from "@/lib/csv";
import { summaryCsv, summaryText } from "@/lib/report";
import { fmtDateTime, fmtDec, fmtInt, fmtPct } from "@/lib/format";
import { Button, Card, EmptyState, LoadingBlock, Notice, SectionTitle, Spinner } from "@/components/ui";
import { CATEGORY_DEFINITION, CategoryTable, KpiCard, ProductTable } from "@/components/metrics";
import { CategoryChart, TimelineChart } from "@/components/charts";
import { InventoryBar } from "@/components/inventory-panel";
import { BrandMark } from "@/components/brand";

export default function ReportPage() {
  const profile = useProfile();
  const { data: r, error, loading } = useRpc<Report>("get_report");
  const exporter = useExportCsv();
  const [copied, setCopied] = useState(false);

  if (loading && !r) return <LoadingBlock label="Building report…" />;
  if (!r) return <Notice tone="bad">{error?.message ?? "Could not load the report."}</Notice>;

  const tz = r.settings.timezone;
  const rows = ranking(productMetrics(r.products, r.kpis.total_tickets, r.kpis.transactions));
  const timeline = buildTimeline(r.timeline, tz);
  const hasSales = r.kpis.transactions > 0;
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-2">
        <h1 className="display mr-auto text-3xl text-navy">End-of-event report</h1>
        {profile.role === "admin" && (
          <Button variant="navy" disabled={exporter.busy} onClick={() => exporter.run(r)}>
            {exporter.busy && <Spinner />} Transactions CSV
          </Button>
        )}
        <Button variant="outline" onClick={() => downloadText(`battle-of-the-brands-summary-${stamp}.csv`, summaryCsv(r))}>
          Summary CSV
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(summaryText(r));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? "Copied ✓" : "Copy summary text"}
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          Print / PDF
        </Button>
      </div>
      {exporter.error && <Notice tone="bad">{exporter.error}</Notice>}

      <div className="sky relative overflow-hidden rounded-3xl p-5 text-white">
        <BrandMark />
        <div className="display mt-3 text-4xl leading-[0.9] sm:text-5xl">OREO meets protein.</div>
        <div className="mt-1 text-lg font-extrabold">White Fudge OREO flavor · Final results</div>
        <div className="mt-2 text-sm text-white/75">
          {r.settings.event_name} · generated {fmtDateTime(r.generated_at, tz)}
          {r.kpis.first_sale_at && ` · sales from ${fmtDateTime(r.kpis.first_sale_at, tz)} to ${fmtDateTime(r.kpis.last_sale_at, tz)}`}
        </div>
        <div className="mt-4">
          <InventoryBar inventory={r.inventory} products={r.products} tall />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <KpiCard accent label="Tickets generated" value={fmtInt(r.kpis.total_tickets)} />
        <KpiCard label="Inventory utilization" value={fmtPct(r.inventory.pct_sold)} sub="bars sold ÷ bars available" />
        <KpiCard label="Unique customers" value={fmtInt(r.kpis.unique_customers)} />
        <KpiCard label="Avg tickets / transaction" value={fmtDec(r.kpis.avg_tickets_per_transaction)} sub={`${fmtInt(r.kpis.transactions)} transactions`} />
      </div>

      <Card className="print-break">
        <SectionTitle>Inventory reconciliation</SectionTitle>
        <table className="tabular w-full max-w-md text-sm">
          <tbody>
            {[
              ["Initial inventory", r.inventory.initial, ""],
              ["+ Restocks and positive adjustments", r.inventory.adjustments_in, ""],
              ["− Negative adjustments", r.inventory.adjustments_out, ""],
              ["− Bars sold", r.kpis.total_bars, ""],
              ["= Final remaining inventory", r.inventory.remaining, "font-black text-navy border-t-2 border-navy"],
            ].map(([label, v, cls]) => (
              <tr key={label as string} className={cls as string}>
                <td className="py-1.5 pr-4">{label}</td>
                <td className="py-1.5 text-right font-bold">{fmtInt(v as number)} bars</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="print-break">
        <SectionTitle>Product ranking (by tickets)</SectionTitle>
        <ProductTable rows={rows} ranked />
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="print-break">
          <SectionTitle>Customer categories</SectionTitle>
          {hasSales ? (
            <>
              <CategoryChart rows={r.categories} />
              <div className="mt-3">
                <CategoryTable rows={r.categories} />
              </div>
              <p className="mt-2 text-xs text-muted">{CATEGORY_DEFINITION}</p>
            </>
          ) : (
            <EmptyState title="No customers yet" />
          )}
        </Card>
        <Card className="print-break">
          <SectionTitle aside={<span className="text-xs font-bold text-muted">tickets per {timeline.interval}</span>}>Sales timeline</SectionTitle>
          {timeline.points.length ? <TimelineChart points={timeline.points} interval={timeline.interval} /> : <EmptyState title="No sales yet" />}
        </Card>
      </div>

      <Card className="print-break">
        <SectionTitle aside={<span className="text-sm font-bold text-muted">{fmtInt(r.voided.count)} total</span>}>Voided transactions</SectionTitle>
        {r.voided_transactions.length === 0 ? (
          <p className="text-sm text-muted">None.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabular w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b-2 border-navy text-left text-[11px] font-black uppercase tracking-wider text-muted">
                  <th className="py-2 pr-2">Sale</th>
                  <th className="py-2 pr-2">Sold</th>
                  <th className="py-2 pr-2">Voided</th>
                  <th className="py-2 pr-2 text-right">Bars</th>
                  <th className="py-2 pr-2 text-right">Tickets</th>
                  <th className="py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {r.voided_transactions.map((v) => (
                  <tr key={v.id} className="border-b border-line">
                    <td className="py-2 pr-2 font-bold">#{v.id}</td>
                    <td className="py-2 pr-2">
                      {fmtDateTime(v.created_at, tz)} · {v.seller_name}
                    </td>
                    <td className="py-2 pr-2">
                      {fmtDateTime(v.voided_at, tz)} · {v.voided_by_name}
                    </td>
                    <td className="py-2 pr-2 text-right">{v.total_bars}</td>
                    <td className="py-2 pr-2 text-right">{v.total_tickets}</td>
                    <td className="py-2">{v.void_reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="print-break">
        <SectionTitle>Inventory adjustments</SectionTitle>
        {r.adjustments.length === 0 ? (
          <p className="text-sm text-muted">None.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {r.adjustments.map((a) => (
              <li key={a.id} className="tabular flex flex-wrap justify-between gap-2 py-2">
                <span>
                  <b className={a.delta > 0 ? "text-good" : "text-bad"}>
                    {a.delta > 0 ? "+" : ""}
                    {a.delta} bars
                  </b>{" "}
                  · {a.kind} · {a.reason}
                </span>
                <span className="text-muted">
                  {fmtDateTime(a.created_at, tz)} · {a.created_by_name}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-xs text-muted">
        All figures come from database records and exclude voided transactions. Percentages are rounded to one decimal place. No NetIDs or customer names appear in this report.
      </p>
    </div>
  );
}
