import type { ProductState, TimelineBucket } from "./types";

export interface ProductMetrics {
  id: string;
  name: string;
  packages: number;
  bars: number;
  tickets: number;
  transactionsWith: number;
  // Share of all ticket revenue, 0–100.
  ticketShare: number;
  // Share of completed transactions that contain this product, 0–100.
  transactionShare: number;
  // Packages per transaction that contains this product.
  avgQtyPerTransaction: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function productMetrics(products: ProductState[], totalTickets: number, totalTransactions: number): ProductMetrics[] {
  return products.map((p) => ({
    id: p.id,
    name: p.name,
    packages: p.packages_sold,
    bars: p.bars_sold,
    tickets: p.tickets,
    transactionsWith: p.transactions_with,
    ticketShare: totalTickets > 0 ? round1((p.tickets / totalTickets) * 100) : 0,
    transactionShare: totalTransactions > 0 ? round1((p.transactions_with / totalTransactions) * 100) : 0,
    avgQtyPerTransaction: p.transactions_with > 0 ? round2(p.packages_sold / p.transactions_with) : 0,
  }));
}

export interface Leader {
  names: string[];
  value: number;
}

// Ties are reported together rather than picking one arbitrarily.
function leader(rows: ProductMetrics[], key: (r: ProductMetrics) => number, mode: "max" | "min"): Leader | null {
  if (rows.length === 0) return null;
  const values = rows.map(key);
  const target = mode === "max" ? Math.max(...values) : Math.min(...values);
  return { names: rows.filter((r) => key(r) === target).map((r) => r.name), value: target };
}

export interface Highlights {
  bestByPackages: Leader | null;
  topTickets: Leader | null;
  mostInventory: Leader | null;
  slowest: Leader | null;
}

export function highlights(rows: ProductMetrics[]): Highlights {
  const anySales = rows.some((r) => r.packages > 0);
  if (!anySales) return { bestByPackages: null, topTickets: null, mostInventory: null, slowest: null };
  return {
    bestByPackages: leader(rows, (r) => r.packages, "max"),
    topTickets: leader(rows, (r) => r.tickets, "max"),
    mostInventory: leader(rows, (r) => r.bars, "max"),
    slowest: leader(rows, (r) => r.packages, "min"),
  };
}

// Ranking by tickets generated, then packages, then name.
export function ranking(rows: ProductMetrics[]): ProductMetrics[] {
  return [...rows].sort((a, b) => b.tickets - a.tickets || b.packages - a.packages || a.name.localeCompare(b.name));
}

export interface TimelinePoint {
  start: number;
  label: string;
  transactions: number;
  tickets: number;
  bars: number;
  cumulativeTickets: number;
}

// Fills gaps between the first and last 15-minute bucket. Events longer than 4 hours roll up to hours.
export function buildTimeline(buckets: TimelineBucket[], timeZone: string): { points: TimelinePoint[]; interval: "15 min" | "hour" } {
  if (buckets.length === 0) return { points: [], interval: "15 min" };
  const quarter = 15 * 60 * 1000;
  const first = new Date(buckets[0].bucket).getTime();
  const last = new Date(buckets[buckets.length - 1].bucket).getTime();
  const step = last - first > 4 * 60 * 60 * 1000 ? 60 * 60 * 1000 : quarter;
  const align = (t: number) => Math.floor(t / step) * step;

  const map = new Map<number, { transactions: number; tickets: number; bars: number }>();
  for (const b of buckets) {
    const k = align(new Date(b.bucket).getTime());
    const cur = map.get(k) ?? { transactions: 0, tickets: 0, bars: 0 };
    cur.transactions += b.transactions;
    cur.tickets += b.tickets;
    cur.bars += b.bars;
    map.set(k, cur);
  }

  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  const points: TimelinePoint[] = [];
  let cumulative = 0;
  for (let t = align(first); t <= align(last); t += step) {
    const v = map.get(t) ?? { transactions: 0, tickets: 0, bars: 0 };
    cumulative += v.tickets;
    points.push({ start: t, label: fmt.format(new Date(t)), ...v, cumulativeTickets: cumulative });
  }
  return { points, interval: step === quarter ? "15 min" : "hour" };
}
