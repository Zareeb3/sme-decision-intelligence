"""
Synthetic data generator for the SME AI Decision Intelligence System.

Business: "Zarnab Tiles (Pvt) Ltd" — a FICTIONAL Pakistani ceramic-tile
manufacturer and distributor. Every customer, product, number and event in
this dataset is invented. No employer or customer data is used.

Run:   python scripts/generate_synthetic_data.py
Output: public/sample-data/*.csv  (loaded by the web app)
        data/messy/*.csv          (deliberately broken files for validation demos)

The generator is seeded, so it produces identical files on every run.

Deliberate "storylines" (so the analytics have something real to find):
  1. Q3-2026 (Jul-Sep): a quarter-end sales push into Distribution customers in
     the South and Central regions. Sales beat target, but South-region
     distributors pay much later than their terms -> collections fall behind.
  2. From 2026-01 estimated production cost rises ~8% (energy prices), and from
     2026-04 "Porcelain 60x60 Polished Beige" carries extra competitive
     discounts -> its estimated margin is squeezed.
  3. Aug-Sep 2026: a shade-variation complaint spike on "GVT 60x120 Marble
     Glossy" (a single production batch problem).
  4. Two customers carry old, partially unpaid invoices (90+ days overdue).
  5. ~1.5% of orders are cancelled and must be excluded from net sales.
"""

from __future__ import annotations

import math
import random
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 42
rng = np.random.default_rng(SEED)
random.seed(SEED)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "sample-data"
MESSY = ROOT / "data" / "messy"
OUT.mkdir(parents=True, exist_ok=True)
MESSY.mkdir(parents=True, exist_ok=True)

START = date(2024, 1, 1)
AS_OF = date(2026, 9, 30)  # data snapshot date: payments after this are unknown

# Scale factors chosen so quarterly net sales land around PKR 0.5-0.9 billion
QTY_SCALE = 0.22
FREQ_SCALE = 1.5

REGIONS = {
    "Central": ["Lahore", "Faisalabad", "Gujranwala", "Sialkot"],
    "North": ["Islamabad", "Rawalpindi", "Peshawar", "Abbottabad"],
    "South": ["Karachi", "Hyderabad", "Sukkur"],
    "West": ["Multan", "Quetta", "Bahawalpur", "Dera Ghazi Khan"],
}
REGION_WEIGHT = {"Central": 1.35, "North": 1.0, "South": 1.1, "West": 0.65}

# customer_type -> (channel, count, payment_terms_days, qty range sqm, orders/month, base discount range)
CUSTOMER_TYPES = {
    "Distributor": ("Distribution", 20, 60, (1500, 5000), 2.2, (0.08, 0.12)),
    "Dealer": ("Retail", 70, 30, (150, 700), 1.6, (0.03, 0.06)),
    "Key Account": ("Projects", 18, 45, (800, 4000), 0.55, (0.10, 0.15)),
    "Institutional": ("Projects", 12, 90, (2000, 9000), 0.22, (0.12, 0.18)),
}

NAME_A = ["Al-Noor", "Shaheen", "Madina", "Crescent", "Indus Valley", "Margalla", "Ravi",
          "Chenab", "Sutlej", "Khyber", "Mehran", "Bolan", "Saba", "Zamzam", "Pak Star",
          "Faisal", "Hamza", "Rehman", "Iqra", "Gulshan", "Tariq", "Ittehad", "Nishat",
          "Bismillah", "Kohinoor", "Sadiq", "Usman", "Haider", "Javed", "Qasim", "Rafiq",
          "Kashmir", "Sunrise", "Evergreen", "Royal", "Metro", "Galaxy", "Unique", "Prime", "Classic"]
NAME_B = {
    "Distributor": ["Distributors", "Trading Co.", "Sales Corporation", "Enterprises"],
    "Dealer": ["Tiles & Sanitary", "Tile House", "Ceramics Centre", "Building Materials", "Tile Gallery"],
    "Key Account": ["Builders", "Developers", "Constructions", "Homes"],
    "Institutional": ["Housing Project", "Hospital Project", "University Campus", "Commercial Tower"],
}

