"use client";

import { useEffect, useState } from "react";
import { useData } from "../DataProvider";
import { Badge, Button, Notice, PageHeader, Panel } from "../ui";
import { CompanyForm } from "../settings/CompanyForm";
import { DEFAULT_RULES, NEW_COMPANY_SETTINGS, businessRulesSchema, type BusinessRules, type CompanySettings } from "@/lib/settings";

interface Status {
  llm: { configured: boolean; model: string | null };
  n8n: { configured: boolean };
  storage: { enabled: boolean; reason: string };
  ingest: { configured: boolean };
  auth: { enabled: boolean };
  sampleEnabled: boolean;
}

type Group = keyof BusinessRules;
const RULE_FIELDS: { group: Group; key: string; label: string; unit: string }[] = [
  { group: "health", key: "overdueShareHighPct", label: "Overdue share: needs attention above", unit: "%" },
  { group: "health", key: "overdueShareWatchPct", label: "Overdue share: watch above", unit: "%" },
  { group: "health", key: "oldestOverdueHighDays", label: "Oldest overdue: needs attention after", unit: "days" },
  { group: "health", key: "oldestOverdueWatchDays", label: "Oldest overdue: watch after", unit: "days" },
  { group: "health", key: "salesDropHighPct", label: "90-day sales drop: needs attention above", unit: "%" },
  { group: "health", key: "salesDropWatchPct", label: "90-day sales drop: watch above", unit: "%" },
  { group: "health", key: "creditUseHighPct", label: "Credit use: needs attention above", unit: "%" },
  { group: "health", key: "creditUseWatchPct", label: "Credit use: watch above", unit: "%" },
  { group: "health", key: "healthyFrom", label: "Healthy from score", unit: "/100" },
  { group: "health", key: "watchFrom", label: "Watch from score", unit: "/100" },
  { group: "products", key: "salesDropPct", label: "Product flag: sales down more than", unit: "%" },
  { group: "products", key: "weakMarginGapPts", label: "Product flag: margin below portfolio by", unit: "pts" },
  { group: "products", key: "marginErosionPts", label: "Product flag: margin down more than", unit: "pts" },
  { group: "complaints", key: "spikeWindowDays", label: "Complaint spike: look-back window", unit: "days" },
  { group: "complaints", key: "spikeMinCount", label: "Complaint spike: at least", unit: "complaints" },
  { group: "complaints", key: "spikeMinRatio", label: "Complaint spike: times the normal rate", unit: "×" },
  { group: "complaints", key: "highClaimValue", label: "Triage: claim at least (High priority)", unit: "amount" },
  { group: "complaints", key: "repeatMinCount", label: "Triage: repeat customer after", unit: "complaints" },
  { group: "complaints", key: "repeatWindowDays", label: "Triage: repeat window", unit: "days" },
  { group: "complaints", key: "systemicMinCount", label: "Triage: possible systemic issue at", unit: "complaints" },
  { group: "complaints", key: "systemicWindowDays", label: "Triage: systemic window", unit: "days" },
  { group: "complaints", key: "slaCriticalHours", label: "First response target: Critical", unit: "hours" },
  { group: "complaints", key: "slaHighHours", label: "First response target: High", unit: "hours" },
  { group: "complaints", key: "slaMediumHours", label: "First response target: Medium", unit: "hours" },
  { group: "complaints", key: "slaLowHours", label: "First response target: Low", unit: "hours" },
  { group: "actions", key: "overdueAlertThreshold", label: "Overdue alert above", unit: "amount" },
];

const GROUP_TITLES: Record<Group, string> = { health: "Account health score", products: "Product flags", complaints: "Complaints and triage", actions: "Actions" };

function Integration({ label, ok, okText, offText }: { label: string; ok: boolean; okText: string; offText: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/70 py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-[0.88rem] font-medium">{label}</p>
        <p className="mt-0.5 text-[0.8rem] text-muted">{ok ? okText : offText}</p>
      </div>
      <Badge tone={ok ? "good" : "neutral"}>{ok ? "On" : "Off"}</Badge>
    </div>
  );
}

