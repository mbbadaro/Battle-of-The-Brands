"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ProductMetrics, TimelinePoint } from "@/lib/analytics";
import type { CategoryRow } from "@/lib/types";
import { CATEGORY_LABELS, productColor } from "@/lib/labels";
import { fmtInt } from "@/lib/format";

const AXIS = { fontSize: 12, fill: "#586178", fontWeight: 600 };
const GRID = "#e2d8c3";

function TooltipBox({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-2 text-xs shadow-lg">
      <div className="mb-0.5 font-black text-navy">{title}</div>
      {lines.map((l) => (
        <div key={l} className="font-semibold text-ink">
          {l}
        </div>
      ))}
    </div>
  );
}

// Bar per product. Colors follow the product (fixed order), and values are direct-labeled.
export function ProductBarChart({ rows, metric, unit }: { rows: ProductMetrics[]; metric: "packages" | "tickets" | "bars"; unit: string }) {
  const data = rows.map((r) => ({ id: r.id, name: r.name, value: r[metric], r }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 22, right: 8, left: -12, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="0" />
          <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} interval={0} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} width={44} />
          <Tooltip
            cursor={{ fill: "rgba(11,31,75,0.05)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = (payload[0].payload as { r: ProductMetrics }).r;
              return (
                <TooltipBox
                  title={r.name}
                  lines={[`${fmtInt(r.packages)} packages`, `${fmtInt(r.bars)} bars`, `${fmtInt(r.tickets)} tickets (${r.ticketShare.toFixed(1)}%)`]}
                />
              );
            }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false} name={unit} maxBarSize={88}>
            {data.map((d) => (
              <Cell key={d.id} fill={productColor(d.id)} />
            ))}
            <LabelList dataKey="value" position="top" style={{ fontSize: 13, fontWeight: 800, fill: "#0a1633" }} formatter={(v) => fmtInt(Number(v))} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TimelineChart({ points, interval }: { points: TimelinePoint[]; interval: string }) {
  return (
    <div className="h-60 w-full">
      <ResponsiveContainer>
        <BarChart data={points} margin={{ top: 10, right: 8, left: -12, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} width={44} />
          <Tooltip
            cursor={{ fill: "rgba(11,31,75,0.05)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as TimelinePoint;
              return (
                <TooltipBox
                  title={`${p.label} (${interval})`}
                  lines={[
                    `${fmtInt(p.tickets)} tickets`,
                    `${fmtInt(p.transactions)} sales · ${fmtInt(p.bars)} bars`,
                    `Running total: ${fmtInt(p.cumulativeTickets)} tickets`,
                  ]}
                />
              );
            }}
          />
          <Bar dataKey="tickets" fill="#1e6bff" radius={[4, 4, 0, 0]} isAnimationActive={false} name="Tickets" maxBarSize={56} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryChart({ rows }: { rows: CategoryRow[] }) {
  const data = rows.map((r) => ({ ...r, label: CATEGORY_LABELS[r.category] }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, left: 8, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="label" tick={AXIS} axisLine={false} tickLine={false} width={112} />
          <Tooltip
            cursor={{ fill: "rgba(11,31,75,0.05)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0].payload as CategoryRow & { label: string };
              return <TooltipBox title={r.label} lines={[`${fmtInt(r.customers)} customers`, `${fmtInt(r.transactions)} sales`, `${fmtInt(r.tickets)} tickets`]} />;
            }}
          />
          <Bar dataKey="customers" fill="#0b1f4b" radius={[0, 4, 4, 0]} isAnimationActive={false} name="Customers">
            <LabelList dataKey="customers" position="right" style={{ fontSize: 13, fontWeight: 800, fill: "#0a1633" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
