"use client";

import { useState } from "react";
import { useData } from "../DataProvider";
import { Badge } from "../ui";
import { DATASET_SPECS } from "@/lib/data/schemas";
import { DATASET_KINDS, type DatasetKind } from "@/lib/data/types";
import { toCsv } from "@/lib/data/csv";
import { FIELD_SPECS } from "@/lib/data/mapping";
import { formatDate, formatNumber } from "@/lib/analytics/format";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV template with the canonical headers and one example row of field descriptions. */
export function downloadTemplate(kind: DatasetKind) {
  const specs = FIELD_SPECS[kind];
  const header = specs.map((s) => s.field).join(",");
  const hint = specs.map((s) => `"${(s.required ? "required: " : "optional: ") + s.label}"`).join(",");
  download(`${kind}_template.csv`, `${header}\n${hint}\n`);
}

export function DatasetTable() {
  const { origin, datasets, model, server, removeCompanyData, rollbackDataset } = useData();
  const [message, setMessage] = useState<string | null>(null);
  const company = origin === "server" || origin === "browser";

  return (
    <div>
      <div className="-mx-5 overflow-x-auto">
        <table className="w-full min-w-[640px] text-[0.84rem]">
          <thead>
            <tr className="border-b border-line text-left text-[0.75rem] text-muted">
              <th className="px-5 py-2 font-medium">Dataset</th>
              <th className="px-5 py-2 font-medium">Status</th>
              <th className="px-5 py-2 text-right font-medium">Rows</th>
              <th className="px-5 py-2 font-medium">Updated</th>
              <th className="px-5 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {DATASET_KINDS.map((k) => {
              const spec = DATASET_SPECS[k];
              const d = company ? datasets[k] : undefined;
              const sampleRows = origin === "sample" && model ? (model.bundle[k] as unknown[]).length : 0;
              return (
                <tr key={k} className="border-b border-line/70 last:border-0 align-top">
                  <td className="px-5 py-2.5">
                    <p className="font-medium">{spec.label}</p>
                    <p className="text-[0.72rem] text-faint">{spec.optional ? "Optional" : "Required"} · {spec.fileName}</p>
                  </td>
                  <td className="px-5 py-2.5">
                    {d ? (
                      <Badge tone="good">{d.source === "upload" ? "Uploaded" : d.source === "drop-folder" ? "Drop folder" : "Pipeline"}</Badge>
                    ) : origin === "sample" && sampleRows > 0 ? (
                      <Badge tone="watch">Sample</Badge>
                    ) : (
                      <Badge tone={spec.optional ? "neutral" : "risk"}>Not loaded</Badge>
                    )}
                    {d?.by && <p className="mt-0.5 max-w-[14rem] truncate text-[0.72rem] text-faint">by {d.by}</p>}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{d ? formatNumber(d.rows) : sampleRows ? formatNumber(sampleRows) : "—"}</td>
                  <td className="px-5 py-2.5 whitespace-nowrap">{d ? formatDate(d.updatedAt.slice(0, 10)) : "—"}</td>
                  <td className="px-5 py-2.5">
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[0.8rem]">
                      {model && (model.bundle[k] as unknown[]).length > 0 && (
                        <button type="button" className="text-glaze hover:underline" onClick={() => download(`${k}.csv`, toCsv(model.bundle[k] as unknown as Record<string, unknown>[], spec.allColumns))}>
                          Download
                        </button>
                      )}
                      <button type="button" className="text-glaze hover:underline" onClick={() => downloadTemplate(k)}>
                        Template
                      </button>
                      {d && origin === "server" && (
                        <button type="button" className="text-glaze hover:underline" onClick={async () => setMessage(await rollbackDataset(k))}>
                          Restore previous
                        </button>
                      )}
                      {d && (
                        <button
                          type="button"
                          className="text-muted hover:text-oxide"
                          onClick={async () => {
                            if (window.confirm(`Remove ${spec.label.toLowerCase()} from ${origin === "server" ? "the server" : "this browser"}?`)) {
                              await removeCompanyData(k);
                              setMessage(`${spec.label} removed.`);
                            }
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {message && <p className="mt-3 text-[0.8rem] text-muted">{message}</p>}
      {!server.reachable && <p className="mt-3 text-[0.78rem] text-faint">Server not reachable: showing data stored in this browser.</p>}
    </div>
  );
}
