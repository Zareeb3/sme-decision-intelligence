"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { FilterBar } from "./FilterBar";
import { useData } from "./DataProvider";
import { Button, EmptyState, LoadingState } from "./ui";
import { formatDate } from "@/lib/analytics/format";

const NAV: { group: string; items: { href: string; label: string }[] }[] = [
  {
    group: "Insights",
    items: [
      { href: "/", label: "Overview" },
      { href: "/sales", label: "Sales & performance" },
      { href: "/customers", label: "Customers & partners" },
      { href: "/receivables", label: "Receivables" },
      { href: "/complaints", label: "Complaints" },
    ],
  },
  {
    group: "Decide",
    items: [
      { href: "/ask", label: "Ask the analyst" },
      { href: "/scenarios", label: "Scenarios" },
      { href: "/actions", label: "Actions" },
      { href: "/report", label: "Management report" },
    ],
  },
  {
    group: "Set up",
    items: [
      { href: "/data", label: "Data sources" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

/** Pages that work without loaded data. */
const NO_DATA_PAGES = ["/setup", "/data", "/settings"];

function TileMark() {
  return (
    <span className="grid h-7 w-7 shrink-0 grid-cols-2 gap-[2px]" aria-hidden>
      <span className="rounded-[2px] bg-glaze" />
      <span className="rounded-[2px] bg-glaze/45" />
      <span className="rounded-[2px] bg-ochre/70" />
      <span className="rounded-[2px] bg-glaze-deep" />
    </span>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      {NAV.map((g) => (
        <div key={g.group}>
          <p className="px-3 pb-1 text-[0.72rem] font-medium text-faint">{g.group}</p>
          <div className="flex flex-col gap-0.5">
            {g.items.map((n) => {
              const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md px-3 py-1.5 text-[0.88rem] transition-colors ${active ? "bg-glaze-soft font-medium text-glaze-deep" : "text-ink/80 hover:bg-paper hover:text-ink"}`}
                >
                  {n.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

/** Where the numbers on screen come from, and how fresh they are. */
export function DataBadge() {
  const { origin, datasets, status } = useData();
  if (status !== "ready" || !origin) return null;
  if (origin === "sample") {
    return (
      <Link href="/setup" className="inline-flex items-center gap-2 rounded-md border border-ochre/40 bg-ochre-soft px-2.5 py-1 text-[0.78rem] text-ochre hover:border-ochre">
        <span className="h-1.5 w-1.5 rounded-full bg-ochre" aria-hidden />
        Sample data. Set up your company
      </Link>
    );
  }
  const latest = Object.values(datasets)
    .map((d) => d?.updatedAt ?? "")
    .sort()
    .pop();
  const viaPipeline = Object.values(datasets).some((d) => d && d.source !== "upload");
  return (
    <Link href="/data" className="inline-flex items-center gap-2 rounded-md border border-celadon/40 bg-celadon-soft px-2.5 py-1 text-[0.78rem] text-celadon hover:border-celadon">
      <span className="h-1.5 w-1.5 rounded-full bg-celadon" aria-hidden />
      {viaPipeline ? "Pipeline data" : "Uploaded data"}
      {latest && <span className="text-celadon/80">updated {formatDate(latest.slice(0, 10))}</span>}
    </Link>
  );
}

function Welcome() {
  const { server, loadSample } = useData();
  return (
    <div className="mx-auto max-w-2xl py-10">
      <div className="flex items-center gap-3">
        <TileMark />
        <h1 className="text-[1.6rem] font-semibold">Welcome to Decision Intelligence</h1>
      </div>
      <p className="mt-3 text-[0.98rem] leading-relaxed text-muted">
        Connect your company&apos;s sales, customer, invoice and complaint data to get verified KPIs, explained findings, what-if scenarios and approved follow-up actions. Setup takes a few minutes.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/setup" className="rounded-md bg-glaze px-4 py-2.5 text-sm font-medium text-white hover:bg-glaze-deep">
          Set up your company
        </Link>
        {server.sampleEnabled && (
          <Button variant="secondary" onClick={() => void loadSample()}>
            Explore with sample data
          </Button>
        )}
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { status, error, model, origin, settings, reload, server } = useData();
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMenuOpen(false), [pathname]);

  const brand = (
    <Link href="/" className="flex items-center gap-2.5">
      <TileMark />
      <span className="min-w-0 leading-tight">
        <span className="block text-[0.92rem] font-semibold text-ink">Decision Intelligence</span>
        <span className="block truncate text-[0.72rem] text-muted">{settings.companyName}</span>
      </span>
    </Link>
  );

  const noDataPage = NO_DATA_PAGES.some((p) => pathname.startsWith(p));
  const isReport = pathname.startsWith("/report");

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_1fr] print:block">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-surface px-3 py-5 lg:flex print:hidden">
        <div className="px-1">{brand}</div>
        <div className="mt-6 flex-1 overflow-y-auto">
          <NavLinks />
        </div>
        <p className="border-t border-line px-1 pt-3 text-[0.72rem] leading-relaxed text-faint">
          {origin === "sample"
            ? "Sample data: all companies, customers and figures are fictional."
            : `Amounts in ${settings.currency}. Figures are calculated from validated company data.`}
        </p>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur print:hidden">
          <div className="flex items-center justify-between px-4 py-3 lg:hidden">
            {brand}
            <button type="button" className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
              {menuOpen ? "Close" : "Menu"}
            </button>
          </div>
          {menuOpen && (
            <div className="border-t border-line bg-surface px-3 py-3 lg:hidden">
              <NavLinks onNavigate={() => setMenuOpen(false)} />
            </div>
          )}
          {!noDataPage && status === "ready" && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 lg:px-8">
              <DataBadge />
              <div className="w-full min-w-0 md:w-auto md:flex-1">
                <FilterBar />
              </div>
            </div>
          )}
        </header>

        <main className={`mx-auto max-w-[1280px] px-4 py-6 lg:px-8 lg:py-8 ${isReport ? "print:max-w-none print:p-0" : ""}`}>
          {noDataPage && children}
          {!noDataPage && status === "loading" && <LoadingState label="Loading and validating data" />}
          {!noDataPage && status === "empty" && <Welcome />}
          {!noDataPage && status === "error" && (
            <EmptyState
              title="The data could not be loaded"
              action={
                <div className="flex justify-center gap-2">
                  <Button onClick={() => void reload()}>Try again</Button>
                  <Link href="/data" className="rounded-md border border-line-strong px-3.5 py-2 text-sm">
                    Open data sources
                  </Link>
                </div>
              }
            >
              {error}
              {!server.reachable && " The server could not be reached."}
            </EmptyState>
          )}
          {!noDataPage && status === "ready" && model && children}
        </main>
      </div>
    </div>
  );
}
