"use client";

import { useEffect, useRef, useState } from "react";
import { useReadyData } from "../DataProvider";
import { Badge, Button, Notice, PageHeader } from "../ui";
import { routeQuestion, type RouteResult } from "@/lib/ai/router";
import { buildEvidence } from "@/lib/ai/evidence";
import { demoExplain } from "@/lib/ai/demo";
import { checkGrounding } from "@/lib/ai/grounding";
import { ANALYSIS_LABELS, ANALYSIS_METHOD, type AskResult, type EvidencePacket } from "@/lib/ai/types";
import { anonymisePacket, deanonymiseResponse } from "@/lib/ai/anonymise";
import { describeFilters } from "@/lib/analytics/filters";

const suggestions = (partner: string) => [
  "Why did sales increase while collections fell behind?",
  `Which ${partner.toLowerCase()}s may need attention?`,
  "Which accounts have significant overdue invoices?",
  "What could happen if collections improve by 10%?",
  "Which products show weak margins or unusual patterns?",
  "Which complaints require management attention?",
  "Which customers contribute the largest share of revenue?",
  "What should a business manager investigate next?",
];

interface Turn {
  id: number;
  question: string;
  route: RouteResult;
  packet: EvidencePacket;
  result: AskResult | null;
  error: string | null;
}

interface Status {
  llm: { configured: boolean; model: string | null };
}

