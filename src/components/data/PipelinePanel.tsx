"use client";

/**
 * How to connect an automated data pipeline: the ingest API, the SAP pipeline
 * script and the drop folder, with live status from the server.
 */
import { useEffect, useState } from "react";
import { useData } from "../DataProvider";
import { Badge, Button, Notice } from "../ui";

function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md border border-line bg-ink px-3.5 py-3 font-mono text-[0.75rem] leading-relaxed text-paper">{children}</pre>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(children).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="absolute right-2 top-2 rounded border border-white/20 px-2 py-0.5 text-[0.7rem] text-paper/80 hover:text-paper"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function StatusRow({ label, ok, okText, offText }: { label: string; ok: boolean; okText: string; offText: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/70 py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-[0.85rem] font-medium">{label}</p>
        <p className="mt-0.5 break-all text-[0.78rem] text-muted">{ok ? okText : offText}</p>
      </div>
      <Badge tone={ok ? "good" : "watch"}>{ok ? "Ready" : "Not set up"}</Badge>
    </div>
  );
}

export function PipelinePanel() {
  const { server, reload } = useData();
  const [origin, setOrigin] = useState("https://your-app");
  const [checking, setChecking] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-line bg-surface px-4 py-1">
        <StatusRow label="Server storage" ok={server.storage.enabled} okText="Company data is stored on this server and shared by all users." offText={server.storage.reason} />
        <StatusRow label="Pipeline access token" ok={server.ingestConfigured} okText="INGEST_TOKEN is set; pipelines can send data." offText="Set INGEST_TOKEN on the server (a long random value) to accept pipeline data." />
        <StatusRow label="Drop folder" ok={Boolean(server.dropFolder)} okText={server.dropFolder ?? ""} offText="Available when server storage is enabled." />
      </div>

      {!server.storage.enabled && (
        <Notice tone="watch">
          Pipelines need a self-hosted deployment with a data folder (see docs/DEPLOYMENT.md, Docker in one command). On this deployment, upload CSV files instead; they are kept in your browser.
        </Notice>
      )}

      <section>
        <h3 className="text-[0.9rem] font-semibold">Option 1. SAP pipeline script (recommended for SAP ECC and S/4HANA)</h3>
        <p className="mt-1 text-[0.82rem] leading-relaxed text-muted">
          Export the standard tables (VBRK, VBRP, KNA1, KNVV, BSID, BSAD, optionally KNKK and QMEL) from SE16N or a scheduled background job into a folder. The script maps your SAP codes (customer groups, regions, material groups) using a config file, checks integrity and sends the result here. Schedule it nightly with Windows Task Scheduler or cron.
        </p>
        <div className="mt-2">
          <Code>{`pip install pandas
python pipeline/sap_pipeline.py --input \\\\fileserver\\sap_exports --config pipeline/config.json \\
  --out ./canonical --push ${origin} --token <INGEST_TOKEN>`}</Code>
        </div>
      </section>

      <section>
        <h3 className="text-[0.9rem] font-semibold">Option 2. Any ETL or automation tool (ingest API)</h3>
        <p className="mt-1 text-[0.82rem] leading-relaxed text-muted">
          Send each dataset as CSV or JSON. Use <code className="font-mono">?mode=append</code> for incremental loads (rows with the same ID are replaced). Invalid files are rejected and the current data stays.
        </p>
        <div className="mt-2">
          <Code>{`curl -X POST "${origin}/api/ingest/invoices?mode=replace" \\
  -H "Authorization: Bearer <INGEST_TOKEN>" \\
  -H "Content-Type: text/csv" \\
  --data-binary @invoices.csv`}</Code>
        </div>
        <p className="mt-2 text-[0.78rem] text-muted">Datasets: orders, customers, invoices, payments, targets, complaints. n8n, Power Automate, Azure Data Factory and SSIS can all make this call.</p>
      </section>

      <section>
        <h3 className="text-[0.9rem] font-semibold">Option 3. Drop folder</h3>
        <p className="mt-1 text-[0.82rem] leading-relaxed text-muted">
          Have an SAP job or a person save files named after the dataset (for example <code className="font-mono">invoices_2026-10-17.csv</code>) into the drop folder. They are imported the next time anyone opens the app, then moved to <code className="font-mono">processed/</code> or, with a reason, to <code className="font-mono">failed/</code>.
        </p>
        {server.dropFolder && <Code>{server.dropFolder}</Code>}
      </section>

      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            await reload();
            setChecking(false);
          }}
        >
          {checking ? "Checking…" : "Check for new data"}
        </Button>
        <span className="text-[0.78rem] text-muted">Imports anything waiting in the drop folder and reloads.</span>
      </div>
    </div>
  );
}
