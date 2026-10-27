import { describe, expect, it } from "vitest";
import { computeTotals, isValidNetid, normalizeNetid } from "../../src/lib/sales";
import { buildTimeline, highlights, productMetrics } from "../../src/lib/analytics";
import { csvCell, parseCsv, toCsv } from "../../src/lib/csv";
import type { ProductState } from "../../src/lib/types";

const PRODUCTS = [
  { id: "single_bar", bars_per_unit: 1, tickets_per_unit: 3 },
  { id: "week_pack", bars_per_unit: 3, tickets_per_unit: 6 },
  { id: "exam_week_bundle", bars_per_unit: 5, tickets_per_unit: 8 },
];

const state = (id: string, name: string, packages: number, bars: number, tickets: number, txns: number): ProductState => ({
  id, name, tagline: null, bars_per_unit: 1, tickets_per_unit: 1, active: true, sort_order: 0,
  packages_sold: packages, bars_sold: bars, tickets, transactions_with: txns,
});

describe("sale totals", () => {
  it("applies the brief's formulas", () => {
    expect(computeTotals(PRODUCTS, { single_bar: 1 })).toEqual({ bars: 1, tickets: 3, packages: 1 });
    expect(computeTotals(PRODUCTS, { week_pack: 1 })).toEqual({ bars: 3, tickets: 6, packages: 1 });
    expect(computeTotals(PRODUCTS, { exam_week_bundle: 1 })).toEqual({ bars: 5, tickets: 8, packages: 1 });
    expect(computeTotals(PRODUCTS, { single_bar: 2, week_pack: 1, exam_week_bundle: 1 })).toEqual({ bars: 10, tickets: 20, packages: 4 });
    expect(computeTotals(PRODUCTS, {})).toEqual({ bars: 0, tickets: 0, packages: 0 });
  });
  it("normalises NetIDs like the database", () => {
    expect(normalizeNetid("  ABC123@cornell.edu ")).toBe("abc123");
    expect(isValidNetid("jd45")).toBe(true);
    expect(isValidNetid("john.doe")).toBe(false);
    expect(isValidNetid("")).toBe(false);
  });
});

describe("product analytics", () => {
  const rows = productMetrics(
    [state("single_bar", "Single Bar", 10, 10, 30, 8), state("week_pack", "Week Pack", 4, 12, 24, 4), state("exam_week_bundle", "Exam Week Bundle", 4, 20, 32, 4)],
    86,
    14
  );
  it("computes shares and averages", () => {
    expect(rows[0].ticketShare).toBe(34.9);
    expect(rows[0].transactionShare).toBe(57.1);
    expect(rows[0].avgQtyPerTransaction).toBe(1.25);
  });
  it("lets different products lead different metrics and reports ties", () => {
    const h = highlights(rows);
    expect(h.bestByPackages?.names).toEqual(["Single Bar"]);
    expect(h.topTickets?.names).toEqual(["Exam Week Bundle"]);
    expect(h.mostInventory?.names).toEqual(["Exam Week Bundle"]);
    expect(h.slowest?.names).toEqual(["Week Pack", "Exam Week Bundle"]);
  });
  it("returns no highlights without sales", () => {
    expect(highlights(productMetrics([state("a", "A", 0, 0, 0, 0)], 0, 0)).bestByPackages).toBeNull();
  });
});

describe("timeline", () => {
  it("fills empty 15-minute gaps and keeps a running total", () => {
    const { points, interval } = buildTimeline(
      [
        { bucket: "2026-11-05T15:00:00Z", transactions: 2, tickets: 9, bars: 4 },
        { bucket: "2026-11-05T15:45:00Z", transactions: 1, tickets: 8, bars: 5 },
      ],
      "America/New_York"
    );
    expect(interval).toBe("15 min");
    expect(points.map((p) => p.tickets)).toEqual([9, 0, 0, 8]);
    expect(points.at(-1)?.cumulativeTickets).toBe(17);
  });
});

describe("csv", () => {
  it("escapes quotes and blocks formula injection", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell(-3)).toBe('"-3"');
    expect(parseCsv(toCsv(["a", "b"], [["x,y", 'q"z']]))).toEqual([["a", "b"], ["x,y", 'q"z']]);
  });
});
