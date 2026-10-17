"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { FilterBar } from "./FilterBar";
import { useData } from "./DataProvider";
import { Button, EmptyState, LoadingState } from "./ui";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/sales", label: "Sales & performance" },
  { href: "/customers", label: "Customers & distributors" },
  { href: "/receivables", label: "Receivables" },
  { href: "/complaints", label: "Complaints" },
  { href: "/ask", label: "Ask the analyst" },
  { href: "/scenarios", label: "Scenarios" },
  { href: "/actions", label: "Actions" },
  { href: "/data", label: "Data & validation" },
];

/** The four-tile mark: a nod to the product without being a logo of any real company. */
function TileMark() {
  return (
    <span className="grid h-7 w-7 grid-cols-2 gap-[2px]" aria-hidden>
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
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map((n) => {
        const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-2 text-[0.88rem] transition-colors ${active ? "bg-glaze-soft font-medium text-glaze-deep" : "text-ink/80 hover:bg-paper hover:text-ink"}`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { status, error, loadSample, model } = useData();
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMenuOpen(false), [pathname]);

  const brand = (
    <Link href="/" className="flex items-center gap-2.5">
      <TileMark />
      <span className="leading-tight">
        <span className="block text-[0.92rem] font-semibold text-ink">Decision Intelligence</span>
        <span className="block text-[0.72rem] text-muted">Zarnab Tiles, a fictional demo</span>
      </span>
    </Link>
  );

  const isDataPage = pathname.startsWith("/data");

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-surface px-4 py-5 lg:flex">
        {brand}
        <div className="mt-7 flex-1">
          <NavLinks />
        </div>
        <p className="border-t border-line pt-3 text-[0.72rem] leading-relaxed text-faint">
          All companies, customers and figures are synthetic. Amounts in Pakistani rupees (PKR).
        </p>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
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
          {!isDataPage && (
            <div className="px-4 py-2.5 lg:px-8">
              <FilterBar />
            </div>
          )}
        </header>

        <main className="mx-auto max-w-[1280px] px-4 py-6 lg:px-8 lg:py-8">
          {status === "loading" && !isDataPage && <LoadingState label="Loading and validating data" />}
          {status === "error" && !isDataPage && (
            <EmptyState
              title="The data could not be loaded"
              action={
                <div className="flex justify-center gap-2">
                  <Button onClick={() => void loadSample()}>Load sample data</Button>
                  <Link href="/data" className="rounded-md border border-line-strong px-3.5 py-2 text-sm">
                    Upload CSV files
                  </Link>
                </div>
              }
            >
              {error}
            </EmptyState>
          )}
          {(status === "ready" || isDataPage) && (model || isDataPage) && children}
        </main>
      </div>
    </div>
  );
}
