"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { callRpc, useLive, useRpc } from "@/hooks/live";
import { useProfile } from "@/hooks/profile";
import type { CustomerCategory, LiveState, ProductState, SaleResult, TransactionRow } from "@/lib/types";
import type { AppError } from "@/lib/errors";
import { MAX_QTY, computeTotals, isValidNetid, itemsPayload, netidLabel, normalizeNetid, type Quantities } from "@/lib/sales";
import { CATEGORY_LABELS, CUSTOMER_CATEGORIES, productColor, productInk } from "@/lib/labels";
import { fmtInt, fmtTime, plural } from "@/lib/format";
import { InventoryPanel } from "@/components/inventory-panel";
import { BarStack } from "@/components/brand";
import { Button, LoadingBlock, Notice, Spinner, inputClass } from "@/components/ui";
import { Modal, VoidDialog } from "@/components/void-dialog";

function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  const b = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface DuplicatePrompt {
  message: string;
}

function ProductCard({
  product,
  qty,
  canAdd,
  onChange,
}: {
  product: ProductState;
  qty: number;
  canAdd: boolean;
  onChange: (q: number) => void;
}) {
  const color = productColor(product.id);
  const disabled = !product.active;
  const selected = qty > 0;
  return (
    <div
      className={`relative flex items-center gap-3 rounded-2xl border-2 bg-paper p-2.5 transition ${
        disabled ? "opacity-50" : "active:scale-[0.99]"
      }`}
      style={{ borderColor: selected ? color : "var(--color-line)", background: selected ? `color-mix(in srgb, ${color} 8%, #fbf8f1)` : undefined }}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-not-allowed"
        disabled={disabled || !canAdd || qty >= MAX_QTY}
        onClick={() => onChange(qty + 1)}
        aria-label={`Add one ${product.name}`}
      >
        <BarStack count={product.bars_per_unit} color={color} />
        <span className="min-w-0">
          <span className="display line-clamp-2 block text-[17px] leading-[1.05] text-navy">{product.name}</span>
          <span className="block text-[13px] font-semibold text-muted">
            <b className="text-ink">{product.tickets_per_unit} tickets</b> · {plural(product.bars_per_unit, "bar")}
            {disabled && <span className="ml-1 font-black text-bad">· Unavailable</span>}
            {!disabled && !canAdd && qty === 0 && <span className="ml-1 font-black text-warn">· Not enough stock</span>}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="h-11 w-11 rounded-xl border-2 border-line bg-white text-2xl font-black text-navy disabled:opacity-30"
          disabled={qty === 0}
          onClick={() => onChange(qty - 1)}
          aria-label={`Remove one ${product.name}`}
        >
          −
        </button>
        <span className="tabular w-7 text-center text-2xl font-black text-navy" aria-live="polite" aria-label={`${product.name} quantity`}>
          {qty}
        </span>
        <button
          type="button"
          className="h-11 w-11 rounded-xl text-2xl font-black disabled:opacity-30"
          style={{ background: color, color: productInk(product.id) }}
          disabled={disabled || !canAdd || qty >= MAX_QTY}
          onClick={() => onChange(qty + 1)}
          aria-label={`Add one ${product.name}`}
          data-testid={`plus-${product.id}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

export default function SellPage() {
  const profile = useProfile();
  const { refreshAll } = useLive();
  const live = useRpc<LiveState>("get_live_state");
  const recent = useRpc<{ total: number; rows: TransactionRow[] }>("list_transactions", { p_seller: profile.id, p_limit: 5 });

  const [netid, setNetid] = useState("");
  const [netidTouched, setNetidTouched] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<CustomerCategory | null>(null);
  const [showOptional, setShowOptional] = useState(false);
  const [qty, setQty] = useState<Quantities>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [dupPrompt, setDupPrompt] = useState<DuplicatePrompt | null>(null);
  const [success, setSuccess] = useState<SaleResult | null>(null);
  const [voiding, setVoiding] = useState<TransactionRow | null>(null);

  const requestId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const netidRef = useRef<HTMLInputElement>(null);

  // Any edit to the draft makes it a new sale attempt with a new idempotency key.
  useEffect(() => {
    requestId.current = null;
  }, [netid, name, category, qty]);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 8000);
    return () => clearTimeout(t);
  }, [success]);

  const products = useMemo(() => live.data?.products ?? [], [live.data]);
  const totals = computeTotals(products, qty);
  const remaining = live.data?.inventory.remaining ?? 0;
  const after = remaining - totals.bars;
  const insufficient = totals.bars > 0 && after < 0;
  // NetID is optional: blank is fine, but anything typed must look like a NetID.
  const netidOk = !netid.trim() || isValidNetid(netid);
  const canSubmit = !!live.data && totals.bars > 0 && netidOk && !insufficient && !submitting;

  function setProductQty(id: string, q: number) {
    setError(null);
    setQty((prev) => ({ ...prev, [id]: Math.max(0, Math.min(MAX_QTY, q)) }));
  }

  function resetDraft() {
    setQty({});
    setNetid("");
    setNetidTouched(false);
    setName("");
    setCategory(null);
    setShowOptional(false);
    requestId.current = null;
  }

  async function submit(confirmDuplicate = false) {
    setNetidTouched(true);
    if (inFlight.current) return;
    if (!netidOk) {
      setError({ code: "INVALID_NETID", message: "That doesn't look like a Cornell NetID (for example abc123). Fix it or leave it blank." });
      netidRef.current?.focus();
      return;
    }
    if (totals.bars === 0) {
      setError({ code: "EMPTY_SALE", message: "Select at least one product." });
      return;
    }
    if (insufficient) return;

    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    requestId.current ??= newRequestId();
    const args = {
      p_client_request_id: requestId.current,
      p_netid: normalizeNetid(netid) || null,
      p_items: itemsPayload(products, qty),
      p_customer_name: name.trim() || null,
      p_customer_category: category,
      p_confirm_duplicate: confirmDuplicate,
    };

    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await callRpc<SaleResult>("record_sale", args);
          setSuccess(res);
          setDupPrompt(null);
          resetDraft();
          navigator.vibrate?.(40);
          refreshAll();
          break;
        } catch (e) {
          const err = e as AppError;
          // Same request id on retry, so a sale that reached the server is never recorded twice.
          if (err.network && attempt < 2) {
            await sleep(700 * (attempt + 1));
            continue;
          }
          if (err.code === "POSSIBLE_DUPLICATE") {
            setDupPrompt({ message: err.message });
          } else {
            setError(err);
            if (err.code === "INSUFFICIENT_STOCK" || err.code === "PRODUCT_UNAVAILABLE") refreshAll();
          }
          break;
        }
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  if (live.loading && !live.data) return <LoadingBlock label="Loading inventory…" />;
  if (!live.data) return <Notice tone="bad">{live.error?.message ?? "Could not load inventory."}</Notice>;

  const undoMinutes = live.data.settings.seller_undo_minutes;
  const canUndo = (t: TransactionRow) =>
    t.status === "completed" &&
    (profile.role === "admin" || (t.seller_id === profile.id && Date.now() - new Date(t.created_at).getTime() < undoMinutes * 60_000));

  return (
    <div className="mx-auto max-w-xl pb-36">
      <InventoryPanel inventory={live.data.inventory} products={products} />

      {success && (
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-good px-4 py-3 text-white shadow-lg" role="status" data-testid="sale-success">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-xl font-black text-good">✓</span>
          <div className="min-w-0 flex-1">
            <div className="display text-lg leading-tight">
              {success.duplicate_request ? "Already recorded" : "Sale recorded"} · {success.transaction.total_tickets} tickets
            </div>
            <div className="truncate text-[13px] font-semibold text-white/85">
              #{success.transaction.id} · {netidLabel(success.transaction.netid)} · {plural(success.transaction.total_bars, "bar")} ·{" "}
              {fmtInt(success.inventory.remaining)} left
            </div>
          </div>
          {canUndo(success.transaction) && (
            <button className="rounded-lg bg-white/15 px-3 py-2 text-sm font-black" onClick={() => setVoiding(success.transaction)}>
              Undo
            </button>
          )}
        </div>
      )}

      <form
        className="mt-3 space-y-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="block">
          <span className="sr-only">Customer Cornell NetID (optional)</span>
          <div className="relative">
            <input
              ref={netidRef}
              data-testid="netid"
              className={`${inputClass} h-13 pl-[86px] text-lg font-bold lowercase tracking-wide ${
                netidTouched && netid && !netidOk ? "border-bad" : ""
              }`}
              placeholder="abc123"
              value={netid}
              onChange={(e) => {
                setNetid(e.target.value);
                setError(null);
              }}
              onBlur={() => setNetidTouched(true)}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="done"
              maxLength={40}
              inputMode="text"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-black uppercase leading-tight text-muted">
              NetID
              <br />
              <span className="text-blue">optional</span>
            </span>
          </div>
          {netidTouched && netid && !netidOk && <span className="mt-1 block text-xs font-bold text-bad">Letters then digits, like abc123.</span>}
        </label>

        <div className="space-y-2">
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              qty={qty[p.id] ?? 0}
              canAdd={after - p.bars_per_unit >= 0}
              onChange={(q) => setProductQty(p.id, q)}
            />
          ))}
        </div>

        <div className="rounded-2xl border border-line bg-paper">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-bold text-navy"
            onClick={() => setShowOptional(!showOptional)}
            aria-expanded={showOptional}
          >
            <span>
              Customer name & category <span className="font-semibold text-muted">(optional)</span>
              {(name || category) && <span className="ml-2 rounded-full bg-blue-soft px-2 py-0.5 text-xs text-navy">added</span>}
            </span>
            <span aria-hidden="true">{showOptional ? "▴" : "▾"}</span>
          </button>
          {showOptional && (
            <div className="space-y-2.5 border-t border-line p-3">
              <input
                className={inputClass}
                placeholder="Customer name (optional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoComplete="off"
              />
              <div className="grid grid-cols-2 gap-1.5">
                {CUSTOMER_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(category === c ? null : c)}
                    className={`rounded-xl border-2 px-2 py-2.5 text-sm font-bold transition ${
                      category === c ? "border-navy bg-navy text-white" : "border-line bg-white text-navy"
                    }`}
                    aria-pressed={category === c}
                  >
                    {CATEGORY_LABELS[c]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {error && (
          <div data-testid="sale-error">
            <Notice tone="bad">{error.message}</Notice>
          </div>
        )}

        {/* Sticky summary and submit */}
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/95 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur">
          <div className="mx-auto max-w-xl">
            <div className="tabular mb-2 grid grid-cols-3 text-center">
              <div>
                <div className="text-xl font-black text-navy">{fmtInt(totals.bars)}</div>
                <div className="text-[11px] font-bold uppercase text-muted">bars</div>
              </div>
              <div>
                <div className="text-xl font-black text-navy">{fmtInt(totals.tickets)}</div>
                <div className="text-[11px] font-bold uppercase text-muted">tickets</div>
              </div>
              <div>
                <div className={`text-xl font-black ${insufficient ? "text-bad" : "text-navy"}`}>{fmtInt(after)}</div>
                <div className="text-[11px] font-bold uppercase text-muted">left after</div>
              </div>
            </div>
            {insufficient && (
              <div className="mb-2 rounded-lg bg-bad-soft px-3 py-1.5 text-center text-sm font-bold text-bad" role="alert" data-testid="stock-warning">
                Not enough stock: {fmtInt(remaining)} left, this sale needs {fmtInt(totals.bars)}.
              </div>
            )}
            <Button type="submit" className="h-14 w-full rounded-2xl text-lg" disabled={!canSubmit} data-testid="submit-sale">
              {submitting ? (
                <>
                  <Spinner className="h-5 w-5" /> Recording…
                </>
              ) : totals.bars === 0 ? (
                "Select products"
              ) : !netidOk ? (
                "Fix NetID to record"
              ) : (
                `Record sale · ${totals.tickets} tickets`
              )}
            </Button>
          </div>
        </div>
      </form>

      <section className="mt-5">
        <h2 className="mb-2 text-xs font-black uppercase tracking-wider text-muted">My recent sales</h2>
        {!recent.data?.rows.length ? (
          <p className="text-sm text-muted">No sales recorded by you yet.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
            {recent.data.rows.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-navy">
                    #{t.id} · {netidLabel(t.netid)}{" "}
                    {t.status === "voided" && <span className="rounded bg-bad-soft px-1.5 text-xs font-black uppercase text-bad">voided</span>}
                  </div>
                  <div className="text-xs text-muted">
                    {fmtTime(t.created_at)} · {t.total_tickets} tickets · {plural(t.total_bars, "bar")}
                  </div>
                </div>
                {canUndo(t) && (
                  <Button variant="outline" className="px-3 py-1.5 text-xs" onClick={() => setVoiding(t)}>
                    Undo
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {profile.role === "seller" && (
          <p className="mt-2 text-xs text-muted">You can undo your own sales for {undoMinutes} minutes. After that, ask an admin to void them.</p>
        )}
      </section>

      {dupPrompt && (
        <Modal title="Same NetID just bought" onClose={() => setDupPrompt(null)}>
          <p className="text-sm text-ink">{dupPrompt.message}</p>
          <p className="mt-2 text-sm text-muted">If this is a second purchase, record it. If it was an accidental repeat, cancel.</p>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setDupPrompt(null)}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={submitting} onClick={() => submit(true)}>
              {submitting && <Spinner />} Record anyway
            </Button>
          </div>
        </Modal>
      )}

      {voiding && (
        <VoidDialog
          transactionId={voiding.id}
          summary={`${netidLabel(voiding.netid)} · ${voiding.total_tickets} tickets · ${plural(voiding.total_bars, "bar")}`}
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null);
            setSuccess(null);
            refreshAll();
          }}
        />
      )}
    </div>
  );
}
