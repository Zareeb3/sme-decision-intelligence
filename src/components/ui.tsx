"use client";

/**
 * Small, shared UI building blocks. Styling is deliberately restrained:
 * colour is reserved for status (good / watch / risk) and the primary action.
 */
import type { ReactNode } from "react";
import { METRICS } from "@/lib/analytics/definitions";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.01em] text-ink">{title}</h1>
        {description && <p className="mt-1.5 text-[0.95rem] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Panel({ title, subtitle, children, actions, className = "" }: { title?: string; subtitle?: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-lg border border-line bg-surface ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div>
            {title && <h2 className="text-[0.95rem] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[0.8rem] text-muted">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

type Tone = "neutral" | "good" | "watch" | "risk" | "primary";

const TONE: Record<Tone, string> = {
  neutral: "bg-paper text-muted border-line",
  good: "bg-celadon-soft text-celadon border-celadon/30",
  watch: "bg-ochre-soft text-ochre border-ochre/30",
  risk: "bg-oxide-soft text-oxide border-oxide/30",
  primary: "bg-glaze-soft text-glaze-deep border-glaze/30",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[0.72rem] font-medium ${TONE[tone]}`}>{children}</span>;
}

export function bandTone(band: string): Tone {
  return band === "Healthy" ? "good" : band === "Watch" ? "watch" : band === "Needs attention" ? "risk" : "neutral";
}

/** Metric tile with an inline "how is this calculated" disclosure. */
export function MetricCard({
  label,
  value,
  sub,
  metricId,
  tone,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  metricId?: keyof typeof METRICS | string;
  tone?: Tone;
}) {
  const def = metricId ? METRICS[metricId] : undefined;
  const accent = tone === "risk" ? "border-l-oxide" : tone === "watch" ? "border-l-ochre" : tone === "good" ? "border-l-celadon" : "border-l-transparent";
  return (
    <div className={`relative rounded-lg border border-line border-l-[3px] ${accent} bg-surface px-4 py-3.5`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[0.8rem] text-muted">{label}</p>
        {def && (
          <details className="group relative">
            <summary aria-label={`How ${def.name} is calculated`} className="flex h-5 w-5 items-center justify-center rounded-full border border-line text-[0.7rem] text-faint hover:border-glaze hover:text-glaze">
              ?
            </summary>
            <div className="absolute right-0 top-7 z-30 w-72 rounded-md border border-line-strong bg-surface p-3 text-[0.78rem] leading-relaxed text-ink shadow-lg">
              <p className="font-semibold">{def.name}</p>
              <p className="mt-1 text-muted">{def.definition}</p>
              <p className="mt-2 font-mono text-[0.72rem] text-glaze-deep">{def.formula}</p>
              <p className="mt-2"><span className="font-medium">Period: </span><span className="text-muted">{def.period}</span></p>
              <p className="mt-1"><span className="font-medium">Limitations: </span><span className="text-muted">{def.limitations}</span></p>
            </div>
          </details>
        )}
      </div>
      <p className="mt-1.5 text-[1.45rem] font-semibold leading-none tracking-[-0.01em] text-ink">{value}</p>
      {sub && <div className="mt-2 text-[0.78rem] text-muted">{sub}</div>}
    </div>
  );
}

export function Delta({ value, suffix = "%", invert = false, digits = 1 }: { value: number | null | undefined; suffix?: string; invert?: boolean; digits?: number }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="text-faint">—</span>;
  const good = invert ? value < 0 : value > 0;
  const cls = Math.abs(value) < 0.05 ? "text-muted" : good ? "text-celadon" : "text-oxide";
  return (
    <span className={`font-medium ${cls}`}>
      {value > 0 ? "+" : value < 0 ? "−" : ""}
      {Math.abs(value).toFixed(digits)}
      {suffix}
    </span>
  );
}

export function LoadingState({ label = "Loading data" }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
      <div className="text-center">
        <div className="mx-auto grid h-8 w-8 grid-cols-2 gap-0.5" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="animate-pulse rounded-[2px] bg-glaze/60" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </div>
        <p className="mt-3 text-sm text-muted">{label}…</p>
      </div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`rounded-md border px-3.5 py-2.5 text-[0.85rem] leading-relaxed ${TONE[tone]}`}>{children}</div>;
}

export function Button({
  children,
  onClick,
  variant = "primary",
  type = "button",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const cls =
    variant === "primary"
      ? "bg-glaze text-white hover:bg-glaze-deep disabled:bg-line-strong"
      : variant === "secondary"
        ? "border border-line-strong bg-surface text-ink hover:border-glaze hover:text-glaze-deep"
        : "text-glaze hover:bg-glaze-soft";
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${cls}`}>
      {children}
    </button>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  sortValue?: (row: T) => number | string;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  empty = "No rows match the current filters.",
  onRowClick,
  maxRows,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  empty?: string;
  onRowClick?: (row: T) => void;
  maxRows?: number;
}) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  const shown = maxRows ? rows.slice(0, maxRows) : rows;
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-[0.85rem]">
        <thead>
          <tr className="border-b border-line text-left text-[0.75rem] text-muted">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`whitespace-nowrap px-5 py-2 font-medium ${c.align === "right" ? "text-right" : ""}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={`border-b border-line/70 last:border-0 ${onRowClick ? "cursor-pointer hover:bg-glaze-soft/50" : ""}`}
            >
              {columns.map((c) => (
                <td key={c.key} className={`px-5 py-2 align-top ${c.align === "right" ? "whitespace-nowrap text-right tabular-nums" : ""}`}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {maxRows && rows.length > maxRows && <p className="px-5 pt-2 text-[0.75rem] text-faint">Showing {maxRows} of {rows.length} rows.</p>}
    </div>
  );
}

/** Horizontal share bar used in ranked lists (cheaper and clearer than a chart for 5–10 rows). */
export function ShareBar({ pct, tone = "primary" }: { pct: number; tone?: "primary" | "risk" | "watch" }) {
  const color = tone === "risk" ? "bg-oxide" : tone === "watch" ? "bg-ochre" : "bg-glaze";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper" aria-hidden>
      <div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}
