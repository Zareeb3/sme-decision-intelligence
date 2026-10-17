"""
Turn the synthetic sample into SAP-style table extracts (VBRK, VBRP, KNA1, KNVV,
KNKK, BSID, BSAD, QMEL) for demonstrating and testing the SAP pipeline.

Formats mimic a typical SE16N/ALV export: DD.MM.YYYY dates, 1,234,567.00
amounts, SAP codes for customer groups, channels, regions and material groups.
All values are fictional.

    python scripts/make_sap_extracts.py   ->  data/sap_sample/*.csv
"""
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "sample-data"
OUT = ROOT / "data" / "sap_sample"
OUT.mkdir(parents=True, exist_ok=True)

GRP = {"Distributor": "01", "Dealer": "02", "Key Account": "03", "Institutional": "04"}
CHN = {"Distribution": "10", "Retail": "20", "Projects": "30"}
REG = {"Central": "CEN", "North": "NOR", "South": "SOU", "West": "WES"}
MAT = {"Ceramic Floor": "CFL", "Wall Tiles": "WAL", "Porcelain Floor": "PFL", "Glazed Vitrified (GVT)": "GVT", "Outdoor & Parking": "OUT"}
CMP = {"Shade Variation": "SHD", "Surface Defect": "SRF", "Size / Calibration": "CAL", "Breakage in Transit": "BRK", "Delivery Delay": "DLY", "Short Supply": "SHT", "Billing Discrepancy": "BIL"}
PRI = {"High": "1", "Medium": "3", "Low": "4"}


def d(iso: str) -> str:
    return f"{iso[8:10]}.{iso[5:7]}.{iso[:4]}" if iso else ""


def amt(x: float) -> str:
    return f"{float(x):,.2f}"


cust = pd.read_csv(SRC / "customers.csv", keep_default_na=False)
orders = pd.read_csv(SRC / "orders.csv", keep_default_na=False)
inv = pd.read_csv(SRC / "invoices.csv", keep_default_na=False)
cmp = pd.read_csv(SRC / "complaints.csv", keep_default_na=False)

pd.DataFrame({
    "KUNNR": cust.customer_id, "NAME1": cust.customer_name, "ORT01": cust.city, "REGIO": cust.region.map(REG),
    "ERDAT": cust.onboarding_date.map(d), "LOEVM": (cust.account_status == "Inactive").map({True: "X", False: ""}), "SPERR": "",
}).to_csv(OUT / "KNA1.csv", index=False)
pd.DataFrame({
    "KUNNR": cust.customer_id, "VKORG": "1000", "VTWEG": cust.channel.map(CHN), "KDGRP": cust.customer_type.map(GRP),
    "BZIRK": cust.region.map(REG), "VKBUR": "", "ZTERM": cust.payment_terms_days.map(lambda t: f"Z{int(t):03d}"),
    "AUFSD": (cust.account_status == "On Hold").map({True: "01", False: ""}),
}).to_csv(OUT / "KNVV.csv", index=False)
pd.DataFrame({"KUNNR": cust.customer_id, "KLIMK": cust.credit_limit_pkr.map(amt)}).to_csv(OUT / "KNKK.csv", index=False)

vbeln = {oid: f"9{100000 + i:08d}" for i, oid in enumerate(orders.order_id)}
pd.DataFrame({
    "VBELN": orders.order_id.map(vbeln), "FKART": "F2", "FKDAT": orders.order_date.map(d), "KUNAG": orders.customer_id,
    "VKORG": "1000", "VTWEG": orders.channel.map(CHN), "FKSTO": (orders.order_status == "Cancelled").map({True: "X", False: ""}), "WAERK": "PKR",
}).to_csv(OUT / "VBRK.csv", index=False)
pd.DataFrame({
    "VBELN": orders.order_id.map(vbeln), "POSNR": "000010", "MATNR": orders.product_id, "ARKTX": orders.product_name,
    "MATKL": orders.product_category.map(MAT), "FKIMG": orders.quantity_sqm.map(lambda q: f"{q:,.3f}"), "VRKME": "M2",
    "NETWR": orders.net_sales_pkr.map(amt), "WAVWR": orders.est_cogs_pkr.map(amt),
    "KZWI1": (orders.quantity_sqm * orders.list_price_per_sqm).map(amt),
}).to_csv(OUT / "VBRP.csv", index=False)

# FI receivables: one RV document per invoice; payments as DZ documents
order_of = dict(zip(orders.order_id, orders.order_id.map(vbeln)))
bsid, bsad = [], []
for i, r in inv.reset_index().iterrows():
    belnr = f"{1400000000 + i}"
    terms = (pd.Timestamp(r.due_date) - pd.Timestamp(r.invoice_date)).days
    base = {"KUNNR": r.customer_id, "BELNR": belnr, "BUZEI": "001", "GJAHR": r.invoice_date[:4], "BLART": "RV", "BLDAT": d(r.invoice_date), "BUDAT": d(r.invoice_date),
            "ZFBDT": d(r.invoice_date), "ZBD1T": str(terms), "SHKZG": "S", "DMBTR": amt(r.invoice_amount_pkr), "VBELN": order_of[r.order_id], "REBZG": "", "AUGDT": "", "AUGBL": ""}
    pay_doc = f"{1500000000 + i}"
    if r.status == "Paid":
        bsad.append({**base, "AUGDT": d(r.payment_date), "AUGBL": pay_doc})
        bsad.append({**base, "BELNR": pay_doc, "BLART": "DZ", "BLDAT": d(r.payment_date), "BUDAT": d(r.payment_date), "ZFBDT": "", "ZBD1T": "", "SHKZG": "H",
                     "DMBTR": amt(r.amount_paid_pkr), "VBELN": "", "AUGDT": d(r.payment_date), "AUGBL": pay_doc})
    elif r.status == "Partially Paid":
        bsid.append(base)
        bsid.append({**base, "BELNR": pay_doc, "BLART": "DZ", "BLDAT": d(r.payment_date), "BUDAT": d(r.payment_date), "ZFBDT": "", "ZBD1T": "", "SHKZG": "H",
                     "DMBTR": amt(r.amount_paid_pkr), "VBELN": "", "REBZG": belnr})
    else:
        bsid.append(base)
pd.DataFrame(bsid).to_csv(OUT / "BSID.csv", index=False)
pd.DataFrame(bsad).to_csv(OUT / "BSAD.csv", index=False)

pd.DataFrame({
    "QMNUM": cmp.complaint_id.str.replace("CMP", "3000", regex=False), "QMART": "Q1", "ERDAT": cmp.date_opened.map(d), "KUNUM": cmp.customer_id,
    "MATNR": cmp.product_id, "VBELN": cmp.order_id, "QMCOD": cmp.category.map(CMP), "PRIOK": cmp.severity.map(PRI),
    "QMDAB": cmp.date_resolved.map(d), "ZZCLAIM": cmp.claim_value_pkr.map(amt),
}).to_csv(OUT / "QMEL.csv", index=False)

pd.read_csv(SRC / "targets.csv").to_csv(OUT / "targets.csv", index=False)
print(f"wrote SAP-style extracts to {OUT.relative_to(ROOT)}")
