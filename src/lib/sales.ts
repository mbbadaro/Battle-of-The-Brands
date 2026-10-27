// Client-side preview of a sale. The database recomputes everything in record_sale();
// this only drives the live summary and the "not enough stock" warning.

export interface PricedProduct {
  id: string;
  bars_per_unit: number;
  tickets_per_unit: number;
}

export type Quantities = Record<string, number>;

export interface SaleTotals {
  bars: number;
  tickets: number;
  packages: number;
}

// Total bars = Σ quantity × bars_per_unit; total tickets = Σ quantity × tickets_per_unit.
export function computeTotals(products: PricedProduct[], quantities: Quantities): SaleTotals {
  let bars = 0;
  let tickets = 0;
  let packages = 0;
  for (const p of products) {
    const q = quantities[p.id] ?? 0;
    if (q > 0) {
      bars += q * p.bars_per_unit;
      tickets += q * p.tickets_per_unit;
      packages += q;
    }
  }
  return { bars, tickets, packages };
}

export const NETID_PATTERN = /^[a-z]{1,4}[0-9]{1,6}$/;

// Same normalisation as the database: trim, lowercase, drop an @cornell.edu suffix.
export function normalizeNetid(raw: string): string {
  return raw.trim().toLowerCase().replace(/@cornell\.edu$/, "");
}

export function isValidNetid(raw: string): boolean {
  return NETID_PATTERN.test(normalizeNetid(raw));
}

export const MAX_QTY = 100;

export function itemsPayload(products: PricedProduct[], quantities: Quantities): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of products) {
    const q = quantities[p.id] ?? 0;
    if (q > 0) out[p.id] = q;
  }
  return out;
}
