import type { Report } from "./types";
import { productMetrics, ranking } from "./analytics";
import { toCsv } from "./csv";

const CAT: Record<string, string> = {
  first_year_mba: "First-Year MBA",
  second_year_mba: "Second-Year MBA",
  faculty: "Faculty",
  other_unknown: "Other / Unknown",
  not_specified: "Not specified",
};

const n = (v: number) => new Intl.NumberFormat("en-US").format(v);

// Plain-text summary for pasting into Slack, email or the team's group chat. No customer data.
export function summaryText(r: Report): string {
  const rows = ranking(productMetrics(r.products, r.kpis.total_tickets));
  const k = r.kpis;
  const lines = [
    `${r.settings.event_name}: CLIF Builder's White Fudge Oreo results`,
    ``,
    `Tickets earned: ${n(k.total_tickets)}`,
    `Bars sold: ${n(k.total_bars)} of ${n(r.inventory.available_total)} available (${r.inventory.pct_sold.toFixed(1)}% inventory utilization)`,
    `Bars remaining: ${n(r.inventory.remaining)}`,
    `Inventory: ${n(r.inventory.initial)} initial + ${n(r.inventory.adjustments_in)} added − ${n(r.inventory.adjustments_out)} removed − ${n(k.total_bars)} sold = ${n(r.inventory.remaining)} remaining`,
    `Transactions: ${n(k.transactions)} · Unique customers: ${n(k.unique_customers)} · Avg tickets per transaction: ${k.avg_tickets_per_transaction.toFixed(2)}`,
    ``,
    `Product ranking (by tickets):`,
    ...rows.map(
      (p, i) =>
        `${i + 1}. ${p.name}: ${n(p.packages)} packages, ${n(p.bars)} bars, ${n(p.tickets)} tickets (${p.ticketShare.toFixed(1)}% of tickets)`
    ),
    ``,
    `Customers by category:`,
    ...r.categories.map((c) => `- ${CAT[c.category]}: ${n(c.customers)} customers, ${n(c.transactions)} sales, ${n(c.tickets)} tickets`),
    ``,
    `Voided transactions (excluded from totals): ${n(r.voided.count)} (${n(r.voided.tickets)} tickets, ${n(r.voided.bars)} bars)`,
    `Inventory adjustments: ${n(r.adjustments.length)}`,
  ];
  return lines.join("\n");
}

// Key metrics as a two-sheet-friendly CSV: one metric per row, then per-product and per-category rows.
export function summaryCsv(r: Report): string {
  const rows = ranking(productMetrics(r.products, r.kpis.total_tickets));
  const k = r.kpis;
  const out: unknown[][] = [
    ["metric", "value", "definition"],
    ["initial_inventory_bars", r.inventory.initial, "configured before the event"],
    ["adjustments_in_bars", r.inventory.adjustments_in, "sum of positive adjustments"],
    ["adjustments_out_bars", r.inventory.adjustments_out, "sum of negative adjustments"],
    ["bars_sold", k.total_bars, "bars in completed transactions"],
    ["bars_remaining", r.inventory.remaining, "initial + in − out − sold"],
    ["inventory_utilization_pct", r.inventory.pct_sold, "bars sold ÷ (initial + in − out) × 100"],
    ["tickets_earned", k.total_tickets, "tickets in completed transactions"],
    ["transactions", k.transactions, "completed transactions"],
    ["unique_customers", k.unique_customers, "distinct NetIDs in completed transactions"],
    ["avg_tickets_per_transaction", k.avg_tickets_per_transaction, "tickets ÷ transactions"],
    ["voided_transactions", r.voided.count, "excluded from all totals"],
    ["voided_tickets", r.voided.tickets, "excluded from all totals"],
    [],
    ["rank", "product", "packages_sold", "bars_consumed", "tickets", "pct_of_tickets", "pct_of_packages_sold", "avg_qty_per_transaction_with_product"],
    ...rows.map((p, i) => [i + 1, p.name, p.packages, p.bars, p.tickets, p.ticketShare, p.packageShare, p.avgQtyPerTransaction]),
    [],
    ["category", "customers", "transactions", "tickets", "bars"],
    ...r.categories.map((c) => [CAT[c.category], c.customers, c.transactions, c.tickets, c.bars]),
  ];
  return toCsv(out[0] as string[], out.slice(1));
}
