"use client";

import { useEffect, useState } from "react";
import { useLive, useRpc } from "@/hooks/live";
import { useProfile } from "@/hooks/profile";
import type { AdminState, LiveState, TransactionRow } from "@/lib/types";
import { CATEGORY_LABELS, CUSTOMER_CATEGORIES } from "@/lib/labels";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { useExportCsv } from "@/hooks/export";
import { Button, Card, EmptyState, LoadingBlock, Notice, Spinner, inputClass, selectClass } from "@/components/ui";
import { Modal, VoidDialog } from "@/components/void-dialog";
import { PageHero } from "@/components/brand";

const PAGE = 50;

function StatusBadge({ status }: { status: TransactionRow["status"] }) {
  return status === "voided" ? (
    <span className="whitespace-nowrap rounded-md bg-bad-soft px-1.5 py-0.5 text-[11px] font-black uppercase text-bad">✕ Voided</span>
  ) : (
    <span className="whitespace-nowrap rounded-md bg-good-soft px-1.5 py-0.5 text-[11px] font-black uppercase text-good">✓ Completed</span>
  );
}

export default function HistoryPage() {
  const profile = useProfile();
  const isAdmin = profile.role === "admin";
  const { refreshAll } = useLive();
  const live = useRpc<LiveState>("get_live_state");
  const admin = useRpc<AdminState>("get_admin_state", undefined, isAdmin);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [product, setProduct] = useState("");
  const [category, setCategory] = useState("");
  const [seller, setSeller] = useState("");
  const [day, setDay] = useState("");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<TransactionRow | null>(null);
  const [voiding, setVoiding] = useState<TransactionRow | null>(null);
  const exporter = useExportCsv();

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => setPage(0), [search, status, product, category, seller, day]);

  // A calendar day in the device's time zone.
  const from = day ? new Date(`${day}T00:00:00`) : null;
  const to = from ? new Date(from.getTime() + 24 * 60 * 60 * 1000) : null;

  const list = useRpc<{ total: number; rows: TransactionRow[] }>("list_transactions", {
    p_search: search || null,
    p_status: status || null,
    p_product: product || null,
    p_category: category || null,
    p_seller: seller || null,
    p_from: from?.toISOString() ?? null,
    p_to: to?.toISOString() ?? null,
    p_limit: PAGE,
    p_offset: page * PAGE,
  });

  const products = live.data?.products ?? [];
  const tz = live.data?.settings.timezone;
  const undoMinutes = live.data?.settings.seller_undo_minutes ?? 0;
  const canVoid = (t: TransactionRow) =>
    t.status === "completed" && (isAdmin || (t.seller_id === profile.id && Date.now() - new Date(t.created_at).getTime() < undoMinutes * 60_000));
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const filtersOn = !!(search || status || product || category || seller || day);

  return (
    <div className="space-y-3">
      <PageHero
        kicker="Every sale"
        title="Transaction history"
        subtitle={isAdmin ? "All sales, newest first. Voided sales stay listed but never count in totals." : "Sales you recorded, newest first."}
      >
        {isAdmin && (
          <Button variant="primary" onClick={() => exporter.run(live.data)} disabled={exporter.busy || !live.data}>
            {exporter.busy && <Spinner />} Export CSV
          </Button>
        )}
      </PageHero>
      {exporter.error && <Notice tone="bad">{exporter.error}</Notice>}

      <Card className="no-print grid grid-cols-2 gap-2 p-3 md:grid-cols-6">
        <input
          className={`${inputClass} col-span-2 md:col-span-2`}
          placeholder="Search NetID or name"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          aria-label="Search by NetID or customer name"
        />
        <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="voided">Voided</option>
        </select>
        <select className={selectClass} value={product} onChange={(e) => setProduct(e.target.value)} aria-label="Product">
          <option value="">All products</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select className={selectClass} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Customer category">
          <option value="">All categories</option>
          {CUSTOMER_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
          <option value="not_specified">Not specified</option>
        </select>
        <input className={inputClass} type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Date" />
        {isAdmin && (
          <select className={`${selectClass} col-span-2 md:col-span-2`} value={seller} onChange={(e) => setSeller(e.target.value)} aria-label="Seller">
            <option value="">All sellers</option>
            {admin.data?.members
              .filter((m) => m.role !== "pending")
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
          </select>
        )}
        {filtersOn && (
          <Button
            variant="ghost"
            className="col-span-2 md:col-span-1"
            onClick={() => {
              setSearchInput("");
              setStatus("");
              setProduct("");
              setCategory("");
              setSeller("");
              setDay("");
            }}
          >
            Clear filters
          </Button>
        )}
      </Card>

      {list.loading && !list.data ? (
        <LoadingBlock />
      ) : list.error && !list.data ? (
        <Notice tone="bad">{list.error.message}</Notice>
      ) : !list.data?.rows.length ? (
        <EmptyState title={filtersOn ? "No sales match these filters" : "No sales yet"} />
      ) : (
        <>
          <div className="text-sm font-semibold text-muted">
            {fmtInt(total)} {total === 1 ? "sale" : "sales"}
            {filtersOn ? " match" : ""}
          </div>

          {/* Phone: cards */}
          <ul className="space-y-2 md:hidden">
            {list.data.rows.map((t) => (
              <li key={t.id}>
                <button className="w-full rounded-2xl border border-line bg-paper p-3 text-left" onClick={() => setDetail(t)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-black text-navy">
                      #{t.id} · {t.netid}
                    </span>
                    <StatusBadge status={t.status} />
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {fmtDateTime(t.created_at, tz)} · by {t.seller_name}
                    {t.customer_name ? ` · ${t.customer_name}` : ""}
                  </div>
                  <div className={`tabular mt-1.5 text-sm ${t.status === "voided" ? "text-muted line-through" : "text-ink"}`}>
                    {products.map((p) => `${t.items[p.id] ?? 0} ${p.name}`).join(" · ")}
                  </div>
                  <div className="tabular mt-1 text-sm font-bold text-navy">
                    {t.total_bars} bars · {t.total_tickets} tickets
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {/* Tablet / desktop: table */}
          <div className="hidden overflow-x-auto rounded-2xl border border-line bg-paper md:block">
            <table className="tabular w-full text-sm">
              <thead>
                <tr className="bg-navy text-left text-[11px] font-black uppercase tracking-wider text-white/85">
                  <th className="px-3 py-2">ID</th>
                  <th className="px-2 py-2">Date & time</th>
                  <th className="px-2 py-2">NetID</th>
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2">Category</th>
                  {products.map((p) => (
                    <th key={p.id} className="px-2 py-2 text-right">
                      {p.name}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right">Bars</th>
                  <th className="px-2 py-2 text-right">Tickets</th>
                  <th className="px-2 py-2">Seller</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((t) => (
                  <tr key={t.id} className={`border-b border-line hover:bg-blue-soft/40 ${t.status === "voided" ? "text-muted" : ""}`}>
                    <td className="px-3 py-2 font-bold text-navy">#{t.id}</td>
                    <td className="whitespace-nowrap px-2 py-2">{fmtDateTime(t.created_at, tz)}</td>
                    <td className="px-2 py-2 font-bold">{t.netid}</td>
                    <td className="px-2 py-2">{t.customer_name ?? "—"}</td>
                    <td className="px-2 py-2">{t.customer_category ? CATEGORY_LABELS[t.customer_category] : "—"}</td>
                    {products.map((p) => (
                      <td key={p.id} className="px-2 py-2 text-right">
                        {t.items[p.id] ?? 0}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-right font-bold">{t.total_bars}</td>
                    <td className="px-2 py-2 text-right font-bold">{t.total_tickets}</td>
                    <td className="whitespace-nowrap px-2 py-2">{t.seller_name}</td>
                    <td className="px-2 py-2">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button className="font-bold text-blue" onClick={() => setDetail(t)}>
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
                ← Newer
              </Button>
              <span className="text-sm font-bold text-navy">
                Page {page + 1} of {pages}
              </span>
              <Button variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
                Older →
              </Button>
            </div>
          )}
        </>
      )}

      {detail && (
        <Modal title={`Sale #${detail.id}`} onClose={() => setDetail(null)}>
          <dl className="tabular grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted">Status</dt>
            <dd>
              <StatusBadge status={detail.status} />
            </dd>
            <dt className="text-muted">Recorded</dt>
            <dd>{new Date(detail.created_at).toLocaleString("en-US", { timeZone: tz })}</dd>
            <dt className="text-muted">Seller</dt>
            <dd>{detail.seller_name}</dd>
            <dt className="text-muted">NetID</dt>
            <dd className="font-bold">{detail.netid}</dd>
            <dt className="text-muted">Name</dt>
            <dd>{detail.customer_name ?? "Not provided"}</dd>
            <dt className="text-muted">Category</dt>
            <dd>{detail.customer_category ? CATEGORY_LABELS[detail.customer_category] : "Not provided"}</dd>
            {products.map((p) => {
              // Show the package size this sale was recorded at, not today's.
              const unit = detail.item_units?.[p.id] ?? { bars: p.bars_per_unit, tickets: p.tickets_per_unit };
              return (
                <div key={p.id} className="contents">
                  <dt className="text-muted">{p.name}</dt>
                  <dd>
                    {detail.items[p.id] ?? 0} × ({unit.bars} bar{unit.bars > 1 ? "s" : ""}, {unit.tickets} tickets)
                  </dd>
                </div>
              );
            })}
            <dt className="text-muted">Bars consumed</dt>
            <dd className="font-bold">{detail.total_bars}</dd>
            <dt className="text-muted">Tickets charged</dt>
            <dd className="font-bold">{detail.total_tickets}</dd>
            {detail.status === "voided" && (
              <>
                <dt className="text-muted">Voided</dt>
                <dd>
                  {new Date(detail.voided_at!).toLocaleString("en-US", { timeZone: tz })} by {detail.voided_by_name}
                </dd>
                <dt className="text-muted">Reason</dt>
                <dd>{detail.void_reason}</dd>
              </>
            )}
          </dl>
          {canVoid(detail) && (
            <Button
              variant="danger"
              className="mt-4 w-full"
              onClick={() => {
                setVoiding(detail);
                setDetail(null);
              }}
            >
              Void this sale
            </Button>
          )}
        </Modal>
      )}

      {voiding && (
        <VoidDialog
          transactionId={voiding.id}
          summary={`${voiding.netid} · ${voiding.total_tickets} tickets · ${voiding.total_bars} bars`}
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null);
            refreshAll();
          }}
        />
      )}
    </div>
  );
}