PRODUCTS = [
    # id, name, category, size, list price PKR/sqm, est cost ratio
    ("P001", "Ceramic Floor 30x30 Matt Grey", "Ceramic Floor", "30x30", 1750, 0.66),
    ("P002", "Ceramic Floor 40x40 Rustic Brown", "Ceramic Floor", "40x40", 1950, 0.65),
    ("P003", "Ceramic Floor 40x40 Glossy White", "Ceramic Floor", "40x40", 2050, 0.64),
    ("P004", "Ceramic Floor 45x45 Wood Look", "Ceramic Floor", "45x45", 2250, 0.63),
    ("P005", "Wall Tile 25x40 Glossy White", "Wall Tiles", "25x40", 1650, 0.62),
    ("P006", "Wall Tile 25x40 Kitchen Decor", "Wall Tiles", "25x40", 1900, 0.60),
    ("P007", "Wall Tile 30x60 Satin Ivory", "Wall Tiles", "30x60", 2300, 0.61),
    ("P008", "Wall Tile 30x60 Bathroom Marble", "Wall Tiles", "30x60", 2500, 0.60),
    ("P009", "Porcelain 60x60 Polished Beige", "Porcelain Floor", "60x60", 3600, 0.64),
    ("P010", "Porcelain 60x60 Matt Charcoal", "Porcelain Floor", "60x60", 3450, 0.63),
    ("P011", "Porcelain 60x60 Double Charge Grey", "Porcelain Floor", "60x60", 3900, 0.62),
    ("P012", "Porcelain 80x80 Polished Ivory", "Porcelain Floor", "80x80", 4600, 0.61),
    ("P013", "GVT 60x120 Marble Glossy", "Glazed Vitrified (GVT)", "60x120", 6400, 0.58),
    ("P014", "GVT 60x120 Statuario", "Glazed Vitrified (GVT)", "60x120", 6900, 0.57),
    ("P015", "GVT 60x60 Onyx Blue", "Glazed Vitrified (GVT)", "60x60", 5200, 0.59),
    ("P016", "GVT 80x160 Calacatta Slab", "Glazed Vitrified (GVT)", "80x160", 8600, 0.56),
    ("P017", "Outdoor Parking 40x40 Anti-Skid", "Outdoor & Parking", "40x40", 1450, 0.70),
    ("P018", "Outdoor Paver 30x60 Stone Grey", "Outdoor & Parking", "30x60", 1700, 0.68),
    ("P019", "Outdoor Pool Edge 30x30 Blue", "Outdoor & Parking", "30x30", 2100, 0.66),
    ("P020", "Ceramic Floor 30x30 Anti-Slip Beige", "Ceramic Floor", "30x30", 1800, 0.66),
]
PRODUCT_DF = pd.DataFrame(PRODUCTS, columns=["product_id", "product_name", "product_category", "size", "list_price", "cost_ratio"])

# product preference by channel (relative weights by category)
CATEGORY_PREF = {
    "Distribution": {"Ceramic Floor": 3.0, "Wall Tiles": 2.5, "Porcelain Floor": 2.2, "Glazed Vitrified (GVT)": 1.0, "Outdoor & Parking": 1.0},
    "Retail": {"Ceramic Floor": 2.5, "Wall Tiles": 3.0, "Porcelain Floor": 2.0, "Glazed Vitrified (GVT)": 1.2, "Outdoor & Parking": 0.6},
    "Projects": {"Ceramic Floor": 1.0, "Wall Tiles": 1.5, "Porcelain Floor": 2.6, "Glazed Vitrified (GVT)": 2.4, "Outdoor & Parking": 1.8},
}


