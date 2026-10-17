"""
Independent reference implementation of the core KPIs using pandas.

Why: the TypeScript analytics engine is tested against these numbers
(tests/reference.test.ts). Two implementations written separately, in two
languages, agreeing on the same data is much stronger evidence of correctness
than one implementation tested against itself.

Run:  python scripts/reference_kpis.py   ->  evals/reference_kpis.json
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / "public" / "sample-data"

orders = pd.read_csv(D / "orders.csv", dtype={"order_id": str, "customer_id": str})
customers = pd.read_csv(D / "customers.csv")
invoices = pd.read_csv(D / "invoices.csv", keep_default_na=False)
targets = pd.read_csv(D / "targets.csv")
complaints = pd.read_csv(D / "complaints.csv", keep_default_na=False)

invoices["payment_date"] = invoices["payment_date"].astype(str)
inv = invoices.merge(orders[["order_id", "region", "channel", "product_category"]], on="order_id", how="left")

CASES = [
    {"id": "q3_2026_all", "start": "2026-07-01", "end": "2026-09-30", "regions": [], "channels": []},
    {"id": "q3_2026_south", "start": "2026-07-01", "end": "2026-09-30", "regions": ["South"], "channels": []},
    {"id": "fy2025_central_retail", "start": "2025-01-01", "end": "2025-12-31", "regions": ["Central"], "channels": ["Retail"]},
    {"id": "h1_2025_north_west", "start": "2025-01-01", "end": "2025-06-30", "regions": ["North", "West"], "channels": []},
]


def dims(df: pd.DataFrame, case: dict) -> pd.DataFrame:
    if case["regions"]:
        df = df[df.region.isin(case["regions"])]
    if case["channels"]:
        df = df[df.channel.isin(case["channels"])]
    return df


def days_between(a: pd.Series, b: str) -> pd.Series:
    return (pd.Timestamp(b) - pd.to_datetime(a)).dt.days


results = {}
for case in CASES:
    s, e = case["start"], case["end"]
    as_of = e
    o = dims(orders[(orders.order_status == "Delivered") & (orders.order_date >= s) & (orders.order_date <= e)], case)
    net = float(o.net_sales_pkr.sum())
    cogs = float(o.est_cogs_pkr.sum())

    i = dims(inv, case)
    collections = float(i[(i.payment_date != "") & (i.payment_date >= s) & (i.payment_date <= e)].amount_paid_pkr.sum())

    snap = i[i.invoice_date <= as_of].copy()
    paid = snap.amount_paid_pkr.where((snap.payment_date != "") & (snap.payment_date <= as_of), 0.0)
    snap["out"] = (snap.invoice_amount_pkr - paid).clip(lower=0)
    snap = snap[snap.out > 0]
    snap["dpd"] = days_between(snap.due_date, as_of)
    outstanding = float(snap.out.sum())
    overdue = float(snap[snap.dpd > 0].out.sum())
    bins = {
        "Not yet due": float(snap[snap.dpd <= 0].out.sum()),
        "1–30 days": float(snap[(snap.dpd > 0) & (snap.dpd <= 30)].out.sum()),
        "31–60 days": float(snap[(snap.dpd > 30) & (snap.dpd <= 60)].out.sum()),
        "61–90 days": float(snap[(snap.dpd > 60) & (snap.dpd <= 90)].out.sum()),
        "90+ days": float(snap[snap.dpd > 90].out.sum()),
    }

    raised = i[(i.invoice_date >= s) & (i.invoice_date <= e)].copy()
    rpaid = raised.amount_paid_pkr.where((raised.payment_date != "") & (raised.payment_date <= as_of), 0.0)
    fully = int(((raised.invoice_amount_pkr - rpaid).clip(lower=0) <= 1).sum())

    by_cust = o.groupby("customer_id").net_sales_pkr.sum().sort_values(ascending=False)
    top5 = float(by_cust.head(5).sum() / by_cust.sum() * 100) if len(by_cust) else 0.0
    hhi = float(((by_cust / by_cust.sum() * 100) ** 2).sum()) if len(by_cust) else 0.0

    t = targets[(targets.month >= s[:7]) & (targets.month <= e[:7])]
    if case["regions"]:
        t = t[t.region.isin(case["regions"])]
    has_targets = not case["channels"]

    c = complaints.merge(customers[["customer_id", "region", "channel"]], on="customer_id", how="left")
    c = dims(c, case)
    open_c = c[(c.date_opened <= as_of) & ((c.status != "Resolved") | (c.date_resolved > as_of))]

    results[case["id"]] = {
        "filters": case,
        "netSales": net,
        "estCogs": cogs,
        "estGrossMarginPct": (net - cogs) / net * 100 if net else None,
        "orderCount": int(len(o)),
        "collections": collections,
        "outstanding": outstanding,
        "overdue": overdue,
        "aging": bins,
        "invoicesRaised": int(len(raised)),
        "invoicesFullyPaid": fully,
        "top5SharePct": top5,
        "hhi": hhi,
        "salesTarget": float(t.sales_target_pkr.sum()) if has_targets else None,
        "collectionTarget": float(t.collection_target_pkr.sum()) if has_targets else None,
        "openComplaints": int(len(open_c)),
    }

out = ROOT / "evals" / "reference_kpis.json"
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(results, indent=2, ensure_ascii=False))
print(f"wrote {out.relative_to(ROOT)}")
for k, v in results.items():
    print(k, f"net={v['netSales']:,.0f} coll={v['collections']:,.0f} overdue={v['overdue']:,.0f} openC={v['openComplaints']}")
