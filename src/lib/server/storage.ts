/**
 * Server-side dataset storage (self-hosted deployments).
 *
 * Layout under DATA_DIR:
 *   datasets/<kind>.csv        current canonical data (always validated)
 *   datasets/<kind>.prev.csv   previous version, kept for one-step rollback
 *   manifest.json              rows, source and timestamp per dataset
 *   settings.json              company settings
 *   incoming/                  drop folder: files placed here are imported
 *   processed/, failed/        drop-folder archive
 *
 * Storage is enabled when DATA_DIR is set, or by default when running outside
 * Vercel (./.data). Vercel's filesystem is read-only/ephemeral, so storage is
 * off there unless DATA_DIR points somewhere persistent.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { DatasetKind } from "../data/types";
import { DATASET_KINDS } from "../data/types";

export interface DatasetMeta {
  rows: number;
  bytes: number;
  updatedAt: string;
  source: "upload" | "pipeline" | "drop-folder";
  /** Who or what loaded it: approver name, pipeline name, file name. */
  by: string;
  notes: string[];
}

export type Manifest = Partial<Record<DatasetKind, DatasetMeta>>;

export interface StorageStatus {
  enabled: boolean;
  dir: string | null;
  reason: string;
}

export function storageStatus(env: Record<string, string | undefined> = process.env): StorageStatus {
  if (env.DATA_DIR?.trim()) return { enabled: true, dir: path.resolve(env.DATA_DIR.trim()), reason: "DATA_DIR is set." };
  if (env.VERCEL) {
    return { enabled: false, dir: null, reason: "This deployment has no persistent disk (Vercel). Data stays in each user's browser. Self-host with DATA_DIR to share company data and use the pipeline." };
  }
  return { enabled: true, dir: path.resolve(process.cwd(), ".data"), reason: "Using the default ./.data folder." };
}

/** ENABLE_SAMPLE_DATA=false hides the bundled sample data (recommended for company deployments). */
export function sampleDataEnabled(env: Record<string, string | undefined> = process.env) {
  return (env.ENABLE_SAMPLE_DATA ?? "true").toLowerCase() !== "false";
}

export class Storage {
  constructor(readonly dir: string) {}

  static fromEnv(env: Record<string, string | undefined> = process.env): Storage | null {
    const s = storageStatus(env);
    return s.enabled && s.dir ? new Storage(s.dir) : null;
  }

  private p(...parts: string[]) {
    return path.join(this.dir, ...parts);
  }

  async ensure() {
    for (const d of ["datasets", "incoming", "processed", "failed"]) await fs.mkdir(this.p(d), { recursive: true });
  }

  private async writeAtomic(file: string, content: string) {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, file);
  }

  async readManifest(): Promise<Manifest> {
    try {
      return JSON.parse(await fs.readFile(this.p("manifest.json"), "utf8")) as Manifest;
    } catch {
      return {};
    }
  }

  async readDataset(kind: DatasetKind): Promise<string | null> {
    try {
      return await fs.readFile(this.p("datasets", `${kind}.csv`), "utf8");
    } catch {
      return null;
    }
  }

  async saveDataset(kind: DatasetKind, csv: string, meta: Omit<DatasetMeta, "bytes" | "updatedAt">): Promise<DatasetMeta> {
    await this.ensure();
    const file = this.p("datasets", `${kind}.csv`);
    try {
      await fs.copyFile(file, this.p("datasets", `${kind}.prev.csv`));
    } catch {
      /* first version */
    }
    await this.writeAtomic(file, csv);
    const manifest = await this.readManifest();
    const full: DatasetMeta = { ...meta, bytes: Buffer.byteLength(csv), updatedAt: new Date().toISOString() };
    manifest[kind] = full;
    await this.writeAtomic(this.p("manifest.json"), JSON.stringify(manifest, null, 2));
    return full;
  }

  /** Restore the previous version of a dataset. Returns false when there is none. */
  async rollback(kind: DatasetKind): Promise<boolean> {
    const prev = this.p("datasets", `${kind}.prev.csv`);
    try {
      const text = await fs.readFile(prev, "utf8");
      await this.writeAtomic(this.p("datasets", `${kind}.csv`), text);
      await fs.unlink(prev);
      const manifest = await this.readManifest();
      const m = manifest[kind];
      if (m) {
        manifest[kind] = { ...m, rows: Math.max(0, text.split("\n").filter((l) => l.trim()).length - 1), bytes: Buffer.byteLength(text), updatedAt: new Date().toISOString(), notes: ["Restored previous version."] };
        await this.writeAtomic(this.p("manifest.json"), JSON.stringify(manifest, null, 2));
      }
      return true;
    } catch {
      return false;
    }
  }

  async deleteDataset(kind: DatasetKind) {
    for (const f of [`${kind}.csv`, `${kind}.prev.csv`]) await fs.rm(this.p("datasets", f), { force: true });
    const manifest = await this.readManifest();
    delete manifest[kind];
    await this.ensure();
    await this.writeAtomic(this.p("manifest.json"), JSON.stringify(manifest, null, 2));
  }

  async clearAll() {
    for (const k of DATASET_KINDS) await this.deleteDataset(k);
  }

  async readSettings(): Promise<unknown | null> {
    try {
      return JSON.parse(await fs.readFile(this.p("settings.json"), "utf8"));
    } catch {
      return null;
    }
  }

  async saveSettings(settings: unknown) {
    await this.ensure();
    await this.writeAtomic(this.p("settings.json"), JSON.stringify(settings, null, 2));
  }

  async listIncoming(): Promise<string[]> {
    try {
      return (await fs.readdir(this.p("incoming"))).filter((f) => /\.(csv|txt|tsv)$/i.test(f)).sort();
    } catch {
      return [];
    }
  }

  async readIncoming(name: string): Promise<string> {
    return fs.readFile(this.p("incoming", path.basename(name)), "utf8");
  }

  async archiveIncoming(name: string, outcome: "processed" | "failed", log?: string) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = path.basename(name);
    await fs.rename(this.p("incoming", base), this.p(outcome, `${stamp}-${base}`));
    if (log) await fs.writeFile(this.p(outcome, `${stamp}-${base}.log`), log, "utf8");
  }

  get incomingDir() {
    return this.p("incoming");
  }
}
