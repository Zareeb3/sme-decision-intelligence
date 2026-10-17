/**
 * Company settings and business rules.
 *
 * Everything that differs between companies lives here: name, currency, fiscal
 * year, volume unit, which customer type is the main channel partner, and the
 * thresholds behind every flag and score. Analytics read the active settings
 * through `getSettings()`; the app sets them once from the saved profile.
 */
import { z } from "zod";

export const businessRulesSchema = z.object({
  health: z.object({
    overdueShareHighPct: z.number().min(0).max(100),
    overdueShareWatchPct: z.number().min(0).max(100),
    oldestOverdueHighDays: z.number().min(1),
    oldestOverdueWatchDays: z.number().min(1),
    salesDropHighPct: z.number().min(0).max(100),
    salesDropWatchPct: z.number().min(0).max(100),
    creditUseHighPct: z.number().min(1),
    creditUseWatchPct: z.number().min(1),
    healthyFrom: z.number().min(1).max(100),
    watchFrom: z.number().min(1).max(100),
  }),
  products: z.object({
    salesDropPct: z.number().min(1).max(100),
    weakMarginGapPts: z.number().min(0).max(100),
    marginErosionPts: z.number().min(0).max(100),
  }),
  complaints: z.object({
    spikeWindowDays: z.number().min(7).max(365),
    spikeMinCount: z.number().min(1),
    spikeMinRatio: z.number().min(1),
  }),
  actions: z.object({
    overdueAlertThreshold: z.number().min(0),
  }),
});
export type BusinessRules = z.infer<typeof businessRulesSchema>;

export const DEFAULT_RULES: BusinessRules = {
  health: {
    overdueShareHighPct: 50,
    overdueShareWatchPct: 25,
    oldestOverdueHighDays: 90,
    oldestOverdueWatchDays: 60,
    salesDropHighPct: 30,
    salesDropWatchPct: 10,
    creditUseHighPct: 100,
    creditUseWatchPct: 80,
    healthyFrom: 80,
    watchFrom: 60,
  },
  products: { salesDropPct: 15, weakMarginGapPts: 5, marginErosionPts: 3 },
  complaints: { spikeWindowDays: 60, spikeMinCount: 3, spikeMinRatio: 3 },
  actions: { overdueAlertThreshold: 10_000_000 },
};

export const CURRENCIES = ["PKR", "USD", "EUR", "GBP", "AED", "SAR", "INR", "BDT", "LKR", "EGP", "TRY", "CNY"] as const;

export const companySettingsSchema = z.object({
  companyName: z.string().trim().min(1).max(80),
  industry: z.string().trim().max(80),
  currency: z.string().trim().min(3).max(3),
  /** 1 = January. Pakistan's fiscal year usually starts in July (7). */
  fiscalYearStartMonth: z.number().int().min(1).max(12),
  /** Label for quantities: sqm, units, kg, tonnes, cartons... */
  volumeUnit: z.string().trim().min(1).max(16),
  /** Customer type treated as the main channel partner in "partners needing attention". */
  partnerType: z.string().trim().min(1).max(40),
  /** Replace customer names with aliases before anything is sent to the AI provider. */
  anonymiseForAI: z.boolean(),
  rules: businessRulesSchema,
});
export type CompanySettings = z.infer<typeof companySettingsSchema>;

/** Settings used with the bundled sample data. */
export const SAMPLE_SETTINGS: CompanySettings = {
  companyName: "Zarnab Tiles (sample)",
  industry: "Ceramic tiles manufacturing and distribution",
  currency: "PKR",
  fiscalYearStartMonth: 1,
  volumeUnit: "sqm",
  partnerType: "Distributor",
  anonymiseForAI: false,
  rules: DEFAULT_RULES,
};

/** Starting point for a new company before the setup wizard is completed. */
export const NEW_COMPANY_SETTINGS: CompanySettings = {
  ...SAMPLE_SETTINGS,
  companyName: "My company",
  industry: "Manufacturing",
  fiscalYearStartMonth: 7,
  anonymiseForAI: true,
};

let active: CompanySettings = SAMPLE_SETTINGS;

export function getSettings(): CompanySettings {
  return active;
}

export function getRules(): BusinessRules {
  return active.rules;
}

export function setSettings(s: CompanySettings) {
  active = s;
}

/** Merge a possibly partial or older saved object onto defaults, then validate. */
export function parseSettings(raw: unknown, fallback: CompanySettings = NEW_COMPANY_SETTINGS): CompanySettings {
  const r = (raw ?? {}) as Partial<CompanySettings>;
  const merged = {
    ...fallback,
    ...r,
    rules: {
      health: { ...fallback.rules.health, ...(r.rules?.health ?? {}) },
      products: { ...fallback.rules.products, ...(r.rules?.products ?? {}) },
      complaints: { ...fallback.rules.complaints, ...(r.rules?.complaints ?? {}) },
      actions: { ...fallback.rules.actions, ...(r.rules?.actions ?? {}) },
    },
  };
  const parsed = companySettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : fallback;
}
