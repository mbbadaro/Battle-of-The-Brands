"use client";

import { useState } from "react";
import type { Inventory, ProductState } from "@/lib/types";
import { fmtInt, fmtPct } from "@/lib/format";
import { productColor } from "@/lib/labels";

export function stockTone(inv: Inventory) {
  if (inv.remaining <= 0) return { label: "Sold out", cls: "bg-bad text-white" };
  if (inv.remaining <= Math.max(10, Math.round(inv.available_total * 0.1))) return { label: "Low stock", cls: "bg-[#f5c451] text-navy" };
  return { label: "In stock", cls: "bg-[#3ddc97] text-navy" };
}

// Progress bar of bars sold vs. total available, with a segment per product.
export function InventoryBar({ inventory, products, tall = false }: { inventory: Inventory; products?: ProductState[]; tall?: boolean }) {
  const total = Math.max(inventory.available_total, 1);
  return (
    <div
      className={`flex w-full gap-[2px] overflow-hidden rounded-full bg-white/15 ${tall ? "h-5" : "h-3"}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={inventory.available_total}
      aria-valuenow={inventory.bars_sold}
      aria-label={`${inventory.bars_sold} of ${inventory.available_total} bars sold`}
    >
      {products
        ? products
            .filter((p) => p.bars_sold > 0)
            .map((p) => <span key={p.id} className="h-full" style={{ width: `${(p.bars_sold / total) * 100}%`, background: productColor(p.id) }} />)
        : <span className="h-full bg-blue" style={{ width: `${(inventory.bars_sold / total) * 100}%` }} />}
    </div>
  );
}

export function InventoryPanel({ inventory, products }: { inventory: Inventory; products: ProductState[] }) {
  const [open, setOpen] = useState(false);
  const tone = stockTone(inventory);
  return (
    <section className="relative overflow-hidden rounded-2xl bg-navy px-4 pb-3 pt-3 text-white" aria-label="Inventory">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/promo.jpg" alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover object-right opacity-60" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-navy via-navy/90 to-navy/40" />
      <button className="relative w-full text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="flex items-end justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <span className="display tabular text-[44px] leading-[0.85]" data-testid="bars-remaining">{fmtInt(inventory.remaining)}</span>
            <span className="text-sm font-bold text-white/80">
              bars left <span className="text-white/60">of {fmtInt(inventory.available_total)}</span>
            </span>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-black uppercase ${tone.cls}`}>{tone.label}</span>
        </div>
        <div className="mt-2.5">
          <InventoryBar inventory={inventory} products={products} />
        </div>
        <div className="tabular mt-2 flex justify-between text-[12px] font-semibold text-white/80">
          <span>
            <b className="text-white">{fmtInt(inventory.bars_sold)}</b> sold · <b className="text-white">{fmtPct(inventory.pct_sold)}</b>
          </span>
          <span>
            <b className="text-white">{fmtInt(inventory.transactions)}</b> sales
          </span>
          <span className="text-blue-soft underline decoration-dotted">{open ? "Hide" : "Details"}</span>
        </div>
      </button>
      {open && (
        <div className="tabular relative mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-white/15 pt-3 text-[13px]">
          <span className="text-white/70">Initial inventory</span>
          <b className="text-right">{fmtInt(inventory.initial)}</b>
          <span className="text-white/70">+ Restocks / adjustments in</span>
          <b className="text-right">{fmtInt(inventory.adjustments_in)}</b>
          <span className="text-white/70">− Adjustments out</span>
          <b className="text-right">{fmtInt(inventory.adjustments_out)}</b>
          <span className="text-white/70">− Bars sold</span>
          <b className="text-right">{fmtInt(inventory.bars_sold)}</b>
          <span className="font-bold">= Remaining</span>
          <b className="text-right">{fmtInt(inventory.remaining)}</b>
          <div className="col-span-2 mt-2 text-[11px] font-black uppercase tracking-wider text-white/60">Bars sold by product</div>
          {products.map((p) => (
            <div key={p.id} className="col-span-2 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: productColor(p.id) }} />
                {p.name}
              </span>
              <span>
                <b>{fmtInt(p.bars_sold)}</b> bars <span className="text-white/60">({fmtInt(p.packages_sold)} pkg)</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
