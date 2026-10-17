# Security and privacy

This is a portfolio and demonstration application. The controls below are implemented; the gaps are listed so nobody mistakes it for a production system.

## Implemented

| Area | Control |
|---|---|
| **Secrets** | `ANTHROPIC_API_KEY` and `N8N_WEBHOOK_SECRET` are read only in server code (`src/lib/ai/anthropic.ts`, `src/app/api/actions/route.ts`). They are never sent to the browser; `/api/status` returns booleans and the model name only. `.env*` files are git-ignored; `.env.example` contains no values. |
| **Data minimisation** | CSV uploads are parsed and analysed in the browser. Only the evidence packet (labels and aggregated numbers, plus at most a handful of customer names) is sent to `/api/ask`, and from there to the AI provider. Raw rows never leave the browser. |
| **Input validation** | Every CSV row is validated with Zod. `/api/ask` validates the evidence packet against a schema and rejects bodies over 60 KB; questions are capped at 500 characters. `/api/actions` validates the action and the approval. |
| **Output validation** | The model's answer must match a JSON schema (forced tool call) and is validated again with Zod before use; numbers are grounding-checked. |
| **Prompt injection** | Uploaded data can contain text (e.g. a customer name). The system prompt states that the evidence is data, not instructions; the model can only return the fixed answer structure; it has no tools that act on the world. |
| **Human approval** | `/api/actions` refuses any request without `approved: true` and a named approver. The UI also requires ticking "I have reviewed the payload". |
| **SSRF prevention** | The n8n destination comes only from the server's `N8N_WEBHOOK_URL`; the request cannot choose where data is sent. |
| **Abuse limits** | Per-IP fixed-window rate limits on `/api/ask` (20/min) and `/api/actions` (30/min). |
| **Headers** | `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`; `X-Powered-By` removed. |
| **Honest labelling** | Demo mode, provider failures and unverified numbers are always shown to the user. |

## Not implemented (needed before real business use)

- **Authentication and authorisation.** Anyone with the URL can use the app and, if configured, spend the API budget.
- **Durable rate limiting.** The limiter is in memory per server instance; use a shared store (e.g. Redis/Upstash) in production.
- **Audit log.** Approvals are forwarded to n8n but not stored by the app.
- **Server-side recomputation of evidence.** The server trusts the evidence packet the browser computed. With server-held data, the server should build the packet itself.
- **Content Security Policy.** Not configured yet.
- **Data retention agreements** with the AI provider and n8n host for real customer data.

## Using real company data

Do not upload real employer or customer data to a public deployment. For a private pilot: deploy behind authentication, review the AI provider's data-usage terms, prefer aggregated exports, and remove personal data that analysis does not need.
