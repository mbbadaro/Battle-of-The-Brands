"use client";

import { useState } from "react";
import { callRpc } from "@/hooks/live";
import type { AppError } from "@/lib/errors";
import { Button, Notice, Spinner, inputClass } from "./ui";

const QUICK_REASONS = ["Wrong product tapped", "Wrong NetID", "Customer cancelled", "Duplicate entry", "Test entry"];

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-paper p-5 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="display text-xl text-navy">{title}</h2>
          <button className="-mr-1 rounded-lg px-2 text-2xl leading-none text-muted" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function VoidDialog({
  transactionId,
  summary,
  onClose,
  onDone,
}: {
  transactionId: number;
  summary: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = reason.trim().length >= 3;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await callRpc("void_transaction", { p_transaction_id: transactionId, p_reason: reason.trim() });
      onDone();
    } catch (e) {
      setError((e as AppError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Void sale #${transactionId}`} onClose={onClose}>
      <p className="text-sm text-muted">{summary}</p>
      <p className="mt-2 text-sm text-muted">The bars go back into inventory and the tickets come off every total. The sale stays in the history as voided.</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {QUICK_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReason(r)}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold ${reason === r ? "border-navy bg-navy text-white" : "border-line bg-white text-navy"}`}
          >
            {r}
          </button>
        ))}
      </div>
      <label className="mt-3 block">
        <span className="mb-1 block text-sm font-bold text-navy">Reason (required)</span>
        <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Why is this sale being voided?" />
      </label>
      {error && (
        <div className="mt-3">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onClose}>
          Keep sale
        </Button>
        <Button variant="danger" className="flex-1" disabled={!valid || busy} onClick={submit}>
          {busy && <Spinner />} Void sale
        </Button>
      </div>
    </Modal>
  );
}