function Cite({ ids, onFocus }: { ids: string[]; onFocus: (id: string | null) => void }) {
  if (!ids.length) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {ids.map((id) => (
        <a
          key={id}
          href={`#ev-${id}`}
          onMouseEnter={() => onFocus(id)}
          onMouseLeave={() => onFocus(null)}
          onFocus={() => onFocus(id)}
          onBlur={() => onFocus(null)}
          className="rounded-[3px] border border-glaze/40 bg-glaze-soft px-1 font-mono text-[0.68rem] leading-[1.15rem] text-glaze-deep hover:border-glaze"
        >
          {id}
        </a>
      ))}
    </span>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="text-[0.85rem] font-semibold text-ink">
        {title}
        <span className="ml-2 text-[0.78rem] font-normal text-faint">{hint}</span>
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function EvidenceLedger({ packet, focus }: { packet: EvidencePacket; focus: string | null }) {
  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <p className="text-[0.9rem] font-semibold">Evidence ledger</p>
        <p className="text-[0.75rem] text-muted">
          Computed by the analytics engine, not by the AI. {packet.items.length} items · balances as of {packet.period.asOf}
        </p>
      </div>
      <ol className="max-h-[34rem] overflow-y-auto">
        {packet.items.map((i) => (
          <li
            key={i.id}
            id={`ev-${i.id}`}
            className={`grid grid-cols-[2.6rem_1fr] gap-2 border-b border-line/70 px-4 py-2 text-[0.8rem] transition-colors last:border-0 ${focus === i.id ? "bg-glaze-soft" : ""}`}
          >
            <span className="font-mono text-[0.72rem] leading-5 text-glaze-deep">{i.id}</span>
            <span>
              <span className="block text-muted">{i.label}</span>
              <span className="block font-medium tabular-nums text-ink">{i.display}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="border-t border-line px-4 py-3">
        <p className="text-[0.75rem] font-medium">Known limitations</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[0.72rem] text-muted">
          {packet.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Answer({ turn, onAsk }: { turn: Turn; onAsk: (q: string) => void }) {
  const [focus, setFocus] = useState<string | null>(null);
  const r = turn.result;
  return (
    <article className="border-t border-line pt-6">
      <p className="text-[1.05rem] font-semibold text-ink">{turn.question}</p>
      <div className="mt-3 grid grid-cols-1 gap-6 xl:grid-cols-[1.45fr_1fr]">
        <div className="min-w-0">
          {!r && !turn.error && <p className="animate-pulse text-sm text-muted">Running analyses and preparing the explanation…</p>}
          {turn.error && <Notice tone="risk">{turn.error}</Notice>}
          {r && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {r.mode === "live" ? <Badge tone="primary">AI explanation · {r.model}</Badge> : <Badge tone="watch">Demo mode · no AI model called</Badge>}
                {r.grounding.grounded ? (
                  <Badge tone="good">All {r.grounding.numbersChecked} numbers match the evidence</Badge>
                ) : (
                  <Badge tone="risk">{r.grounding.unverifiedNumbers.length} unverified number(s)</Badge>
                )}
              </div>
              {r.notices.map((n) => (
                <div key={n} className="mt-3">
                  <Notice tone={n.startsWith("Customer names were replaced") ? "primary" : r.mode === "demo" ? "watch" : "risk"}>{n}</Notice>
                </div>
              ))}

              <p className="mt-4 text-[1rem] leading-relaxed text-ink">{r.response.summary}</p>

              {r.response.facts.length > 0 && (
                <Section title="Facts" hint="what the data shows">
                  <ul className="space-y-2 text-[0.88rem] leading-relaxed">
                    {r.response.facts.map((f, i) => (
                      <li key={i} className="border-l-2 border-glaze/50 pl-3">
                        {f.statement}
                        <Cite ids={f.evidence_ids} onFocus={setFocus} />
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {r.response.hypotheses.length > 0 && (
                <Section title="Possible explanations" hint="not proven; how to check">
                  <ul className="space-y-2.5 text-[0.88rem] leading-relaxed">
                    {r.response.hypotheses.map((h, i) => (
                      <li key={i} className="border-l-2 border-dashed border-ochre/60 pl-3">
                        {h.statement}
                        <Cite ids={h.evidence_ids} onFocus={setFocus} />
                        <p className="mt-0.5 text-[0.8rem] text-muted">To verify: {h.how_to_verify}</p>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {r.response.recommendations.length > 0 && (
                <Section title="Recommended next steps" hint="for a manager to decide">
                  <ul className="space-y-2.5 text-[0.88rem] leading-relaxed">
                    {r.response.recommendations.map((rec, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="mt-0.5 w-14 shrink-0">
                          <Badge tone={rec.priority === "high" ? "risk" : rec.priority === "medium" ? "watch" : "neutral"}>{rec.priority}</Badge>
                        </span>
                        <div>
                          <p className="font-medium">{rec.action}</p>
                          <p className="text-[0.8rem] text-muted">
                            {rec.rationale}
                            <Cite ids={rec.evidence_ids} onFocus={setFocus} />
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {r.response.uncertainties.length > 0 && (
                <Section title="Uncertainty and missing information" hint="read before acting">
                  <ul className="list-disc space-y-1 pl-5 text-[0.85rem] text-muted">
                    {r.response.uncertainties.map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                </Section>
              )}
              {r.grounding.issues.length > 0 && (
                <Section title="Grounding check" hint="automatic comparison with the evidence">
                  <ul className="space-y-1 text-[0.8rem]">
                    {r.grounding.issues.map((iss, i) => (
                      <li key={i} className={iss.severity === "error" ? "text-oxide" : "text-ochre"}>
                        {iss.section} {iss.index + 1}: {iss.message}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {r.response.follow_up_questions.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {r.response.follow_up_questions.map((q) => (
                    <button key={q} type="button" onClick={() => onAsk(q)} className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-[0.8rem] text-ink hover:border-glaze hover:text-glaze-deep">
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <details className="mt-6 rounded-md border border-line bg-paper px-3.5 py-2.5 text-[0.8rem]">
            <summary className="font-medium text-ink">How this answer was produced</summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted">
              <li>
                The question was matched to {turn.route.analyses.length} analysis type(s) by transparent keyword rules:
                <ul className="mt-1 space-y-0.5">
                  {turn.route.analyses.map((a) => (
                    <li key={a}>
                      <span className="text-ink">{ANALYSIS_LABELS[a]}</span> ({ANALYSIS_METHOD[a].toLowerCase()})
                    </li>
                  ))}
                </ul>
              </li>
              {turn.route.interpretation.map((x) => (
                <li key={x}>{x}</li>
              ))}
              <li>Filters used: {turn.packet.filtersDescription}.</li>
              <li>The analytics engine computed every number in the evidence ledger from the loaded data.</li>
              <li>{r?.mode === "live" ? "The AI model received only the evidence ledger (no raw rows) and returned a structured answer." : "No AI provider was called; fixed templates restated the evidence."}</li>
              <li>A grounding check compared every number in the answer with the ledger.</li>
            </ol>
          </details>
        </div>
        <EvidenceLedger packet={turn.packet} focus={focus} />
      </div>
    </article>
  );
}

export function AskView() {
  const ready = useReadyData();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Status | null) => setStatus(s))
      .catch(() => setStatus(null));
  }, []);

  if (!ready) return null;
  const { model, filters, settings } = ready;
  const SUGGESTIONS = suggestions(settings.partnerType);

  async function ask(q: string) {
    const text = q.trim();
    if (!text) return;
    const route = routeQuestion(text, model);
    const f = { ...filters, ...route.filterOverrides };
    const packet = buildEvidence(model, f, text.slice(0, 500), route.analyses, { scenarioPct: route.scenarioPct });
    // privacy option: customer names never leave the browser; aliases are swapped back in the answer
    const anon = settings.anonymiseForAI ? anonymisePacket(packet, model.bundle.customers.map((c) => c.customer_name)) : { packet, aliases: new Map<string, string>() };
    const outbound = anon.packet;
    const id = nextId.current++;
    setTurns((t) => [...t, { id, question: text, route, packet, result: null, error: null }]);
    setQuestion("");
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);

    let result: AskResult | null = null;
    let error: string | null = null;
    const browserFallback = (why: string): AskResult => {
      const response = demoExplain(outbound);
      return { mode: "demo", response, grounding: checkGrounding(response, outbound), notices: [`${why} This demo-mode explanation was generated in the browser. No AI model was called.`] };
    };
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ packet: outbound }) });
      if (res.ok) result = (await res.json()) as AskResult;
      else if ([400, 413, 429].includes(res.status)) {
        error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `The server returned HTTP ${res.status}.`;
      } else result = browserFallback(`The server returned HTTP ${res.status}.`);
    } catch {
      result = browserFallback("The server could not be reached.");
    }
    if (result && anon.aliases.size > 0) {
      result = { ...result, response: deanonymiseResponse(result.response, anon.aliases), notices: [...result.notices, `Customer names were replaced with aliases before sending (${anon.aliases.size} name${anon.aliases.size > 1 ? "s" : ""}) and restored here.`] };
    }
    setTurns((t) => t.map((x) => (x.id === id ? { ...x, result, error } : x)));
  }

  return (
    <>
      <PageHeader
        title="Ask the analyst"
        description="Ask a business question about the loaded data. The analytics engine calculates the evidence; the explanation may only use those numbers, and every claim is checked against them."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[0.8rem]">
        {status?.llm.configured ? (
          <Badge tone="primary">Live AI explanations enabled · {status.llm.model}</Badge>
        ) : (
          <Badge tone="watch">Demo mode: no AI key configured</Badge>
        )}
        <span className="text-muted">Current filters: {describeFilters(filters)}</span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
        className="rounded-lg border border-line bg-surface p-3"
      >
        <label htmlFor="q" className="sr-only">Your question</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="q"
            value={question}
            maxLength={500}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="For example: why did sales increase while collections fell behind?"
            className="h-11 flex-1 rounded-md border border-line-strong bg-paper px-3.5 text-[0.95rem] focus:bg-surface"
          />
          <Button type="submit" disabled={!question.trim()}>Ask</Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => void ask(s)} className="rounded-full border border-line px-3 py-1 text-[0.78rem] text-muted hover:border-glaze hover:text-glaze-deep">
              {s}
            </button>
          ))}
        </div>
      </form>

      <div className="mt-8 space-y-10">
        {turns.length === 0 && (
          <p className="text-center text-sm text-muted">Pick a suggested question or type your own. Answers separate facts, possible explanations and recommended next steps.</p>
        )}
        {turns.map((t, i) => (
          <div key={t.id} ref={i === turns.length - 1 ? endRef : undefined}>
            <Answer turn={t} onAsk={(q) => void ask(q)} />
          </div>
        ))}
      </div>
    </>
  );
}
