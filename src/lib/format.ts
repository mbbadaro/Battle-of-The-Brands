export const fmtInt = (n: number) => new Intl.NumberFormat("en-US").format(n);

export const fmtPct = (n: number) => `${n.toFixed(1)}%`;

export const fmtDec = (n: number, digits = 2) => n.toFixed(digits);

export function fmtTime(iso: string | null | undefined, timeZone?: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(iso));
}

export function fmtDateTime(iso: string | null | undefined, timeZone?: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function plural(n: number, one: string, many = one + "s") {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}
