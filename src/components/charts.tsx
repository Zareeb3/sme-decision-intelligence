"use client";

/**
 * Recharts wrappers. Rules applied (see docs/ARCHITECTURE.md, "Charts"):
 *  - one y-axis per chart; measures in different units never share a chart,
 *  - categorical colours were checked for colour-blind separation
 *    (sales #0096a3 vs collections #5b5fc7),
 *  - targets are dashed neutral reference lines, not a third colour,
 *  - every chart has a hover tooltip and a legend when it shows 2+ series.
 */
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompact, formatMonth, formatPKR, formatPct } from "@/lib/analytics/format";

export const SERIES = {
  sales: "#0096a3",
  collections: "#5b5fc7",
  target: "#5a6571",
  grid: "#e6eae8",
  axis: "#8a949d",
};

/** Single-hue sequential ramp (light → dark) for ordered severity such as aging. */
export const AGING_RAMP = ["#c9d3d1", "#e7b9a4", "#d68f74", "#bb6146", "#8f3a24"];

/** Minimal shape of the props Recharts passes to a custom tooltip `content` renderer. */
type TipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: any }>; label?: unknown };

const axisProps = { stroke: SERIES.axis, fontSize: 11, tickLine: false, axisLine: false } as const;

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string; dashed?: boolean }[] }) {
  return (
    <div className="rounded-md border border-line-strong bg-surface px-3 py-2 text-[0.78rem] shadow-md">
      <p className="mb-1 font-medium text-ink">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-muted">
          {r.color && <span className="inline-block h-0.5 w-3" style={{ background: r.color, borderTop: r.dashed ? `2px dashed ${r.color}` : undefined, height: r.dashed ? 0 : 2 }} />}
          <span>{r.label}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums text-ink">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

const periodLabel = (p: string) => (/^\d{4}-\d{2}$/.test(p) ? formatMonth(p) : p.replace("-", " "));

interface TrendPoint {
  period: string;
  netSales: number;
  collections: number;
  salesTarget: number | null;
}

/** Net sales (bars) and collections (line), both PKR, with the sales target as a dashed reference. */
export function SalesCollectionsChart({ data, height = 280 }: { data: TrendPoint[]; height?: number }) {
  const hasTarget = data.some((d) => d.salesTarget !== null);
  return (
    <div style={{ height }} role="img" aria-label="Net sales and collections by period, with sales target">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={SERIES.grid} />
          <XAxis dataKey="period" tickFormatter={(p: string) => periodLabel(p).replace(" 20", " ’")} {...axisProps} minTickGap={12} />
          <YAxis tickFormatter={(v: number) => formatCompact(v)} {...axisProps} width={48} />
          <Tooltip
            cursor={{ fill: "rgba(0,150,163,0.06)" }}
            content={({ active, payload, label }: TipProps) =>
              active && payload?.length ? (
                <TooltipBox
                  title={periodLabel(String(label))}
                  rows={[
                    { label: "Net sales", value: formatPKR(payload[0].payload.netSales), color: SERIES.sales },
                    { label: "Collections", value: formatPKR(payload[0].payload.collections), color: SERIES.collections },
                    ...(payload[0].payload.salesTarget !== null ? [{ label: "Sales target", value: formatPKR(payload[0].payload.salesTarget), color: SERIES.target, dashed: true }] : []),
                  ]}
                />
              ) : null
            }
          />
          <Legend iconSize={10} wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
          <Bar dataKey="netSales" name="Net sales" fill={SERIES.sales} radius={[4, 4, 0, 0]} maxBarSize={36} />
          <Line dataKey="collections" name="Collections" stroke={SERIES.collections} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: SERIES.collections }} activeDot={{ r: 5 }} />
          {hasTarget && <Line dataKey="salesTarget" name="Sales target" stroke={SERIES.target} strokeWidth={1.5} strokeDasharray="5 4" dot={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Estimated gross margin % over time — its own chart because the unit differs from PKR. */
export function MarginChart({ data, height = 200 }: { data: { period: string; estGrossMarginPct: number | null }[]; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label="Estimated gross margin by period">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={SERIES.grid} />
          <XAxis dataKey="period" tickFormatter={(p: string) => periodLabel(p).replace(" 20", " ’")} {...axisProps} minTickGap={12} />
          <YAxis tickFormatter={(v: number) => `${v}%`} {...axisProps} width={40} domain={["auto", "auto"]} />
          <Tooltip
            content={({ active, payload, label }: TipProps) =>
              active && payload?.length ? <TooltipBox title={periodLabel(String(label))} rows={[{ label: "Est. gross margin", value: formatPct(payload[0].payload.estGrossMarginPct), color: SERIES.sales }]} /> : null
            }
          />
          <Line dataKey="estGrossMarginPct" stroke={SERIES.sales} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: SERIES.sales }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AgingChart({ data, height = 220 }: { data: { bucket: string; amount: number; invoices: number }[]; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label="Outstanding receivables by aging bucket">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={SERIES.grid} />
          <XAxis dataKey="bucket" {...axisProps} interval={0} />
          <YAxis tickFormatter={(v: number) => formatCompact(v)} {...axisProps} width={48} />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            content={({ active, payload }: TipProps) =>
              active && payload?.length ? (
                <TooltipBox title={String(payload[0].payload.bucket)} rows={[{ label: "Outstanding", value: formatPKR(payload[0].payload.amount) }, { label: "Invoices", value: String(payload[0].payload.invoices) }]} />
              ) : null
            }
          />
          <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={56}>
            {data.map((d, i) => (
              <Cell key={d.bucket} fill={AGING_RAMP[i] ?? AGING_RAMP[AGING_RAMP.length - 1]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Cumulative share of net sales by customer rank (Pareto curve). */
export function ParetoChart({ data, height = 220 }: { data: { rank: number; cumulativePct: number; name: string }[]; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label="Cumulative share of net sales by customer rank">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={SERIES.grid} />
          <XAxis dataKey="rank" {...axisProps} label={{ value: "Customers ranked by net sales", position: "insideBottom", offset: -2, fontSize: 11, fill: SERIES.axis }} height={32} />
          <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} {...axisProps} width={40} />
          <Tooltip
            content={({ active, payload }: TipProps) =>
              active && payload?.length ? (
                <TooltipBox title={`Top ${payload[0].payload.rank} customers`} rows={[{ label: "Share of net sales", value: formatPct(payload[0].payload.cumulativePct) }, { label: `#${payload[0].payload.rank}`, value: String(payload[0].payload.name) }]} />
              ) : null
            }
          />
          <Line dataKey="cumulativePct" stroke={SERIES.sales} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Actual monthly sales with a dashed baseline forecast and its rough range. */
export function ForecastChart({ data, height = 240 }: { data: { period: string; actual: number | null; forecast: number | null; range: [number, number] | null }[]; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label="Monthly net sales with baseline forecast">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={SERIES.grid} />
          <XAxis dataKey="period" tickFormatter={(p: string) => periodLabel(p).replace(" 20", " ’")} {...axisProps} minTickGap={16} />
          <YAxis tickFormatter={(v: number) => formatCompact(v)} {...axisProps} width={48} />
          <Tooltip
            content={({ active, payload, label }: TipProps) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload;
              return (
                <TooltipBox
                  title={periodLabel(String(label))}
                  rows={[
                    ...(p.actual !== null ? [{ label: "Actual", value: formatPKR(p.actual), color: SERIES.sales }] : []),
                    ...(p.forecast !== null ? [{ label: "Baseline forecast", value: formatPKR(p.forecast), color: SERIES.sales, dashed: true }] : []),
                    ...(p.range ? [{ label: "Rough range", value: `${formatPKR(p.range[0])} – ${formatPKR(p.range[1])}` }] : []),
                  ]}
                />
              );
            }}
          />
          <Legend iconSize={10} wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
          <Area dataKey="range" name="Rough range" stroke="none" fill={SERIES.sales} fillOpacity={0.12} legendType="square" />
          <Line dataKey="actual" name="Actual" stroke={SERIES.sales} strokeWidth={2} dot={false} connectNulls={false} />
          <Line dataKey="forecast" name="Baseline forecast" stroke={SERIES.sales} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3, strokeWidth: 0, fill: SERIES.sales }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Monthly complaint counts (single series). */
export function CountBars({ data, height = 200, label }: { data: { period: string; count: number }[]; height?: number; label: string }) {
  return (
    <div style={{ height }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={SERIES.grid} />
          <XAxis dataKey="period" tickFormatter={(p: string) => periodLabel(p).replace(" 20", " ’")} {...axisProps} minTickGap={12} />
          <YAxis allowDecimals={false} {...axisProps} width={32} />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            content={({ active, payload, label: l }: TipProps) => (active && payload?.length ? <TooltipBox title={periodLabel(String(l))} rows={[{ label, value: String(payload[0].payload.count) }]} /> : null)}
          />
          <Bar dataKey="count" fill={SERIES.sales} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
