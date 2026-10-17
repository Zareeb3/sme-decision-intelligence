# Security and privacy

What is implemented, what is configurable, and what a company should add before a wide rollout.

## Implemented

| Area | Control |
|---|---|
| **Secrets** | `ANTHROPIC_API_KEY`, `INGEST_TOKEN`, `BASIC_AUTH_PASSWORD` and `N8N_WEBHOOK_SECRET` are read only in server code and never sent to the browser. `/api/status` and Settings show booleans only. `.env*` files and `pipeline/config.json` are git-ignored. |
| **Sign-in** | When `BASIC_AUTH_USER`/`BASIC_AUTH_PASSWORD` are set, middleware requires them for every page and API except `/api/ingest` (which has its own token). Comparison is constant-time. Use HTTPS. |
| **Pipeline access** | `/api/ingest/*` requires `Authorization: Bearer <INGEST_TOKEN>` (constant-time comparison), is rate-limited, size-limited (100 MB) and returns 503 when no token is configured. |
| **Data at rest** | Self-hosted: datasets are CSV files in `DATA_DIR` on the company's own server; protect the folder with OS permissions and back it up. Vercel/browser mode: uploads stay in the user's browser (IndexedDB) and are never sent to the server. |
| **Safe replacement** | Every upload and ingest is validated first; invalid files never replace current data. The previous version of each dataset is kept and can be restored; writes are atomic. Each load records who (name or pipeline) and when. |
| **Data sent to the AI provider** | Only the evidence packet for one question: labels and aggregated numbers, never raw rows. With **"Replace customer names before sending to AI"** (on by default for company data), customer names are replaced by "Account A", "Account B" … before leaving the browser and restored in the answer locally. Without an API key nothing is sent anywhere (demo mode). |
| **Input validation** | Zod schemas for every dataset row, settings, evidence packets, actions and approvals. Upload size limits (50 MB browser, 100 MB ingest); question length 500 characters; packet size 60 KB. |
| **Output validation** | The model must answer through a fixed JSON schema (forced tool call), revalidated with Zod; every number is checked against the evidence and unverified numbers are flagged to the user. |
| **Prompt injection** | Data can contain text (e.g. a customer name). The system prompt treats evidence as data; the model has no tools that act on the world; output is structured. |
| **Complaint text** | Treated as untrusted input: delimited in the prompt, tags stripped, instructions inside it detected and flagged, structured output only. Names, phone numbers, e-mail addresses, ID, card and bank numbers are removed in the browser and again on the server before triage; amounts, invoices and balances are never sent. Draft replies containing commitments (refunds, replacements, compensation, dates) are replaced and flagged. |
| **Complaint decisions** | The AI only adds suggestions. Confirming triage, changing status, approving replies and acknowledging escalations require a named person and are enforced by shared workflow code on the server and in the browser; every change is appended to the case history; stale updates are rejected (version check). Safety, legal and retention cases cannot be rated below the rule minimum without a written reason. |
| **Human approval** | `/api/actions` refuses requests without `approved: true` and a named approver; the UI requires reviewing the payload. The n8n destination comes only from server configuration (no SSRF). |
| **Headers** | `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`; `X-Powered-By` removed. |
| **Honest labelling** | Sample data, demo mode, provider failures and unverified numbers are always shown as such. |

## Recommended before a company-wide rollout

- **Single sign-on and roles.** Basic authentication is one shared login. For more than a small team, put the app behind the company identity provider (Azure AD / Entra ID application proxy, Okta, oauth2-proxy) and decide who may load data versus view it (`ALLOW_UI_UPLOADS=false` makes it pipeline-only).
- **Durable rate limiting and audit log.** Limits are in memory per instance; approvals are forwarded to n8n but not stored by the app. The dataset manifest records loads only.
- **Server-side evidence.** The server trusts the evidence packet computed in the browser. With server-held data, the server could build it itself.
- **Content Security Policy.** Not configured yet.
- **AI provider terms.** Review the provider's data-retention and training terms with the company's legal/IT team before enabling live mode, even with name replacement on.
- **Authenticated identities for complaint decisions.** "Acting as" is a typed name; with SSO the name should come from the login.
- **Penetration test.** Not performed. No claim of production-grade security is made.
