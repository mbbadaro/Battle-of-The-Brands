// Campaign-styled pieces for the end-of-event report.
import type { ProductMetrics } from "@/lib/analytics";
import type { Inventory, ProductState } from "@/lib/types";
import { productColor, productInk } from "@/lib/labels";
import { fmtInt, fmtPct } from "@/lib/format";
import { SALES_SHARE_DEFINITION } from "@/components/metrics";

// An OREO-style cookie with the rank in the middle.
export function CookieMedal({ rank, size = 56 }: { rank: number; size?: number }) {
  const r = 30;
  const dots = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return { x: 32 + Math.cos(a) * 24, y: 32 + Math.sin(a) * 24 };
  });
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-label={`Rank ${rank}`} role="img">
      <circle cx="32" cy="32" r={r} fill="#2a1d1a" />
      <circle cx="32" cy="32" r={r - 2} fill="none" stroke="#45322d" strokeWidth="2" />
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r="1.6" fill="#4d3933" />
      ))}
      <circle cx="32" cy="32" r="15" fill="#fbf8f1" />
      <text x="32" y="38.5" textAnchor="middle" fontSize="18" fontWeight="900" fill="#0a2463" fontFamily="inherit">
        {rank}
      </text>
    </svg>
  );
}

// Zig-zag crimp like the ends of a bar wrapper.
function Crimp({ side, color }: { side: "left" | "right"; color: string }) {
  const teeth = 10;
  const pts: string[] = [];
  for (let i = 0; i <= teeth * 2; i++) {
    const y = (i / (teeth * 2)) * 100;
    const x = i % 2 === 0 ? (side === "left" ? 0 : 100) : side === "left" ? 100 : 0;
    pts.push(`${x}% ${y}%`);
  }
  const poly = side === "left" ? `100% 0%, ${pts.join(", ")}, 100% 100%` : `0% 0%, ${pts.join(", ")}, 0% 100%`;
  return <div className="w-3 shrink-0 self-stretch" style={{ background: color, clipPath: `polygon(${poly})` }} aria-hidden="true" />;
}

// The inventory drawn as a bar wrapper: product segments for bars sold, white fudge for what's left.
export function WrapperInventory({ inventory, products }: { inventory: Inventory; products: ProductState[] }) {
  const total = Math.max(inventory.available_total, 1);
  const sold = products.filter((p) => p.bars_sold > 0);
  const first = sold[0] ? productColor(sold[0].id) : "#fbf8f1";
  const lastColor = inventory.remaining > 0 ? "#fbf8f1" : sold.length ? productColor(sold[sold.length - 1].id) : "#fbf8f1";
  return (
    <div>
      <div className="flex h-16 drop-shadow-[0_6px_10px_rgba(10,36,99,0.25)]">
        <Crimp side="left" color={first} />
        <div className="flex min-w-0 flex-1 overflow-hidden">
          {sold.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-center overflow-hidden text-[11px] font-black uppercase"
              style={{ width: `${(p.bars_sold / total) * 100}%`, background: productColor(p.id), color: productInk(p.id) }}
              title={`${p.name}: ${p.bars_sold} bars`}
            >
              <span className="truncate px-1">{p.bars_sold / total > 0.08 ? fmtInt(p.bars_sold) : ""}</span>
            </div>
          ))}
          {inventory.remaining > 0 && (
            <div className="flex flex-1 items-center justify-center bg-paper text-[11px] font-black uppercase text-navy">
              <span className="truncate px-1">{fmtInt(inventory.remaining)} left</span>
            </div>
          )}
        </div>
        <Crimp side="right" color={lastColor} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-white/85">
        {products.map((p) => (
          <span key={p.id} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: productColor(p.id) }} />
            {p.name}: {fmtInt(p.bars_sold)} bars
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-paper" />
          Remaining: {fmtInt(inventory.remaining)}
        </span>
      </div>
    </div>
  );
}

// Top three products by tickets. On wide screens #1 stands in the middle and tallest.
export function Podium({ rows }: { rows: ProductMetrics[] }) {
  const top = rows.slice(0, 3);
  const order = top.length === 3 ? [top[1], top[0], top[2]] : top;
  const lift: Record<number, string> = { 1: "md:mt-0", 2: "md:mt-6", 3: "md:mt-10" };
  return (
    <div className="grid gap-3 md:grid-cols-3 md:items-start">
      {order.map((p) => {
        const rank = rows.indexOf(p) + 1;
        const color = productColor(p.id);
        return (
          <div key={p.id} className={`${lift[rank] ?? ""} ${rank === 1 ? "order-first md:order-none" : ""}`}>
            <div className="print-break overflow-hidden rounded-3xl border border-line bg-paper shadow-sm">
              <div className="h-2" style={{ background: color }} />
              <div className="p-4">
                <div className="flex items-center gap-3">
                  <CookieMedal rank={rank} size={rank === 1 ? 60 : 48} />
                  <div className="min-w-0">
                    <div className="text-[11px] font-black uppercase tracking-wider text-muted">{rank === 1 ? "Top earner" : `#${rank} by tickets`}</div>
                    <div className="display truncate text-2xl leading-none text-navy">{p.name}</div>
                  </div>
                </div>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="display tabular text-5xl leading-none text-navy">{fmtInt(p.tickets)}</span>
                  <span className="text-sm font-black uppercase text-muted">tickets</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full" style={{ width: `${p.ticketShare}%`, background: color }} />
                </div>
                <div className="tabular mt-1 text-xs font-bold text-muted">{fmtPct(p.ticketShare)} of all tickets</div>
                <dl className="tabular mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-cream/70 py-2">
                    <dt className="text-[10px] font-black uppercase text-muted">Packages</dt>
                    <dd className="text-lg font-black text-navy">{fmtInt(p.packages)}</dd>
                  </div>
                  <div className="rounded-xl bg-cream/70 py-2">
                    <dt className="text-[10px] font-black uppercase text-muted">Bars</dt>
                    <dd className="text-lg font-black text-navy">{fmtInt(p.bars)}</dd>
                  </div>
                  <div className="rounded-xl bg-cream/70 py-2" title={SALES_SHARE_DEFINITION}>
                    <dt className="text-[10px] font-black uppercase text-muted">Sales incl. it</dt>
                    <dd className="text-lg font-black text-navy">{fmtPct(p.transactionShare)}</dd>
                    <dd className="text-[10px] font-bold text-muted">
                      {fmtInt(p.transactionsWith)} of {fmtInt(p.totalTransactions)}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="print-break rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur-sm">
      <div className="text-[11px] font-black uppercase tracking-wider text-blue-soft">{label}</div>
      <div className="display tabular mt-1 text-4xl leading-none text-white">{value}</div>
      {sub && <div className="mt-1 text-xs font-semibold text-white/70">{sub}</div>}
    </div>
  );
}
