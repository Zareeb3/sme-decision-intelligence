#!/usr/bin/env python3
"""
SAP -> Decision Intelligence data pipeline.

Reads table extracts exported from SAP ECC or S/4HANA (SE16N, SQVI, an ALV
report "Export > Spreadsheet" or "Local file > Text with tabs", or a scheduled
background job), converts them into the app's canonical datasets, validates
basic integrity, writes CSVs, and can push them to the app's ingest API.

    python pipeline/sap_pipeline.py --input ./sap_exports --config pipeline/config.json --out ./canonical
    python pipeline/sap_pipeline.py --input ./sap_exports --config pipeline/config.json --out ./canonical \
        --push https://insights.company.local --token "$INGEST_TOKEN"

Expected files in --input (CSV or tab-delimited, SAP technical field names as headers):

  Required  VBRK.csv   billing headers   VBELN FKART FKDAT KUNAG VTWEG FKSTO
            VBRP.csv   billing items     VBELN POSNR MATNR ARKTX MATKL FKIMG NETWR WAVWR KZWI1 [VKBUR]
            KNA1.csv   customer general  KUNNR NAME1 ORT01 REGIO ERDAT [LOEVM SPERR]
            KNVV.csv   customer sales    KUNNR VTWEG KDGRP BZIRK VKBUR ZTERM [AUFSD]
            BSID.csv   open AR items     KUNNR BELNR BLART BLDAT ZFBDT ZBD1T [ZBD2T ZBD3T] SHKZG DMBTR VBELN REBZG
            BSAD.csv   cleared AR items  same as BSID + AUGDT AUGBL
  Optional  KNKK.csv   credit limits     KUNNR KLIMK   (S/4: export UKMBP_CMS_SGM with PARTNER, CREDIT_LIMIT)
            QMEL.csv   QM notifications  QMNUM ERDAT KUNUM MATNR VBELN QMCOD PRIOK QMDAB
            targets.csv  sales/collection targets maintained by sales controlling (month, region, ...)

On S/4HANA, BSID/BSAD are compatibility views over ACDOCA and can still be
exported; alternatively export the equivalent CDS views with the same fields.

Only pandas is required (pip install pandas). Pushing uses the standard library.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd

DATASETS = ["customers", "orders", "invoices", "payments", "targets", "complaints"]


# ----------------------------------------------------------------------------- helpers
def read_table(folder: Path, name: str, required: bool = True) -> pd.DataFrame | None:
    for ext in (".csv", ".txt", ".tsv"):
        for cand in (folder / f"{name}{ext}", folder / f"{name.lower()}{ext}"):
            if cand.exists():
                df = pd.read_csv(cand, sep=None, engine="python", dtype=str, keep_default_na=False, encoding="utf-8-sig")
                df.columns = [c.strip().upper() for c in df.columns]
                return df.apply(lambda col: col.str.strip())
    if required:
        raise SystemExit(f"Missing required extract {name}.csv in {folder}")
    return None


def need(df: pd.DataFrame, table: str, cols: list[str]) -> None:
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise SystemExit(f"{table}: missing column(s) {', '.join(missing)}. Present: {', '.join(df.columns)}")


def num(s: str) -> float:
    """SAP and Excel number formats: 1,234.56 / 1.234,56 / trailing minus 1,234.56- ."""
    v = (s or "").strip()
    if not v:
        return 0.0
    neg = v.endswith("-") or v.startswith("-")
    v = v.strip("-").replace(" ", "")
    if "," in v and "." in v:
        v = v.replace(".", "").replace(",", ".") if v.rfind(",") > v.rfind(".") else v.replace(",", "")
    elif "," in v:
        v = v.replace(",", "") if re.fullmatch(r"\d{1,3}(,\d{3})+", v) else v.replace(",", ".")
    try:
        x = float(v)
    except ValueError:
        return 0.0
    return -x if neg else x


def to_date(s: str, fmt: str = "auto") -> str:
    v = (s or "").strip()
    if not v or v in ("00000000", "00.00.0000"):
        return ""
    if re.fullmatch(r"\d{8}", v):
        return f"{v[:4]}-{v[4:6]}-{v[6:8]}"
    if re.match(r"\d{4}-\d{2}-\d{2}", v):
        return v[:10]
    m = re.fullmatch(r"(\d{1,2})[./-](\d{1,2})[./-](\d{4})", v)
    if m:
        a, b, y = m.groups()
        d, mo = (b, a) if fmt == "MDY" else (a, b)
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    return v


def add_days(iso: str, days: int) -> str:
    return (date.fromisoformat(iso) + timedelta(days=int(days))).isoformat()


def terms_days(zterm: str, table: dict) -> int:
    if zterm in table:
        return int(table[zterm])
    digits = re.findall(r"\d+", zterm or "")
    return int(digits[-1]) if digits else int(table.get("_default", 30))


class Report:
    def __init__(self) -> None:
        self.counts: dict[str, int] = {}
        self.warnings: list[str] = []

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)
        print(f"  ! {msg}")


# ----------------------------------------------------------------------------- transforms
def build_customers(cfg: dict, kna1: pd.DataFrame, knvv: pd.DataFrame, knkk: pd.DataFrame | None, rep: Report) -> pd.DataFrame:
    need(kna1, "KNA1", ["KUNNR", "NAME1"])
    need(knvv, "KNVV", ["KUNNR", "VTWEG", "KDGRP"])
    region_src = cfg.get("region_source", "BZIRK")
    sales = knvv.drop_duplicates("KUNNR", keep="first").set_index("KUNNR")
    limits = {}
    if knkk is not None:
        kcol = "KUNNR" if "KUNNR" in knkk.columns else "PARTNER"
        lcol = "KLIMK" if "KLIMK" in knkk.columns else "CREDIT_LIMIT"
        limits = {r[kcol]: num(r[lcol]) for _, r in knkk.iterrows()}
    groups, channels, regions = cfg.get("customer_groups", {}), cfg.get("distribution_channels", {}), cfg.get("regions", {})
    rows = []
    for _, c in kna1.iterrows():
        k = c["KUNNR"]
        s = sales.loc[k] if k in sales.index else None
        if s is None:
            rep.warn(f"Customer {k} has no sales-area record in KNVV; typed as 'Customer'.")
        reg_code = (s.get(region_src, "") if s is not None and region_src in sales.columns else c.get(region_src, "")) or c.get("REGIO", "")
        blocked = bool((s is not None and s.get("AUFSD", "")) or c.get("SPERR", ""))
        deleted = c.get("LOEVM", "") == "X"
        rows.append({
            "customer_id": k,
            "customer_name": c["NAME1"],
            "customer_type": groups.get(s["KDGRP"], s["KDGRP"] or "Customer") if s is not None else "Customer",
            "channel": channels.get(s["VTWEG"], s["VTWEG"]) if s is not None else "Unassigned",
            "region": regions.get(reg_code, reg_code or "Unassigned"),
            "city": c.get("ORT01", ""),
            "payment_terms_days": terms_days(s.get("ZTERM", "") if s is not None else "", cfg.get("payment_terms", {})),
            "credit_limit_pkr": limits.get(k, 0.0),
            "onboarding_date": to_date(c.get("ERDAT", "")),
            "account_status": "Inactive" if deleted else "On Hold" if blocked else "Active",
        })
    return pd.DataFrame(rows)


def build_orders(cfg: dict, vbrk: pd.DataFrame, vbrp: pd.DataFrame, customers: pd.DataFrame, rep: Report) -> pd.DataFrame:
    need(vbrk, "VBRK", ["VBELN", "FKART", "FKDAT", "KUNAG"])
    need(vbrp, "VBRP", ["VBELN", "POSNR", "MATNR", "FKIMG", "NETWR"])
    head = vbrk.set_index("VBELN")
    inv_types = set(cfg.get("invoice_billing_types", ["F2"]))
    credit_types = set(cfg.get("credit_billing_types", ["G2", "RE"]))
    cancel_types = set(cfg.get("cancel_billing_types", ["S1", "S2"]))
    channels, cats = cfg.get("distribution_channels", {}), cfg.get("material_groups", {})
    cust = customers.set_index("customer_id")
    rows, skipped = [], 0
    for _, p in vbrp.iterrows():
        if p["VBELN"] not in head.index:
            skipped += 1
            continue
        h = head.loc[p["VBELN"]]
        fkart = h["FKART"]
        if fkart not in inv_types | credit_types | cancel_types:
            skipped += 1
            continue
        status = "Cancelled" if (fkart in cancel_types or h.get("FKSTO", "") == "X") else "Credit Note" if fkart in credit_types else "Delivered"
        qty, net = abs(num(p["FKIMG"])), abs(num(p["NETWR"]))
        cost = abs(num(p.get("WAVWR", "")))
        gross = abs(num(p.get("KZWI1", ""))) or net
        kunag = h["KUNAG"]
        c = cust.loc[kunag] if kunag in cust.index else None
        rows.append({
            "order_id": f"{p['VBELN']}-{p['POSNR']}",
            "order_date": to_date(h["FKDAT"], cfg.get("date_format", "auto")),
            "customer_id": kunag,
            "region": c["region"] if c is not None else "Unassigned",
            "channel": channels.get(h.get("VTWEG", ""), c["channel"] if c is not None else "Unassigned"),
            "product_id": p["MATNR"],
            "product_name": p.get("ARKTX", "") or p["MATNR"],
            "product_category": cats.get(p.get("MATKL", ""), p.get("MATKL", "") or "Uncategorised"),
            "quantity_sqm": round(qty, 3),
            "list_price_per_sqm": round(gross / qty, 2) if qty else 0,
            "discount_pct": round((1 - net / gross) * 100, 2) if gross else 0,
            "net_sales_pkr": round(net, 2),
            "est_unit_cost_per_sqm": round(cost / qty, 2) if qty else 0,
            "est_cogs_pkr": round(cost, 2),
            "order_status": status,
        })
    if skipped:
        rep.warn(f"{skipped} billing item(s) skipped (billing type not configured or header missing).")
    return pd.DataFrame(rows)


def build_receivables(cfg: dict, bsid: pd.DataFrame, bsad: pd.DataFrame, rep: Report) -> tuple[pd.DataFrame, pd.DataFrame]:
    for name, t in (("BSID", bsid), ("BSAD", bsad)):
        need(t, name, ["KUNNR", "BELNR", "BLART", "BLDAT", "SHKZG", "DMBTR"])
    items = pd.concat([bsid.assign(_CLEARED=False), bsad.assign(_CLEARED=True)], ignore_index=True)
    inv_types = set(cfg.get("fi_invoice_doc_types", ["RV"]))
    pay_types = set(cfg.get("fi_payment_doc_types", ["DZ"]))
    credit_types = set(cfg.get("fi_credit_doc_types", ["DG"]))
    fmt = cfg.get("date_format", "auto")

    invoices, belnr_to_invoice = [], {}
    for _, r in items[items["BLART"].isin(inv_types) & (items["SHKZG"] == "S")].iterrows():
        inv_id = r.get("VBELN", "") or r["BELNR"]
        doc_date = to_date(r["BLDAT"], fmt)
        base = to_date(r.get("ZFBDT", ""), fmt) or doc_date
        net_days = next((int(num(r.get(f))) for f in ("ZBD3T", "ZBD2T", "ZBD1T") if num(r.get(f, "")) > 0), 0)
        invoices.append({
            "invoice_id": inv_id,
            "order_id": "",
            "customer_id": r["KUNNR"],
            "invoice_date": doc_date,
            "due_date": add_days(base, net_days) if base else "",
            "invoice_amount_pkr": round(num(r["DMBTR"]), 2),
            "_cleared": r["_CLEARED"],
            "_augdt": to_date(r.get("AUGDT", ""), fmt),
        })
        belnr_to_invoice[r["BELNR"]] = inv_id
    inv_df = pd.DataFrame(invoices).drop_duplicates("invoice_id")

    # partial payments and credit memos referencing an invoice (REBZG = invoice document number)
    payments = []
    refs = items[items["BLART"].isin(pay_types | credit_types) & (items["SHKZG"] == "H")]
    unlinked = 0
    for _, r in refs.iterrows():
        inv_id = belnr_to_invoice.get(r.get("REBZG", ""))
        if not inv_id:
            # cleared payments without REBZG are clearing documents: the invoice's AUGDT accounts for them
            if not r["_CLEARED"]:
                unlinked += 1
            continue
        payments.append({
            "payment_id": f"{r['BELNR']}-{r.get('BUZEI', '') or len(payments) + 1}",
            "invoice_id": inv_id,
            "payment_date": to_date(r.get("BUDAT", "") or r["BLDAT"], fmt),
            "amount_pkr": round(num(r["DMBTR"]), 2),
            "payment_type": "Credit Note" if r["BLART"] in credit_types else "Payment",
        })
    if unlinked:
        rep.warn(f"{unlinked} payment/credit item(s) without an invoice reference (REBZG) were not applied; check on-account postings.")

    # an invoice cleared in BSAD is settled on AUGDT for whatever was not already applied
    applied = {}
    for p in payments:
        applied[p["invoice_id"]] = applied.get(p["invoice_id"], 0.0) + p["amount_pkr"]
    for _, inv in inv_df[inv_df["_cleared"]].iterrows():
        rest = round(inv["invoice_amount_pkr"] - applied.get(inv["invoice_id"], 0.0), 2)
        if rest > 0.005 and inv["_augdt"]:
            payments.append({"payment_id": f"CLR-{inv['invoice_id']}", "invoice_id": inv["invoice_id"], "payment_date": inv["_augdt"], "amount_pkr": rest, "payment_type": "Payment"})

    inv_df = inv_df.drop(columns=["_cleared", "_augdt"])
    inv_df["amount_paid_pkr"] = 0
    inv_df["payment_date"] = ""
    inv_df["status"] = ""
    return inv_df, pd.DataFrame(payments, columns=["payment_id", "invoice_id", "payment_date", "amount_pkr", "payment_type"])


def build_complaints(cfg: dict, qmel: pd.DataFrame, rep: Report) -> pd.DataFrame:
    need(qmel, "QMEL", ["QMNUM", "ERDAT", "KUNUM"])
    codes, teams, prio = cfg.get("complaint_codes", {}), cfg.get("complaint_teams", {}), cfg.get("priority_severity", {"1": "High", "2": "High", "3": "Medium", "4": "Low"})
    fmt = cfg.get("date_format", "auto")
    rows = []
    for _, q in qmel.iterrows():
        cat = codes.get(q.get("QMCOD", ""), q.get("QMCOD", "") or "Other")
        resolved = to_date(q.get("QMDAB", ""), fmt)
        rows.append({
            "complaint_id": q["QMNUM"],
            "date_opened": to_date(q["ERDAT"], fmt),
            "customer_id": q["KUNUM"],
            "order_id": q.get("VBELN", ""),
            "product_id": q.get("MATNR", ""),
            "category": cat,
            "severity": prio.get(q.get("PRIOK", ""), "Medium"),
            "assigned_team": teams.get(cat, "Unassigned"),
            "status": "Resolved" if resolved else "Open",
            "date_resolved": resolved,
            "claim_value_pkr": round(num(q.get(cfg.get("claim_field", "ZZCLAIM"), "")), 2),
        })
    return pd.DataFrame(rows)


# ----------------------------------------------------------------------------- integrity checks
def check(out: dict[str, pd.DataFrame], rep: Report) -> bool:
    ok = True
    cust_ids = set(out["customers"]["customer_id"])
    for name, df in out.items():
        rep.counts[name] = len(df)
    for k in ("customers", "orders", "invoices"):
        if out[k].empty:
            rep.warn(f"{k} is empty.")
            ok = False
    orphan = (~out["orders"]["customer_id"].isin(cust_ids)).sum()
    if orphan:
        rep.warn(f"{orphan} sales line(s) reference customers missing from KNA1.")
    dupes = out["orders"]["order_id"].duplicated().sum()
    if dupes:
        rep.warn(f"{dupes} duplicate billing line(s).")
        ok = False
    bad_dates = (out["orders"]["order_date"] == "").sum()
    if bad_dates:
        rep.warn(f"{bad_dates} sales line(s) without a billing date.")
    return ok


def push(base_url: str, token: str, folder: Path, rep: Report) -> bool:
    ok = True
    for kind in DATASETS:
        f = folder / f"{kind}.csv"
        if not f.exists():
            continue
        req = urllib.request.Request(
            f"{base_url.rstrip('/')}/api/ingest/{kind}?mode=replace",
            data=f.read_bytes(),
            method="POST",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "text/csv; charset=utf-8", "X-Pipeline-Name": "sap_pipeline.py"},
        )
        try:
            with urllib.request.urlopen(req, timeout=300) as res:
                body = json.loads(res.read() or b"{}")
                print(f"  pushed {kind}: {body.get('rowsStored')} rows stored")
        except urllib.error.HTTPError as e:
            ok = False
            detail = e.read().decode("utf-8", "replace")[:500]
            rep.warn(f"push {kind} failed: HTTP {e.code} {detail}")
        except urllib.error.URLError as e:
            ok = False
            rep.warn(f"push {kind} failed: {e.reason}")
    return ok


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Convert SAP extracts into Decision Intelligence datasets.")
    ap.add_argument("--input", required=True, type=Path, help="folder with SAP extracts (VBRK.csv, VBRP.csv, ...)")
    ap.add_argument("--config", required=True, type=Path, help="mapping config JSON (see pipeline/config.example.json)")
    ap.add_argument("--out", required=True, type=Path, help="folder to write canonical CSVs")
    ap.add_argument("--push", help="app base URL; pushes the result to /api/ingest")
    ap.add_argument("--token", help="ingest token (or set INGEST_TOKEN)")
    args = ap.parse_args(argv)

    import os

    cfg = json.loads(args.config.read_text(encoding="utf-8"))
    rep = Report()
    started = datetime.now()
    print(f"Reading SAP extracts from {args.input}")
    t = {n: read_table(args.input, n, required=n in ("VBRK", "VBRP", "KNA1", "KNVV", "BSID", "BSAD")) for n in ("VBRK", "VBRP", "KNA1", "KNVV", "KNKK", "BSID", "BSAD", "QMEL")}

    out: dict[str, pd.DataFrame] = {}
    out["customers"] = build_customers(cfg, t["KNA1"], t["KNVV"], t["KNKK"], rep)
    out["orders"] = build_orders(cfg, t["VBRK"], t["VBRP"], out["customers"], rep)
    out["invoices"], out["payments"] = build_receivables(cfg, t["BSID"], t["BSAD"], rep)
    if t["QMEL"] is not None:
        out["complaints"] = build_complaints(cfg, t["QMEL"], rep)
    targets_file = args.input / "targets.csv"
    if targets_file.exists():
        out["targets"] = pd.read_csv(targets_file, dtype=str, keep_default_na=False)

    ok = check(out, rep)
    args.out.mkdir(parents=True, exist_ok=True)
    for name, df in out.items():
        df.to_csv(args.out / f"{name}.csv", index=False)
        print(f"  wrote {name}.csv ({len(df)} rows)")

    if args.push:
        token = args.token or os.environ.get("INGEST_TOKEN", "")
        if not token:
            rep.warn("No ingest token: use --token or set INGEST_TOKEN.")
            ok = False
        elif ok:
            print(f"Pushing to {args.push}")
            ok = push(args.push, token, args.out, rep) and ok
        else:
            rep.warn("Integrity checks failed: nothing was pushed.")

    report = {"started": started.isoformat(timespec="seconds"), "finished": datetime.now().isoformat(timespec="seconds"), "ok": ok, "counts": rep.counts, "warnings": rep.warnings}
    (args.out / "pipeline_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("OK" if ok else "Completed with problems; see pipeline_report.json")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
