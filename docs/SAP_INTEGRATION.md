# Connecting SAP (ECC or S/4HANA)

This guide is for the company's SAP / IT team. It describes the data the app needs, how to extract it, and how to schedule a nightly load. No changes to SAP are required: the app only reads table extracts.

## 1. What data is needed

| App dataset | SAP source (SD / FI-AR / QM) | Key fields | Required |
|---|---|---|---|
| Sales lines | VBRK (billing header) + VBRP (billing item) | VBELN, POSNR, FKART, FKDAT, KUNAG, VTWEG, FKSTO, MATNR, ARKTX, MATKL, FKIMG, NETWR, WAVWR, KZWI1 | Yes |
| Customers | KNA1 + KNVV (+ KNKK or UKMBP_CMS_SGM for credit limits) | KUNNR, NAME1, ORT01, REGIO, ERDAT, KDGRP, BZIRK, VTWEG, ZTERM, KLIMK, SPERR/AUFSD | Yes |
| Invoices and payments | BSID (open items) + BSAD (cleared items) | KUNNR, BELNR, BLART, BLDAT, ZFBDT, ZBD1T–ZBD3T, SHKZG, DMBTR, VBELN, REBZG, AUGDT, AUGBL | Yes |
| Complaints | QMEL (QM notifications) | QMNUM, ERDAT, KUNUM, MATNR, VBELN, QMCOD, PRIOK, QMDAB | Optional |
| Targets | Not in standard SAP: a sheet maintained by sales controlling (or BW/BPC plan data) | month, region, sales_target, collection_target | Optional |

Scope suggestion: one company code and sales organisation, the last 24–36 months of billing documents, plus all open items.

**Why these tables.** Billing documents (not sales orders) are what finance reports as sales, carry the cost at billing (WAVWR) for margin, and include credit notes. FI open and cleared items give the as-of balance and the actual payment dates that collections and aging need. The partner and customer-group fields drive the region, channel and partner-type views.

**On S/4HANA**, BSID/BSAD remain available as compatibility views over ACDOCA and can be exported the same way. The equivalent CDS views (for example I_BillingDocumentItem, I_OperationalAcctgDocItem) work as well if exported with the same field names.

## 2. Ways to extract

| Option | Effort | Notes |
|---|---|---|
| **SE16N / SQVI download** | Lowest; a key user can do it today | Good for the pilot. "Export → Text with tabs" or spreadsheet. |
| **Scheduled background job** writing files to an application-server or shared folder | Low, needs Basis | A small report or a variant of an existing extract (e.g. via `SAP_CONVERT_TO_TEX_FORMAT` / `GUI_DOWNLOAD` equivalents on the server). Recommended for production. |
| **BW / data warehouse** | None if it already exists | Export the same fields from existing DSOs/views; usually the cleanest source. |
| **Integration tool** (SAP Data Services, Azure Data Factory, SSIS, n8n, Power Automate) | Medium | Post canonical CSV or JSON directly to the ingest API. |

**Licensing note.** Reading SAP data with exports a licensed user runs is normally covered; automated extraction through RFC/OData by a third-party system may raise "indirect access" questions under the company's SAP contract. Ask the SAP account manager or licensing team before automating, and prefer the company's own scheduled jobs.

## 3. Run the pipeline script

The script turns the SAP extracts into the app's six canonical datasets, checks them, and optionally pushes them to the app.

```bash
pip install -r pipeline/requirements.txt        # pandas only
cp pipeline/config.example.json pipeline/config.json
# edit config.json: map your codes (regions, customer groups, channels,
# material groups, payment terms, billing and FI document types, QM codes)

python pipeline/sap_pipeline.py --input /path/to/sap_exports \
  --config pipeline/config.json --out ./canonical

# then, after reviewing ./canonical and pipeline_report.json:
python pipeline/sap_pipeline.py --input /path/to/sap_exports \
  --config pipeline/config.json --out ./canonical \
  --push https://insights.yourcompany.local --token "$INGEST_TOKEN"
```

