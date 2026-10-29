import type { TransactionRow } from "./types";

interface CsvProduct {
  id: string;
  name: string;
}

const CATEGORY_TEXT: Record<string, string> = {
  first_year_mba: "First-Year MBA",
  second_year_mba: "Second-Year MBA",
  faculty: "Faculty",
  other_unknown: "Other / Unknown",
};

// Quotes every cell and neutralises spreadsheet formula injection (=, +, -, @ at the start).
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s) && typeof value === "string") s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function formatLocal(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

// One row per transaction, voided ones included with their status, so the file mirrors the table.
export function transactionsToCsv(rows: TransactionRow[], products: CsvProduct[], timeZone: string): string {
  const header = [
    "transaction_id",
    "created_at_utc",
    `created_at_local (${timeZone})`,
    "netid",
    "customer_name",
    "customer_category",
    ...products.map((p) => `${p.name} (packages)`),
    "bars_consumed",
    "tickets_charged",
    "seller",
    "status",
    "voided_at_utc",
    "voided_by",
    "void_reason",
  ];
  const body = rows.map((r) => [
    r.id,
    r.created_at,
    formatLocal(r.created_at, timeZone),
    r.netid ?? "",
    r.customer_name ?? "",
    r.customer_category ? CATEGORY_TEXT[r.customer_category] ?? r.customer_category : "",
    ...products.map((p) => r.items[p.id] ?? 0),
    r.total_bars,
    r.total_tickets,
    r.seller_name,
    r.status,
    r.voided_at ?? "",
    r.voided_by_name ?? "",
    r.void_reason ?? "",
  ]);
  return toCsv(header, body);
}

// Minimal RFC 4180 parser, used by tests to check exports round-trip.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob(["﻿" + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
