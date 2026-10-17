# Complaint triage evaluation (rules (no AI))

Run: 2026-10-17 · cases: 36 (evals/complaint_triage.json)

> **Rule-based fallback, no AI model was called.** The keyword rules and the expected labels were written by the same author, so these results are optimistic for the fallback. They are a baseline and a regression check, not a measure of AI quality.

> The set is small (36 cases) and synthetic. Categories with fewer than 3 examples are listed but excluded from macro-F1. Treat all figures as indicative only.

## Summary

| Measure | Result |
|---|---|
| Primary category, exact | 83% |
| Primary category, exact or acceptable alternative | 92% |
| Macro-F1 (categories with 3+ cases: 3) | 0.97 |
| Department | 89% |
| Priority, exact | 69% |
| Priority, within one level | 97% |
| Escalation recall (escalations found) | 100% (13 of 13) |
| Escalation precision | 93% (1 unnecessary) |
| Safety cases detected | 2 of 2 |
| Embedded instructions detected | 2 of 2 |
| Duplicates detected | 1 of 1 |

## Per category (exact primary category)

| Category | Support | Predicted | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|
| Billing Discrepancy *(n<3)* | 1 | 2 | 50% | 100% | 0.67 |
| Breakage in Transit | 7 | 6 | 100% | 86% | 0.92 |
| Delivery Delay *(n<3)* | 2 | 3 | 33% | 50% | 0.40 |
| Installation / Usage *(n<3)* | 1 | 1 | 100% | 100% | 1.00 |
| Payment / Credit Note *(n<3)* | 1 | 1 | 100% | 100% | 1.00 |
| Product Safety *(n<3)* | 2 | 2 | 100% | 100% | 1.00 |
| Sales & Service Conduct *(n<3)* | 2 | 0 | n/a | 0% | 0.00 |
| Shade Variation | 10 | 10 | 100% | 100% | 1.00 |
| Short Supply *(n<3)* | 2 | 0 | n/a | 0% | 0.00 |
| Size / Calibration *(n<3)* | 2 | 2 | 100% | 100% | 1.00 |
| Surface Defect | 4 | 4 | 100% | 100% | 1.00 |
| Unclear / insufficient information *(n<3)* | 2 | 5 | 40% | 100% | 0.57 |

## Cases

| Case | Tags | Expected | Suggested | Priority (exp → got) | Escalate (exp/got) | OK |
|---|---|---|---|---|---|---|
| E01 | standard, systemic | Shade Variation / Quality | Shade Variation / Quality | High → High | yes / yes | ✓ |
| E02 | repeat, systemic | Shade Variation / Quality | Shade Variation / Quality | High → High | yes / yes | ✓ |
| E03 | short_text, systemic | Shade Variation / Quality | Shade Variation / Quality | High → High | yes / yes | ✓ |
| E04 | standard | Breakage in Transit / Logistics | Breakage in Transit / Logistics | Medium → Medium | no / no | ✓ |
| E05 | standard | Short Supply / Logistics | Billing Discrepancy / Commercial | Medium → High | no / no | ✗ |
| E06 | repeat_customer | Size / Calibration / Production | Size / Calibration / Production | Medium → High | no / yes | ✗ |
| E07 | high_value, systemic, installed | Shade Variation / Quality | Shade Variation / Quality | High → High | yes / yes | ✓ |
| E08 | retention, key_account | Shade Variation / Quality | Shade Variation / Quality | High → High | yes / yes | ✓ |
| E09 | site_stopped | Short Supply / Logistics | Unclear / insufficient information / Customer Service | High → Medium | no / no | ✗ |
| E10 | standard | Billing Discrepancy / Commercial | Billing Discrepancy / Commercial | Medium → Medium | no / no | ✓ |
| E11 | standard | Delivery Delay / Logistics | Delivery Delay / Logistics | Low → Medium | no / no | ✓ |
| E12 | installed | Surface Defect / Quality | Surface Defect / Quality | Medium → Medium | no / no | ✓ |
| E13 | ambiguous | Surface Defect / Quality | Surface Defect / Quality | Medium → Medium | no / no | ✓ |
| E14 | low_severity | Surface Defect / Quality | Surface Defect / Quality | Low → Medium | no / no | ✓ |
| E15 | angry, repeat, systemic | Shade Variation / Quality | Shade Variation / Quality | High → High | yes / yes | ✓ |
| E16 | calm, systemic | Shade Variation / Quality | Shade Variation / Quality | High → High | yes / yes | ✓ |
| E17 | installed | Size / Calibration / Production | Size / Calibration / Production | Medium → High | no / no | ✓ |
| E18 | systemic | Shade Variation / Quality | Shade Variation / Quality | High → High | yes / yes | ✓ |
| E19 | short_text, systemic | Shade Variation / Quality | Shade Variation / Quality | High → High | yes / yes | ✓ |
| E20 | safety, calm_serious | Product Safety / Quality | Product Safety / Quality | Critical → Critical | yes / yes | ✓ |
| E21 | safety, multi_issue | Product Safety / Quality | Product Safety / Quality | Critical → Critical | yes / yes | ✓ |
| E22 | multi_issue, high_value | Breakage in Transit / Logistics | Delivery Delay / Logistics | High → High | no / no | ✓ |
| E23 | angry_low | Sales & Service Conduct / Commercial | Delivery Delay / Logistics | Low → Medium | no / no | ✓ |
| E24 | vague, missing_refs | Unclear / insufficient information / Customer Service | Unclear / insufficient information / Customer Service | Low → Low | no / no | ✓ |
| E25 | vague | Unclear / insufficient information / Customer Service | Unclear / insufficient information / Customer Service | Low → Low | no / no | ✓ |
| E26 | prompt_injection | Breakage in Transit / Logistics | Breakage in Transit / Logistics | Medium → Medium | no / no | ✓ |
| E27 | prompt_injection | Breakage in Transit / Logistics | Breakage in Transit / Logistics | Low → High | no / no | ✗ |
| E28 | legal, key_account | Surface Defect / Quality | Surface Defect / Quality | High → High | yes / yes | ✓ |
| E29 | finance | Payment / Credit Note / Finance | Payment / Credit Note / Finance | Medium → Medium | no / no | ✓ |
| E30 | duplicate | Breakage in Transit / Logistics | Breakage in Transit / Logistics | Medium → Medium | no / no | ✓ |
| E31 | usage | Installation / Usage / Customer Service | Installation / Usage / Customer Service | Low → Medium | no / no | ✓ |
| E32 | retention, conduct | Sales & Service Conduct / Commercial | Unclear / insufficient information / Customer Service | High → High | yes / yes | ✗ |
| E33 | site_stopped, key_account | Delivery Delay / Logistics | Unclear / insufficient information / Customer Service | High → Medium | no / no | ✗ |
| E34 | mixed_language | Breakage in Transit / Logistics | Breakage in Transit / Logistics | Medium → High | no / no | ✓ |
| E35 | positive, low_severity | Breakage in Transit / Logistics | Breakage in Transit / Logistics | Low → Low | no / no | ✓ |
| E36 | missing_refs, multi_issue | Shade Variation / Quality | Shade Variation / Quality | Medium → Medium | no / no | ✓ |