`pipeline/config.json` is git-ignored because it can contain company codes.

### How the script interprets SAP data

- **Billing types.** `invoice_billing_types` (default F2) become Delivered sales lines; `credit_billing_types` (G2, RE) become credit notes that reduce sales; `cancel_billing_types` (S1, S2) and documents with FKSTO = X are excluded as cancelled.
- **Invoices.** FI documents of `fi_invoice_doc_types` (RV) with debit indicator S. The due date is the baseline date (ZFBDT) plus the longest cash-discount/net period (ZBD3T, else ZBD2T, else ZBD1T).
- **Payments.** Documents of `fi_payment_doc_types` (DZ) and `fi_credit_doc_types` (DG) that reference an invoice through REBZG become payments or credit notes. When an invoice is cleared (AUGDT set) and some of its amount is not explained by referenced documents, the remainder is recorded as a payment on the clearing date. A payment without REBZG that clears several invoices is therefore reflected on each invoice it cleared, dated on the clearing date; unapplied cash still on account is ignored.
- **Region** comes from the field named in `region_source` (BZIRK sales district by default; REGIO or VKBUR also work) mapped through `regions`.
- **Complaints.** QMEL notifications with QMCOD mapped to a category and owning team; PRIOK to severity; QMDAB as resolution date.
- **Unmapped codes** are passed through unchanged, so nothing is silently dropped. The report lists them.

`pipeline_report.json` records row counts, totals, unmapped codes and integrity checks (sales lines without a customer, invoices without a sales document, payments for unknown invoices). Review it after the first run with finance.

### Validated in development

The script was run on synthetic SAP-format extracts generated by `scripts/make_sap_extracts.py` from the sample company. The resulting KPIs (net sales, collections, outstanding and overdue balances, aging buckets, top-5 share, regional attainment) matched the reference values exactly; this is an automated test (`tests/pipeline.test.ts`). It has **not** yet been run against a real SAP system: field usage varies between installations, so the first company run should be reconciled against a known report (for example the billing-document list VF05 and the customer line-item report FBL5N for the same period).

## 4. Schedule it

Windows Task Scheduler (on a machine that can see the export folder):

```
Program:   C:\Python312\python.exe
Arguments: pipeline\sap_pipeline.py --input \\fileserver\sap_exports --config pipeline\config.json --out C:\di\canonical --push https://insights.yourcompany.local --token %INGEST_TOKEN%
Trigger:   daily 06:00, after the SAP export job
```

Linux cron:

```
0 6 * * *  cd /opt/di && INGEST_TOKEN=... python3 pipeline/sap_pipeline.py --input /mnt/sap_exports --config pipeline/config.json --out /opt/di/canonical --push https://insights.yourcompany.local --token "$INGEST_TOKEN" >> /var/log/di_pipeline.log 2>&1
```

## 5. Alternative: drop folder (no script on the client side)

If the SAP job can write the canonical files itself, point it at the app's drop folder (`$DATA_DIR/incoming`, or a shared folder mounted there; see `docker-compose.yml`). Name files after the dataset (`invoices_2026-10-17.csv`; include `append`, `delta` or `incremental` in the name for incremental loads). Files are imported when the app is next opened or when someone presses **Check for new data**, then moved to `processed/`, or to `failed/` with a `.log` file explaining why.

## 6. Ingest API reference

```
POST /api/ingest/{dataset}?mode=replace|append
Authorization: Bearer <INGEST_TOKEN>            (or header x-ingest-token)
Content-Type: text/csv  |  application/json      (JSON: array of row objects)
x-pipeline-name: nightly-sap                     (optional, shown in the app)
```

`dataset` is one of `orders`, `customers`, `invoices`, `payments`, `targets`, `complaints`. `append` merges by key (rows with the same ID are replaced). Responses: `200` with row counts and notes; `401` wrong or missing token; `422` validation failed (the current data is unchanged, the body lists the errors); `503` storage or token not configured; `413` body over 100 MB; `429` more than 120 requests a minute.
