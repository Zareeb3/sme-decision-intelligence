"""
Create realistic "as exported" files from the synthetic sample, for demonstrating
the upload screen's automatic column matching: business-style headers,
semicolon delimiters, DD.MM.YYYY dates and thousands separators, as many ERP
and Excel exports produce. All values are fictional.

    python scripts/make_example_exports.py  ->  data/example_exports/*.csv
"""
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "sample-data"
OUT = ROOT / "data" / "example_exports"
OUT.mkdir(parents=True, exist_ok=True)


def dmy(s: str) -> str:
    return f"{s[8:10]}.{s[5:7]}.{s[:4]}" if isinstance(s, str) and len(s) >= 10 else ""


def money(x) -> str:
    return f"{float(x):,.2f}"


o = pd.read_csv(SRC / "orders.csv", keep_default_na=False)
pd.DataFrame({
    "Billing Document": o.order_id, "Billing Date": o.order_date.map(dmy), "Sold-to Party": o.customer_id, "Material": o.product_id,
    "Material Description": o.product_name, "Material Group": o.product_category, "Billed Quantity": o.quantity_sqm,
    "Net Value": o.net_sales_pkr.map(money), "Cost": o.est_cogs_pkr.map(money), "Discount %": o.discount_pct,
    "Billing Type": o.order_status.map({"Delivered": "F2", "Cancelled": "S1"}),
}).to_csv(OUT / "sales_register_export.csv", index=False, sep=";")

c = pd.read_csv(SRC / "customers.csv", keep_default_na=False)
pd.DataFrame({
    "Customer Code": c.customer_id, "Customer Name": c.customer_name, "Customer Group": c.customer_type, "Distribution Channel": c.channel,
    "Sales District": c.region, "City": c.city, "Payment Terms (days)": c.payment_terms_days, "Credit Limit": c.credit_limit_pkr.map(money),
    "Created On": c.onboarding_date.map(dmy), "Block": c.account_status.map({"Active": "", "On Hold": "Blocked", "Inactive": "Inactive"}).replace("", "Active"),
}).to_csv(OUT / "customer_master_export.csv", index=False, sep=";")

i = pd.read_csv(SRC / "invoices.csv", keep_default_na=False)
pd.DataFrame({
    "Invoice No": i.invoice_id, "Customer": i.customer_id, "Invoice Date": i.invoice_date.map(dmy), "Net Due Date": i.due_date.map(dmy),
    "Amount": i.invoice_amount_pkr.map(money), "Amount Paid": i.amount_paid_pkr.map(money), "Clearing Date": i.payment_date.map(dmy),
}).to_csv(OUT / "invoices_ar_export.csv", index=False, sep=";")

t = pd.read_csv(SRC / "targets.csv", keep_default_na=False)
pd.DataFrame({"Period": t.month.map(lambda m: f"{m[5:7]}.{m[:4]}"), "Region": t.region, "Sales Plan": t.sales_target_pkr.map(money), "Collection Plan": t.collection_target_pkr.map(money)}).to_csv(OUT / "targets_plan.csv", index=False, sep=";")

q = pd.read_csv(SRC / "complaints.csv", keep_default_na=False)
pd.DataFrame({
    "Notification": q.complaint_id, "Created On": q.date_opened.map(dmy), "Customer": q.customer_id, "Sales Order": q.order_id, "Material": q.product_id,
    "Defect": q.category, "Priority": q.severity, "Responsible": q.assigned_team, "Status": q.status, "Completion Date": q.date_resolved.map(dmy), "Claim Amount": q.claim_value_pkr.map(money),
}).to_csv(OUT / "complaints_qm_export.csv", index=False, sep=";")
print(f"wrote example exports to {OUT.relative_to(ROOT)}")