def month_starts(start: date, end: date):
    d = date(start.year, start.month, 1)
    while d <= end:
        yield d
        d = date(d.year + (d.month // 12), d.month % 12 + 1, 1)


def days_in_month(d: date) -> int:
    nxt = date(d.year + (d.month // 12), d.month % 12 + 1, 1)
    return (nxt - d).days


def seasonality(d: date) -> float:
    """Construction-market seasonality (illustrative, not measured)."""
    base = {1: 0.92, 2: 0.95, 3: 1.02, 4: 1.08, 5: 1.10, 6: 1.04, 7: 0.90, 8: 0.88, 9: 0.98, 10: 1.05, 11: 1.06, 12: 1.00}[d.month]
    # Ramadan months (approximate): Mar-2024, Mar-2025, Feb/Mar-2026
    if (d.year, d.month) in {(2024, 3), (2025, 3), (2026, 2), (2026, 3)}:
        base *= 0.85
    return base


def growth(d: date) -> float:
    months = (d.year - START.year) * 12 + (d.month - START.month)
    return 1.0 + 0.005 * months  # ~6% volume growth per year, illustrative


def is_push_quarter(d: date) -> bool:
    return d.year == 2026 and d.month in (7, 8, 9)


# ---------------------------------------------------------------- customers
customers = []
used_names = set()
cid = 1
for ctype, (channel, count, terms, *_rest) in CUSTOMER_TYPES.items():
    for _ in range(count):
        region = rng.choice(list(REGIONS), p=np.array(list(REGION_WEIGHT.values())) / sum(REGION_WEIGHT.values()))
        city = rng.choice(REGIONS[region])
        while True:
            name = f"{rng.choice(NAME_A)} {rng.choice(NAME_B[ctype])}"
            if ctype in ("Dealer", "Key Account"):
                name = f"{name} {city}" if rng.random() < 0.3 else name
            if name not in used_names:
                used_names.add(name)
                break
        onboard = START - timedelta(days=int(rng.integers(30, 2500)))
        if rng.random() < 0.15:  # some customers joined during the period
            onboard = START + timedelta(days=int(rng.integers(30, 800)))
        credit_limit = {"Distributor": (25, 60), "Dealer": (2, 8), "Key Account": (15, 45), "Institutional": (30, 90)}[ctype]
        customers.append({
            "customer_id": f"C{cid:04d}",
            "customer_name": name,
            "customer_type": ctype,
            "channel": channel,
            "region": region,
            "city": city,
            "payment_terms_days": terms,
            "credit_limit_pkr": int(rng.integers(*credit_limit)) * 1_000_000,
            "onboarding_date": onboard.isoformat(),
            "account_status": "Active",
        })
        cid += 1
cust = pd.DataFrame(customers)

# Make sure the storyline's South-region distributors exist (at least 4)
south_dist = cust[(cust.customer_type == "Distributor") & (cust.region == "South")]
need = 4 - len(south_dist)
if need > 0:
    idx = cust[(cust.customer_type == "Distributor") & (cust.region != "South")].index[:need]
    cust.loc[idx, "region"] = "South"
    cust.loc[idx, "city"] = [rng.choice(REGIONS["South"]) for _ in idx]

# Payment behaviour per customer: mean days paid after due date, partial-pay probability
behaviour = {}
for _, c in cust.iterrows():
    mean_late = {"Distributor": 12, "Dealer": 6, "Key Account": 18, "Institutional": 35}[c.customer_type]
    mean_late += rng.normal(0, 6)
    behaviour[c.customer_id] = {"late": mean_late, "partial": 0.008 + max(0, rng.normal(0.004, 0.004))}  # rare disputes

# Two chronic slow payers with old disputed balances (storyline 4)
chronic = list(cust[cust.customer_type.isin(["Distributor", "Key Account"])].sample(2, random_state=SEED).customer_id)
for c in chronic:
    behaviour[c]["late"] += 40
    behaviour[c]["partial"] = 0.30

# Status: some inactive / on hold
inactive = cust[cust.customer_type == "Dealer"].sample(6, random_state=7).customer_id
cust.loc[cust.customer_id.isin(inactive), "account_status"] = "Inactive"
cust.loc[cust.customer_id.isin(chronic), "account_status"] = "On Hold"
inactive_from = {c: date(2025, int(rng.integers(3, 12)), 1) for c in inactive}

# --------------------------------------------------------------- orders
orders = []
oid = 1
cust_weight = {c: max(0.25, rng.lognormal(0, 0.45)) for c in cust.customer_id}
for m in month_starts(START, AS_OF):
    dim = days_in_month(m)
    for _, c in cust.iterrows():
        onboard = date.fromisoformat(c.onboarding_date)
        if onboard > m:
            continue
        if c.customer_id in inactive_from and m >= inactive_from[c.customer_id]:
            continue
        ctype = c.customer_type
        channel, _n, _t, qty_rng, freq, disc_rng = CUSTOMER_TYPES[ctype]
        lam = FREQ_SCALE * freq * seasonality(m) * growth(m) * REGION_WEIGHT[c.region] * cust_weight[c.customer_id] / 1.1
        push = is_push_quarter(m) and channel == "Distribution" and c.region in ("South", "Central")
        if push:
            lam *= 1.45
        n_orders = rng.poisson(max(lam, 0.01))
        for _ in range(n_orders):
            # product choice
            pref = CATEGORY_PREF[channel]
            w = PRODUCT_DF.product_category.map(pref).to_numpy()
            # GVT gaining share over time
            w = w * np.where(PRODUCT_DF.product_category == "Glazed Vitrified (GVT)", 1 + 0.02 * ((m.year - 2024) * 12 + m.month), 1)
            # P009 losing volume in 2026 (competition) despite discounts
            if m.year == 2026:
                w = w * np.where(PRODUCT_DF.product_id == "P009", 0.6, 1)
            p = PRODUCT_DF.iloc[rng.choice(len(PRODUCT_DF), p=w / w.sum())]
            day = int(rng.integers(1, dim + 1))
            if push and rng.random() < 0.5:
                day = int(rng.integers(max(1, dim - 8), dim + 1))  # quarter-end loading
            odate = date(m.year, m.month, day)
            if odate > AS_OF:
                continue
            qty = max(20, int(rng.integers(*qty_rng) * QTY_SCALE) // 10 * 10)
            if push:
                qty = int(qty * 1.15)
            price = p.list_price * (1 + 0.06 * (m.year - 2024)) * (1 + rng.normal(0, 0.01))  # annual price increases
            disc = rng.uniform(*disc_rng)
            if p.product_id == "P009" and odate >= date(2026, 4, 1):
                disc += 0.07  # competitive discounting
            if push:
                disc += 0.02  # push incentives
            cost_ratio = p.cost_ratio * (1.08 if odate >= date(2026, 1, 1) else 1.0)
            unit_cost = p.list_price * (1 + 0.06 * (m.year - 2024)) * cost_ratio
            net = qty * price * (1 - disc)
            status = "Cancelled" if rng.random() < 0.015 else "Delivered"
            orders.append({
                "order_id": f"SO{oid:06d}",
                "order_date": odate.isoformat(),
                "customer_id": c.customer_id,
                "region": c.region,
                "channel": channel,
                "product_id": p.product_id,
                "product_name": p.product_name,
                "product_category": p.product_category,
                "quantity_sqm": qty,
                "list_price_per_sqm": round(price, 2),
                "discount_pct": round(disc * 100, 2),
                "net_sales_pkr": round(net, 0),
                "est_unit_cost_per_sqm": round(unit_cost, 2),
                "est_cogs_pkr": round(qty * unit_cost, 0),
                "order_status": status,
            })
            oid += 1

orders_df = pd.DataFrame(orders).sort_values(["order_date", "order_id"]).reset_index(drop=True)
# re-number sequentially by date for realism
orders_df["order_id"] = [f"SO{i + 1:06d}" for i in range(len(orders_df))]

# --------------------------------------------------------------- invoices
cust_idx = cust.set_index("customer_id")
invoices = []
for i, o in orders_df[orders_df.order_status == "Delivered"].iterrows():
    c = cust_idx.loc[o.customer_id]
    inv_date = date.fromisoformat(o.order_date) + timedelta(days=int(rng.integers(0, 4)))
    if inv_date > AS_OF:
        inv_date = AS_OF
    due = inv_date + timedelta(days=int(c.payment_terms_days))
    b = behaviour[o.customer_id]
    late = rng.normal(b["late"], 10)
    # storyline 1: South distributors slow down on invoices raised from June 2026
    if c.region == "South" and c.customer_type == "Distributor" and inv_date >= date(2026, 6, 1):
        late += 45
    pay_date = due + timedelta(days=int(round(late)))
    if pay_date < inv_date:
        pay_date = inv_date + timedelta(days=int(rng.integers(0, 5)))
    amount = float(o.net_sales_pkr)
    partial = rng.random() < b["partial"]
    paid_fraction = float(rng.uniform(0.4, 0.9)) if partial else 1.0
    if pay_date > AS_OF:
        paid, pdate = 0.0, ""
    else:
        paid, pdate = round(amount * paid_fraction, 0), pay_date.isoformat()
    if paid >= amount:
        status = "Paid"
    elif paid > 0:
        status = "Partially Paid"
    else:
        status = "Open"
    invoices.append({
        "invoice_id": f"INV{len(invoices) + 1:06d}",
        "order_id": o.order_id,
        "customer_id": o.customer_id,
        "invoice_date": inv_date.isoformat(),
        "due_date": due.isoformat(),
        "invoice_amount_pkr": round(amount, 0),
        "amount_paid_pkr": paid,
        "payment_date": pdate,
        "status": status,
    })
inv_df = pd.DataFrame(invoices)

# --------------------------------------------------------------- targets
# Targets are set from the *planned* run-rate (without the Q3-2026 push), +4%.
ord_ok = orders_df[orders_df.order_status == "Delivered"].copy()
ord_ok["month"] = ord_ok.order_date.str[:7]
monthly_region = ord_ok.groupby(["month", "region"]).net_sales_pkr.sum()
targets = []
months = [m.strftime("%Y-%m") for m in month_starts(START, AS_OF)]
for mi, mstr in enumerate(months):
    m = date.fromisoformat(mstr + "-01")
    for region in REGIONS:
        actual = monthly_region.get((mstr, region), 0.0)
        planned = actual
        if is_push_quarter(m) and region in ("South", "Central"):
            planned = actual / 1.33  # remove most of the push effect
        sales_target = math.ceil(planned * rng.uniform(0.98, 1.08) / 100_000) * 100_000
        prev = [monthly_region.get((months[k], region), 0.0) for k in (mi - 1, mi - 2) if k >= 0]
        coll_base = (sum(prev) / len(prev)) if prev else planned * 0.6
        coll_target = math.ceil(coll_base * 0.97 / 100_000) * 100_000
        targets.append({"month": mstr, "region": region, "sales_target_pkr": sales_target, "collection_target_pkr": coll_target})
tgt_df = pd.DataFrame(targets)

# --------------------------------------------------------------- complaints
CATS = {
    "Shade Variation": ("Quality", 0.22),
    "Surface Defect": ("Quality", 0.12),
    "Size / Calibration": ("Production", 0.10),
    "Breakage in Transit": ("Logistics", 0.22),
    "Delivery Delay": ("Logistics", 0.16),
    "Short Supply": ("Logistics", 0.08),
    "Billing Discrepancy": ("Commercial", 0.10),
}
cat_names = list(CATS)
cat_p = np.array([v[1] for v in CATS.values()])
cat_p = cat_p / cat_p.sum()
complaints = []
for _, o in ord_ok.iterrows():
    odate = date.fromisoformat(o.order_date)
    prob = 0.028
    spike = o.product_id == "P013" and date(2026, 8, 1) <= odate <= date(2026, 9, 30)
    if spike:
        prob = 0.30
    if rng.random() >= prob:
        continue
    cat = "Shade Variation" if spike and rng.random() < 0.8 else rng.choice(cat_names, p=cat_p)
    opened = odate + timedelta(days=int(rng.integers(2, 25)))
    if opened > AS_OF:
        continue
    severity = rng.choice(["Low", "Medium", "High"], p=[0.45, 0.4, 0.15])
    if spike:
        severity = rng.choice(["Medium", "High"], p=[0.4, 0.6])
    res_days = int(rng.gamma(2.0, {"Low": 4, "Medium": 7, "High": 11}[severity]))
    resolved = opened + timedelta(days=res_days)
    if resolved > AS_OF:
        status = "Open" if rng.random() < 0.6 else "In Progress"
        rdate = ""
    else:
        status, rdate = "Resolved", resolved.isoformat()
    claim = round(float(o.net_sales_pkr) * rng.uniform(0.01, 0.12), 0) if cat != "Delivery Delay" else 0.0
    complaints.append({
        "complaint_id": "",
        "date_opened": opened.isoformat(),
        "customer_id": o.customer_id,
        "order_id": o.order_id,
        "product_id": o.product_id,
        "category": cat,
        "severity": severity,
        "assigned_team": CATS[cat][0],
        "status": status,
        "date_resolved": rdate,
        "claim_value_pkr": claim,
    })
cmp_df = pd.DataFrame(complaints).sort_values("date_opened").reset_index(drop=True)
cmp_df["complaint_id"] = [f"CMP{i + 1:05d}" for i in range(len(cmp_df))]

# --------------------------------------------------------------- write
cust.to_csv(OUT / "customers.csv", index=False)
orders_df.to_csv(OUT / "orders.csv", index=False)
inv_df.to_csv(OUT / "invoices.csv", index=False)
tgt_df.to_csv(OUT / "targets.csv", index=False)
cmp_df.to_csv(OUT / "complaints.csv", index=False)

# --------------------------------------------------------------- messy files (validation demos)
messy = orders_df.head(40).copy()
messy.loc[3, "order_date"] = "2025-13-45"            # invalid date
messy.loc[5, "quantity_sqm"] = -120                   # negative value
messy.loc[7, "net_sales_pkr"] = None                  # missing required value
messy.loc[9, "customer_id"] = "C9999"                 # unknown customer (referential check)
messy = pd.concat([messy, messy.iloc[[11]]])          # duplicate id
messy.to_csv(MESSY / "orders_with_errors.csv", index=False)
cust.drop(columns=["region"]).head(20).to_csv(MESSY / "customers_missing_region.csv", index=False)
pd.DataFrame(columns=inv_df.columns).to_csv(MESSY / "invoices_empty.csv", index=False)

# --------------------------------------------------------------- summary
print(f"customers  {len(cust):>6}")
print(f"orders     {len(orders_df):>6}  (cancelled {int((orders_df.order_status == 'Cancelled').sum())})")
print(f"invoices   {len(inv_df):>6}")
print(f"targets    {len(tgt_df):>6}")
print(f"complaints {len(cmp_df):>6}")
print(f"net sales (delivered) PKR {ord_ok.net_sales_pkr.sum():,.0f}")
print("chronic slow payers:", chronic)
