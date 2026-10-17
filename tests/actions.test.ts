import { describe, expect, it } from "vitest";
import { buildModel } from "../src/lib/analytics/model";
import { defaultFilters } from "../src/lib/analytics/filters";
import { approvalRequestSchema, proposeActions } from "../src/lib/actions";
import { rateLimit } from "../src/lib/server/rateLimit";
import { sampleBundle } from "./fixtures";

describe("workflow action proposals", () => {
  const model = buildModel(sampleBundle());
  const actions = proposeActions(model, defaultFilters(model), { overdueThresholdPkr: 10_000_000, maxPerType: 5 });

  it("proposes overdue alerts only above the threshold", () => {
    const alerts = actions.filter((a) => a.type === "overdue_alert");
    expect(alerts.length).toBeGreaterThan(0);
    for (const a of alerts) expect(a.payload.overdue_pkr as number).toBeGreaterThanOrEqual(10_000_000);
  });

  it("includes follow-up tasks, complaint routing and a management summary", () => {
    const types = new Set(actions.map((a) => a.type));
    expect(types.has("follow_up_task")).toBe(true);
    expect(types.has("complaint_routing")).toBe(true);
    expect(types.has("management_summary")).toBe(true);
  });

  it("gives every action a unique ID", () => {
    expect(new Set(actions.map((a) => a.id)).size).toBe(actions.length);
  });
});

describe("approval requirement", () => {
  const action = { id: "x", type: "overdue_alert" as const, title: "t", reason: "r", recipient: "Credit control", payload: {} };

  it("accepts an explicit approval with a named approver", () => {
    expect(approvalRequestSchema.safeParse({ action, approval: { approved: true, approverName: "Ayesha Khan" } }).success).toBe(true);
  });
  it("rejects a request without approval", () => {
    expect(approvalRequestSchema.safeParse({ action, approval: { approved: false, approverName: "Ayesha Khan" } }).success).toBe(false);
    expect(approvalRequestSchema.safeParse({ action }).success).toBe(false);
  });
  it("rejects an approval without an approver name", () => {
    expect(approvalRequestSchema.safeParse({ action, approval: { approved: true, approverName: " " } }).success).toBe(false);
  });
});

describe("rate limiter", () => {
  it("allows up to the limit within a window, then blocks, then resets", () => {
    const t = 1_000_000;
    expect(rateLimit("k", 2, 1000, t)).toBe(true);
    expect(rateLimit("k", 2, 1000, t + 1)).toBe(true);
    expect(rateLimit("k", 2, 1000, t + 2)).toBe(false);
    expect(rateLimit("k", 2, 1000, t + 1001)).toBe(true);
  });
});
