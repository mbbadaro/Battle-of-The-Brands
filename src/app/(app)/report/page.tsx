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
import { CATEGORY_DEFINITION, CategoryTable, ProductTable } from "@/components/metrics";
import { CategoryChart, TimelineChart } from "@/components/charts";
import { Podium, StatTile, WrapperInventory } from "@/components/report-art";
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

      <section className="print-break relative overflow-hidden rounded-3xl bg-navy text-white">
        <img src="/promo.jpg" alt="" className="absolute inset-0 h-full w-full object-cover object-right opacity-90" />
        <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/90 to-navy/20" />
        <div className="relative p-5 sm:p-8">
          <BrandMark />
          <div className="mt-5 inline-block rounded-full bg-clif px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em]">Final results</div>
          <h2 className="display mt-3 max-w-xl text-5xl leading-[0.85] sm:text-7xl">
            OREO
            <br />
            meets
            <br />
            protein.
          </h2>
          <div className="mt-3 text-lg font-extrabold text-blue-soft">OREO flavor. Protein power.</div>
          <div className="mt-6 flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <div className="display tabular text-7xl leading-none sm:text-8xl" data-testid="report-total-tickets">
                {fmtInt(r.kpis.total_tickets)}
              </div>
              <div className="text-sm font-black uppercase tracking-wider text-white/80">tickets generated</div>
            </div>
            <div className="pb-1 text-sm text-white/75">
              {r.settings.event_name}
              {r.kpis.first_sale_at && (
                <>
                  <br />
                  Sales {fmtDateTime(r.kpis.first_sale_at, tz)} to {fmtDateTime(r.kpis.last_sale_at, tz)}
                </>
              )}
              <br />
              Generated {fmtDateTime(r.generated_at, tz)}
            </div>
          </div>
        </div>
      </section>

      <section className="print-break wrapper-stripes rounded-3xl bg-navy p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
          <StatTile label="Bars sold" value={fmtInt(r.kpis.total_bars)} sub={`of ${fmtInt(r.inventory.available_total)} available`} />
          <StatTile label="Inventory utilization" value={fmtPct(r.inventory.pct_sold)} sub="bars sold ÷ bars available" />
          <StatTile label="Unique customers" value={fmtInt(r.kpis.unique_customers)} sub="distinct NetIDs" />
          <StatTile label="Transactions" value={fmtInt(r.kpis.transactions)} sub={`${fmtInt(r.voided.count)} voided, excluded`} />
          <StatTile label="Avg tickets / sale" value={fmtDec(r.kpis.avg_tickets_per_transaction)} sub="tickets ÷ transactions" />
          <StatTile label="Bars remaining" value={fmtInt(r.inventory.remaining)} sub="after adjustments" />
        </div>
      </section>

      <section className="print-break sky rounded-3xl p-5 text-white">
        <h2 className="display text-2xl">Inventory reconciliation</h2>
        <p className="mb-4 text-sm text-white/75">The whole stock as one bar wrapper: colored by product sold, white fudge for what is left.</p>
        <WrapperInventory inventory={r.inventory} products={r.products} />
        <div className="tabular mt-5 flex flex-wrap items-center gap-2 text-sm font-bold">
          {[
            ["Initial", fmtInt(r.inventory.initial)],
            ["+", null],
            ["Restocks", fmtInt(r.inventory.adjustments_in)],
            ["−", null],
            ["Negative adj.", fmtInt(r.inventory.adjustments_out)],
            ["−", null],
            ["Bars sold", fmtInt(r.kpis.total_bars)],
            ["=", null],
          ].map(([label, v], i) =>
            v === null ? (
              <span key={i} className="text-xl font-black text-white/70">
                {label}
              </span>
            ) : (
              <span key={i} className="rounded-xl bg-white/12 px-3 py-1.5 ring-1 ring-white/20">
                <span className="text-white/70">{label}</span> {v}
              </span>
            ),
          )}
          <span className="rounded-xl bg-paper px-3 py-1.5 text-navy">
            <span className="text-muted">Remaining</span> {fmtInt(r.inventory.remaining)} bars
          </span>
        </div>
      </section>

      <section className="print-break">
        <h2 className="display mb-3 text-3xl text-navy">The podium</h2>
        {hasSales ? <Podium rows={rows} /> : <EmptyState title="No sales yet" />}
      </section>

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

      <footer className="print-break wrapper-stripes rounded-3xl bg-navy p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="display text-3xl leading-none">OREO flavor. Protein power.</div>
            <div className="mt-1 text-sm font-bold text-blue-soft">CLIF Builders White Fudge · Cornell MBA Battle of the Brands</div>
          </div>
          <BrandMark />
        </div>
        <p className="mt-4 text-xs text-white/70">
          All figures come from database records and exclude voided transactions. Percentages are rounded to one decimal place. No NetIDs or customer names appear in this report.
        </p>
      </footer>
    </div>
  );
}
