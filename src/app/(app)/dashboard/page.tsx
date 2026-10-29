"use client";

import { useRpc } from "@/hooks/live";
import type { Dashboard } from "@/lib/types";
import { buildTimeline, highlights, productMetrics } from "@/lib/analytics";
import { fmtInt, fmtTime } from "@/lib/format";
import { Card, EmptyState, LoadingBlock, Notice, SectionTitle } from "@/components/ui";
import { CATEGORY_DEFINITION, CategoryTable, HighlightCards, KpiGrid, ProductTable } from "@/components/metrics";
import { CategoryChart, ProductBarChart, TimelineChart } from "@/components/charts";
import { WrapperInventory } from "@/components/report-art";
import { PageHero } from "@/components/brand";

export default function DashboardPage() {
  const { data: d, error, loading } = useRpc<Dashboard>("get_dashboard");

  if (loading && !d) return <LoadingBlock label="Loading dashboard…" />;
  if (!d) return <Notice tone="bad">{error?.message ?? "Could not load the dashboard."}</Notice>;

  const rows = productMetrics(d.products, d.kpis.total_tickets);
  const h = highlights(rows);
  const timeline = buildTimeline(d.timeline, d.settings.timezone);
  const hasSales = d.kpis.transactions > 0;

  return (
    <div className="space-y-4">
      <PageHero
        kicker="Live"
        title="Live dashboard"
        subtitle={`OREO meets protein. Updates automatically. ${d.kpis.last_sale_at ? `Last sale at ${fmtTime(d.kpis.last_sale_at, d.settings.timezone)}.` : "No sales yet."}`}
      >
        <div className="rounded-2xl bg-navy/70 px-4 py-2 text-right backdrop-blur-sm">
          <div className="display tabular text-6xl leading-none">{fmtInt(d.kpis.total_tickets)}</div>
          <div className="text-xs font-black uppercase tracking-wider text-white/80">tickets so far</div>
        </div>
      </PageHero>
      {error && <Notice tone="warn">Showing last loaded data: {error.message}</Notice>}

      <KpiGrid d={d} />

      <section className="sky rounded-3xl p-4 text-white sm:p-5">
        <div className="mb-3 flex items-end justify-between gap-2">
          <h2 className="display text-xl">Inventory</h2>
          <span className="tabular text-sm font-bold">{fmtInt(d.inventory.remaining)} bars left</span>
        </div>
        <WrapperInventory inventory={d.inventory} products={d.products} />
      </section>

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
