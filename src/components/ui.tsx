import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "navy" | "ghost" | "danger" | "outline";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-blue text-white hover:bg-blue-deep disabled:bg-[#9db8ef]",
  navy: "bg-navy text-white hover:bg-navy-2 disabled:opacity-50",
  ghost: "bg-transparent text-navy hover:bg-navy/5 disabled:opacity-40",
  outline: "border-2 border-navy/15 bg-paper text-navy hover:border-navy/40 disabled:opacity-40",
  danger: "bg-bad text-white hover:brightness-110 disabled:opacity-50",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-paper p-4 ${className}`}>{children}</section>;
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-2">
      <h2 className="display flex items-center gap-2 text-lg text-navy">
        <span className="h-4 w-1.5 rounded-sm bg-clif" aria-hidden="true" />
        {children}
      </h2>
      {aside}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "good" | "warn" | "bad"; children: ReactNode }) {
  const tones = {
    info: "bg-blue-soft text-navy border-blue/30",
    good: "bg-good-soft text-good border-good/30",
    warn: "bg-warn-soft text-warn border-warn/30",
    bad: "bg-bad-soft text-bad border-bad/30",
  };
  const icons = { info: "ℹ", good: "✓", warn: "!", bad: "✕" };
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`flex gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${tones[tone]}`}>
      <span aria-hidden="true" className="font-black">
        {icons[tone]}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} aria-hidden="true" />;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border-2 border-dashed border-line px-4 py-8 text-center">
      <div className="font-bold text-navy">{title}</div>
      {hint && <div className="mt-1 max-w-xs text-sm text-muted">{hint}</div>}
    </div>
  );
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center gap-2 text-sm font-semibold text-muted">
      <Spinner /> {label}
    </div>
  );
}

export const inputClass =
  "w-full rounded-xl border-2 border-line bg-white px-3 py-2.5 text-base text-ink outline-none transition placeholder:text-muted/60 focus:border-blue";

export const selectClass = inputClass + " appearance-none pr-8";