export function SettingsView() {
  const { settings, origin, saveSettings } = useData();
  const [draft, setDraft] = useState<CompanySettings>(origin === "sample" ? NEW_COMPANY_SETTINGS : settings);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    if (origin !== "sample") setDraft(settings);
  }, [settings, origin]);
  useEffect(() => {
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const rulesValid = businessRulesSchema.safeParse(draft.rules).success;
  const setRule = (g: Group, k: string, v: number) => setDraft({ ...draft, rules: { ...draft.rules, [g]: { ...draft.rules[g], [k]: v } } });

  async function save() {
    setMessage(await saveSettings(draft));
  }

  return (
    <>
      <PageHeader title="Settings" description="Company profile, the thresholds behind every flag and score, and the status of optional integrations." actions={<Button onClick={() => void save()} disabled={!rulesValid || !draft.companyName.trim()}>Save settings</Button>} />
      {origin === "sample" && (
        <div className="mb-5">
          <Notice tone="watch">You are viewing sample data, which always uses the sample company&apos;s settings. Changes here apply to your company data once it is loaded.</Notice>
        </div>
      )}
      {message && (
        <div className="mb-5">
          <Notice tone="good">{message}</Notice>
        </div>
      )}

      <Panel title="Company profile">
        <CompanyForm value={draft} onChange={setDraft} />
      </Panel>

      <Panel
        className="mt-6"
        title="Business rules"
        subtitle="Agree these with sales and finance. Every flag in the app shows the rule that triggered it."
        actions={
          <Button variant="ghost" onClick={() => setDraft({ ...draft, rules: DEFAULT_RULES })}>
            Restore defaults
          </Button>
        }
      >
        <div className="grid gap-6 md:grid-cols-2">
          {(Object.keys(GROUP_TITLES) as Group[]).map((g) => (
            <fieldset key={g}>
              <legend className="mb-2 text-[0.88rem] font-semibold">{GROUP_TITLES[g]}</legend>
              <div className="space-y-2">
                {RULE_FIELDS.filter((r) => r.group === g).map((r) => {
                  const value = (draft.rules[g] as Record<string, number>)[r.key];
                  return (
                    <label key={r.key} className="flex items-center justify-between gap-3 text-[0.82rem]">
                      <span className="text-muted">{r.label}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <input
                          type="number"
                          value={value}
                          min={0}
                          onChange={(e) => setRule(g, r.key, Number(e.target.value))}
                          className="h-8 w-28 rounded border border-line-strong bg-surface px-2 text-right tabular-nums"
                        />
                        <span className="w-16 text-[0.75rem] text-faint">{r.unit === "amount" ? draft.currency : r.unit}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        {!rulesValid && <p className="mt-3 text-[0.8rem] text-oxide">One of the values is out of range.</p>}
      </Panel>

      <Panel className="mt-6" title="Integrations" subtitle="Configured by your administrator through server environment variables; secrets are never shown here.">
        {status ? (
          <>
            <Integration label="AI explanations" ok={status.llm.configured} okText={`Live explanations with ${status.llm.model}. Numbers are always checked against the evidence.`} offText="Demo mode: answers are written by fixed templates. Set ANTHROPIC_API_KEY to enable." />
            <Integration label="Server storage" ok={status.storage.enabled} okText="Company data and settings are shared by everyone using this server." offText={status.storage.reason} />
            <Integration label="Pipeline ingest" ok={status.ingest.configured} okText="Pipelines can send data with the ingest token." offText="Set INGEST_TOKEN to accept automated loads." />
            <Integration label="Sign-in" ok={status.auth.enabled} okText="Pages require the company sign-in." offText="Anyone with the link can open the app. Set BASIC_AUTH_USER and BASIC_AUTH_PASSWORD, or place the app behind your single sign-on." />
            <Integration label="Workflow automation (n8n)" ok={status.n8n.configured} okText="Approved actions are sent to the n8n webhook." offText="Approved actions are recorded but not sent. Set N8N_WEBHOOK_URL." />
            <Integration label="Sample data" ok={status.sampleEnabled} okText="Available for demonstrations when no company data is loaded." offText="Switched off for this deployment." />
          </>
        ) : (
          <p className="text-sm text-muted">Integration status is unavailable because the server could not be reached.</p>
        )}
      </Panel>
    </>
  );
}
