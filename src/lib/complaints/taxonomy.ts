/**
 * Complaint categories and departments.
 *
 * The defaults follow the categories and owning teams already present in the
 * complaints data (Quality, Production, Logistics, Commercial), plus a few
 * categories a tile manufacturer meets in practice. Categories and teams found
 * in a company's own data are added automatically, so the AI is never forced
 * into a label the business does not use.
 */
import type { Priority } from "./types";

export interface CategoryDef {
  name: string;
  department: string;
  description: string;
}

export const UNCLEAR_CATEGORY = "Unclear / insufficient information";

export const DEFAULT_CATEGORIES: CategoryDef[] = [
  { name: "Shade Variation", department: "Quality", description: "Tiles from the same order or batch differ in colour or shade." },
  { name: "Surface Defect", department: "Quality", description: "Pinholes, glaze defects, scratches, spots, crazing or print defects visible on the tile face." },
  { name: "Size / Calibration", department: "Production", description: "Tiles differ in size, thickness, squareness or warpage, so they do not lay flat or align." },
  { name: "Breakage in Transit", department: "Logistics", description: "Tiles arrived broken, chipped or cracked because of handling or transport." },
  { name: "Delivery Delay", department: "Logistics", description: "Delivery arrived late or not on the promised date." },
  { name: "Short Supply", department: "Logistics", description: "Fewer boxes or square metres delivered than invoiced or ordered, or wrong item delivered." },
  { name: "Billing Discrepancy", department: "Commercial", description: "Invoice price, discount, quantity or terms differ from what was agreed." },
  { name: "Payment / Credit Note", department: "Finance", description: "A payment was not applied, a credit note or refund was not issued, or the account statement is wrong." },
  { name: "Product Safety", department: "Quality", description: "A person was injured or put at risk, for example slippery floors, falling wall tiles or sharp edges." },
  { name: "Installation / Usage", department: "Customer Service", description: "Problems caused by laying, grouting, cleaning or using the product, or requests for technical guidance." },
  { name: "Sales & Service Conduct", department: "Commercial", description: "Behaviour of staff, broken promises, poor communication or unresponsive service." },
  { name: UNCLEAR_CATEGORY, department: "Customer Service", description: "Not enough information to classify the complaint reliably." },
];

export const DEFAULT_DEPARTMENTS = ["Quality", "Production", "Logistics", "Commercial", "Finance", "Customer Service"];

export interface Taxonomy {
  categories: CategoryDef[];
  departments: string[];
}

/** Defaults plus any categories and teams that appear in the company's complaint data. */
export function buildTaxonomy(dataCategories: string[] = [], dataTeams: string[] = []): Taxonomy {
  const categories = [...DEFAULT_CATEGORIES];
  const departments = [...DEFAULT_DEPARTMENTS];
  for (const t of dataTeams) if (t && t !== "Unassigned" && !departments.some((d) => d.toLowerCase() === t.toLowerCase())) departments.push(t);
  for (const c of dataCategories) {
    if (c && !categories.some((d) => d.name.toLowerCase() === c.toLowerCase())) categories.splice(categories.length - 1, 0, { name: c, department: "Customer Service", description: "Category used in the company's complaint data." });
  }
  return { categories, departments };
}

export function defaultDepartment(category: string, tax: Taxonomy): string {
  return tax.categories.find((c) => c.name.toLowerCase() === category.toLowerCase())?.department ?? "Customer Service";
}

/** Match a label case-insensitively to the allowed list; null when it is not allowed. */
export function canonicalLabel(value: string | null | undefined, allowed: string[]): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  return allowed.find((a) => a.toLowerCase() === v) ?? null;
}

/** Imported complaints carry Low / Medium / High severity; map priority onto it for shared analytics. */
export function priorityToSeverity(p: Priority): "Low" | "Medium" | "High" {
  return p === "Critical" || p === "High" ? "High" : p;
}

export function severityToPriority(s: string): Priority {
  return s === "High" ? "High" : s === "Medium" ? "Medium" : "Low";
}
