// Brand pieces based on the team's "OREO meets protein." campaign art (public/promo.jpg).
import type { ReactNode } from "react";

// Red vertical CLIF badge next to the BUILDERS wordmark, as on the wrapper.
export function ClifBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center justify-center rounded-[3px] bg-clif px-[3px] py-[5px] ${className}`} aria-hidden="true">
      <span className="display text-[10px] leading-none tracking-[0.02em] text-white [writing-mode:vertical-rl] rotate-180">CLIF</span>
    </span>
  );
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <ClifBadge />
      <div className="leading-none">
        <div className={`display text-white ${compact ? "text-[19px]" : "text-2xl"}`}>Builders</div>
        <div className={`text-[9px] font-extrabold tracking-[0.28em] text-white/85 ${compact ? "hidden md:block" : ""}`}>PROTEIN</div>
      </div>
      <span className={`ml-1 rounded-md border border-white/60 px-1.5 py-[3px] text-[9px] font-black uppercase leading-[1.05] tracking-wider text-white ${compact ? "hidden lg:inline-block" : "inline-block"}`}>
        Battle of
        <br />
        the Brands
      </span>
    </div>
  );
}

// A row of N small wrapped bars, used on product cards (1, 3 or 5 bars).
export function BarStack({ count, color }: { count: number; color: string }) {
  const shown = Math.min(count, 5);
  return (
    <div className="flex h-11 w-13 shrink-0 flex-col items-center justify-center gap-[3px] rounded-xl bg-navy" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => (
        <span
          key={i}
          className="block rounded-[3px]"
          style={{ width: 38 - (shown - 1) * 2, height: shown === 1 ? 12 : shown === 3 ? 7 : 4.5, background: color }}
        />
      ))}
    </div>
  );
}

// Campaign image for the sign-in and waiting screens.
export function HeroBanner() {
  return (
    <div className="overflow-hidden rounded-3xl bg-navy shadow-lg">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/promo.jpg" alt="OREO meets protein: CLIF Builders White Fudge OREO flavor protein bar" className="block aspect-[1717/916] w-full object-cover" />
    </div>
  );
}

// Page header in the campaign style: the ad image behind a navy gradient, a red kicker, and room for actions.
export function PageHero({ kicker, title, subtitle, children }: { kicker: string; title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-navy text-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/promo.jpg" alt="" className="absolute inset-0 h-full w-full object-cover object-right opacity-90" />
      <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/90 to-navy/25" />
      <div className="relative flex flex-wrap items-end justify-between gap-4 p-5 sm:p-6">
        <div className="min-w-0">
          <div className="inline-block rounded-full bg-white px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.2em] text-navy">{kicker}</div>
          <h1 className="display mt-2 text-4xl leading-[0.9] sm:text-5xl">{title}</h1>
          {subtitle && <div className="mt-1.5 text-sm font-semibold text-white/80">{subtitle}</div>}
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </div>
    </section>
  );
}
