"use client";

import { useState } from "react";
import { callRpc } from "@/hooks/live";
import type { LiveState, TransactionRow } from "@/lib/types";
import type { AppError } from "@/lib/errors";
import { downloadText, transactionsToCsv } from "@/lib/csv";

// Downloads every transaction (completed and voided) straight from the database as CSV.
export function useExportCsv() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(live: LiveState | null) {
    if (!live) return;
    setBusy(true);
    setError(null);
    try {
      const rows = await callRpc<TransactionRow[]>("export_transactions", {});
      const csv = transactionsToCsv(rows, live.products, live.settings.timezone);
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      downloadText(`battle-of-the-brands-transactions-${stamp}.csv`, csv);
    } catch (e) {
      setError((e as AppError).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}
