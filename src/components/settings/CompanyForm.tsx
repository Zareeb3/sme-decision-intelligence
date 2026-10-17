"use client";

import { CURRENCIES, type CompanySettings } from "@/lib/settings";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const INDUSTRIES = [
  "Ceramic tiles manufacturing and distribution",
  "Building materials",
  "Textiles and apparel",
  "Food and beverage",
  "Pharmaceuticals",
  "Chemicals and plastics",
  "Steel and metals",
  "Packaging",
  "FMCG distribution",
  "Industrial equipment",
  "Manufacturing",
];

function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[0.82rem] font-medium text-ink">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-[0.74rem] text-faint">{hint}</p>}
    </div>
  );
}

const input = "h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-[0.9rem]";

export function CompanyForm({ value, onChange }: { value: CompanySettings; onChange: (v: CompanySettings) => void }) {
  const set = <K extends keyof CompanySettings>(k: K, v: CompanySettings[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Company name" htmlFor="cf-name">
        <input id="cf-name" className={input} value={value.companyName} maxLength={80} onChange={(e) => set("companyName", e.target.value)} />
      </Field>
      <Field label="Industry" htmlFor="cf-industry" hint="Gives the AI analyst context. Choose the closest or type your own.">
        <input id="cf-industry" list="cf-industries" className={input} value={value.industry} maxLength={80} onChange={(e) => set("industry", e.target.value)} />
        <datalist id="cf-industries">
          {INDUSTRIES.map((i) => (
            <option key={i} value={i} />
          ))}
        </datalist>
      </Field>
      <Field label="Reporting currency" htmlFor="cf-currency" hint="Shown on every amount. No conversion is applied.">
        <select id="cf-currency" className={input} value={value.currency} onChange={(e) => set("currency", e.target.value)}>
          {[...new Set([...CURRENCIES, value.currency])].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Field>
      <Field label="Fiscal year starts in" htmlFor="cf-fy" hint="Quarters and year presets follow this. Pakistan usually starts in July.">
        <select id="cf-fy" className={input} value={value.fiscalYearStartMonth} onChange={(e) => set("fiscalYearStartMonth", Number(e.target.value))}>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Quantity unit" htmlFor="cf-unit" hint="For example sqm, cartons, kg, tonnes, units.">
        <input id="cf-unit" className={input} value={value.volumeUnit} maxLength={16} onChange={(e) => set("volumeUnit", e.target.value)} />
      </Field>
      <Field label="Main channel partner type" htmlFor="cf-partner" hint="The customer type the 'partners needing attention' analysis focuses on, e.g. Distributor.">
        <input id="cf-partner" className={input} value={value.partnerType} maxLength={40} onChange={(e) => set("partnerType", e.target.value)} />
      </Field>
      <label className="flex items-start gap-2.5 rounded-md border border-line bg-paper p-3 sm:col-span-2">
        <input type="checkbox" className="mt-1 accent-[var(--color-glaze)]" checked={value.anonymiseForAI} onChange={(e) => set("anonymiseForAI", e.target.checked)} />
        <span className="text-[0.85rem]">
          <span className="font-medium">Hide customer names from the AI provider</span>
          <span className="block text-muted">Names are replaced with aliases such as &ldquo;Account A&rdquo; before a question is sent, and restored in the answer on your screen.</span>
        </span>
      </label>
    </div>
  );
}
