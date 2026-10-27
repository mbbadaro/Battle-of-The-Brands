"use client";

import { useRpc } from "@/hooks/live";
import type { Dashboard } from "@/lib/types";
import { buildTimeline, highlights, productMetrics } from "@/lib/analytics";
import { fmtInt, fmtTime } from "@/lib/format";
import { productColor } from "@/lib/labels";
import { Card, EmptyState, LoadingBlock, Notice, SectionTitle } from "@/components/ui";
import { CATEGORY_DEFINITION, CategoryTable, HighlightCards, KpiGrid, ProductTable } from "@/components/metrics";
import { CategoryChart, ProductBarChart, TimelineChart } from "@/components/charts";
import { InventoryBar } from "@/components/inventory-panel";

export default function DashboardPage() {
  const { data: d, error, loading } = useRpc<Dashboard>("get_dashboard");

  if (loading && !d) return <LoadingBlock label="Loading dashboard…" />;
  if (!d) return <Notice tone="bad">{error?.message ?? "Could not load the dashboard."}</Notice>;

  const rows = productMetrics(d.products, d.kpis.total_tickets, d.kpis.transactions);
  const h = highlights(rows);
  const timeline = buildTimeline(d.timeline, d.settings.timezone);
  const hasSales = d.kpis.transactions > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="display text-3xl text-navy">Live dashboard</h1>
          <p className="text-sm text-muted">
            Updates automatically. {d.kpis.last_sale_at ? `Last sale at ${fmtTime(d.kpis.last_sale_at, d.settings.timezone)}.` : "No sales yet."}
          </p>
        </div>
        {error && <Notice tone="warn">Showing last loaded data: {error.message}</Notice>}
      </div>

      <KpiGrid d={d} />

      <Card>
        <SectionTitle aside={<span className="tabular text-sm font-bold text-navy">{fmtInt(d.inventory.remaining)} bars left</span>}>
          Inventory
        </SectionTitle>
        <div className="rounded-xl bg-navy p-3">
          <InventoryBar inventory={d.inventory} products={d.products} tall />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-muted">
          {d.products.map((p) => (
            <span key={p.id} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: productColor(p.id) }} />
              {p.name}: {fmtInt(p.bars_sold)} bars
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-navy" />
            Remaining: {fmtInt(d.inventory.remaining)}
          </span>
        </div>
      </Card>

      <HighlightCards h={h} />

      <Card>
        <SectionTitle>Product performance</SectionTitle>
        <ProductTable rows={rows} />
        <p className="mt-2 text-xs text-muted">
          Packages are what customers bought; bars are what left inventory. 10 Week Packs = 10 packages = 30 bars.
        </p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle>Packages sold</SectionTitle>
          {hasSales ? <ProductBarChart rows={rows} metric="packages" unit="Packages" /> : <EmptyState title="No sales yet" hint="Bars appear after the first sale." />}
        </Card>
        <Card>
          <SectionTitle>Tickets generated</SectionTitle>
          {hasSales ? <ProductBarChart rows={rows} metric="tickets" unit="Tickets" /> : <EmptyState title="No sales yet" hint="Bars appear after the first sale." />}
        </Card>
        <Card>
          <SectionTitle aside={<span className="text-xs font-bold text-muted">tickets per {timeline.interval}</span>}>Sales over time</SectionTitle>
          {timeline.points.length >= 1 ? (
            <TimelineChart points={timeline.points} interval={timeline.interval} />
          ) : (
            <EmptyState title="No sales yet" hint="The timeline starts with the first sale." />
          )}
        </Card>
        <Card>
          <SectionTitle>Customers by category</SectionTitle>
          {hasSales ? (
            <>
              <CategoryChart rows={d.categories} />
              <div className="mt-3">
                <CategoryTable rows={d.categories} />
              </div>
              <p className="mt-2 text-xs text-muted">{CATEGORY_DEFINITION}</p>
            </>
          ) : (
            <EmptyState title="No customers yet" />
          )}
        </Card>
      </div>
    </div>
  );
}
