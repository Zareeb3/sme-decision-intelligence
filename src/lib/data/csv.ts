/**
 * Small, dependency-free CSV parser (RFC 4180 style).
 * Handles quoted fields, escaped quotes (""), commas and line breaks inside
 * quotes, CRLF line endings and a UTF-8 byte-order mark (common in Excel exports).
 *
 * Why not a library? The format we accept is simple, this keeps the bundle
 * small, and every edge case below is covered by tests in tests/csv.test.ts.
 */

export interface ParsedCsv {
  headers: string[];
  delimiter: string;
  rows: Record<string, string>[];
  /** Rows whose column count differed from the header (1-based line numbers). */
  malformedLines: number[];
}

/**
 * Pick the delimiter from the first line: comma, semicolon (European Excel),
 * tab (SAP "text with tabs") or pipe (SAP list output).
 */
export function detectDelimiter(text: string): string {
  const firstLine = (text.split(/\r?\n/).find((l) => l.trim() !== "" && !/^[-+|\s]+$/.test(l)) ?? "").replace(/"[^"]*"/g, "");
  const counts: [string, number][] = [",", ";", "\t", "|"].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

export function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(clean);
  let records = tokenize(clean, delimiter);
  // drop fully blank lines and SAP list ruler lines such as "-----" or "|---|---|"
  records = records.filter((r) => !(r.fields.every((x) => x.trim() === "") || r.fields.every((x) => /^[-+=\s]*$/.test(x))));
  if (delimiter === "|") {
    // SAP list output wraps each line in pipes: "|A|B|" -> ["", "A", "B", ""]
    records = records.map((r) => ({ ...r, fields: r.fields[0].trim() === "" && r.fields.length > 1 ? r.fields.slice(1, r.fields[r.fields.length - 1].trim() === "" ? -1 : undefined) : r.fields }));
  }
  if (records.length === 0) return { headers: [], rows: [], malformedLines: [], delimiter };

  const headers = records[0].fields.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const rows: Record<string, string>[] = [];
  const malformedLines: number[] = [];
  for (const rec of records.slice(1)) {
    if (rec.fields.length !== headers.length) {
      malformedLines.push(rec.line);
      continue;
    }
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = rec.fields[i].trim();
    });
    rows.push(row);
  }
  return { headers, rows, malformedLines, delimiter };
}

interface RawRecord {
  fields: string[];
  line: number;
}

function tokenize(text: string, delimiter: string): RawRecord[] {
  const out: RawRecord[] = [];
  let field = "";
  let fields: string[] = [];
  let inQuotes = false;
  let line = 1;
  let recordStartLine = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      fields.push(field);
      out.push({ fields, line: recordStartLine });
      fields = [];
      field = "";
      line++;
      recordStartLine = line;
    } else {
      field += ch;
    }
  }
  if (field !== "" || fields.length > 0) {
    fields.push(field);
    out.push({ fields, line: recordStartLine });
  }
  return out;
}

/** Serialise rows back to CSV (used for "download filtered data"). */
export function toCsv(rows: Record<string, unknown>[], headers?: string[]): string {
  if (rows.length === 0 && !headers) return "";
  const cols = headers ?? Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
