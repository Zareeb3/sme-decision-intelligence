# Deployment

There are two ways to run the app. Choose by where the company's data should live.

| | **Company server (Docker)** — recommended for real data | **Vercel** — demos and evaluation |
|---|---|---|
| Data storage | On the server (`DATA_DIR`), shared by all users, with version restore | In each user's browser only (no shared storage) |
| SAP pipeline / ingest API / drop folder | Yes | No (needs a persistent disk) |
| Sign-in | `BASIC_AUTH_*`, or the company's SSO/reverse proxy in front | Vercel password protection, or `BASIC_AUTH_*` |
| Data leaves the company network | Only the AI evidence packet, and only if an API key is set | Uploaded files stay in the browser; same AI rule |

## A. Company server with Docker

Needs a Linux VM or Windows server with Docker; 2 vCPU and 4 GB RAM is a reasonable start (see sizing below).

```bash
git clone https://github.com/Zareeb3/sme-decision-intelligence-pro.git
cd sme-decision-intelligence-pro
cp .env.example .env
# edit .env:
#   INGEST_TOKEN=<openssl rand -hex 32>
#   BASIC_AUTH_USER=... BASIC_AUTH_PASSWORD=...   (or put SSO in front)
#   ENABLE_SAMPLE_DATA=false                     (hide the fictional company)
#   ANTHROPIC_API_KEY=...                        (optional, live AI explanations)
docker compose up -d --build
```

Open `http://<server>:3000`, sign in, and follow **Set up your company**. Put HTTPS in front (the company's reverse proxy, IIS ARR, nginx or Caddy): Basic authentication and the ingest token must only travel over HTTPS.

**Data and backups.** Everything the app stores is in the `app-data` volume (`/data` in the container): `datasets/*.csv` (current and previous version of each dataset), `manifest.json` (who loaded what, when), `settings.json`, `complaints/cases.json` (the complaint register with its full history), and the drop folder (`incoming/`, `processed/`, `failed/`). Back up the volume with the server's normal backup. To use a shared folder that SAP jobs write into as the drop folder, uncomment the bind mount in `docker-compose.yml`.

**Sizing.** Analytics run in the browser on the loaded datasets. Tested comfortably with the sample (8,000 sales lines, 8,000 invoices). For a manufacturer with a few hundred thousand billing lines over three years, expect initial loads of a few seconds on a normal laptop; beyond roughly a million lines, load a shorter history or aggregate lines per invoice before loading. This has not been benchmarked on real company volumes yet; measure during the pilot.

**Without Docker.** `npm install && npm run build && DATA_DIR=/srv/di-data npm start` behind any process manager (pm2, systemd, Windows service). Node.js 20.9+.

**One instance per data folder.** The complaint register is a JSON file with changes serialised inside the app process; run a single app container per `DATA_DIR` (the compose file does).

**Updating.** `git pull && docker compose up -d --build`. Data in the volume is kept.

## B. Vercel

1. In Vercel: **Add New → Project**, import the GitHub repository (install the Vercel GitHub app for this repository if asked). Framework: Next.js, detected automatically. Node 20 or 22.
2. Deploy. With no environment variables the app shows the sample company and lets anyone upload CSVs into their own browser.
3. Optional environment variables: `ANTHROPIC_API_KEY`, `ENABLE_SAMPLE_DATA`, `BASIC_AUTH_USER`/`BASIC_AUTH_PASSWORD`, `N8N_WEBHOOK_URL`.

Vercel functions have no persistent disk, so server storage, the ingest API and the drop folder are switched off there (the Data sources page says so). Use Docker for pipelines.

For a public demo link, leave `ANTHROPIC_API_KEY` unset (demo mode) or protect the deployment, so nobody else spends the API budget.

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `DATA_DIR` | Server storage folder for datasets, settings and the drop folder | `./.data` self-hosted; off on Vercel |
| `INGEST_TOKEN` | Bearer token required by `/api/ingest/*` | not set → ingest disabled |
| `ENABLE_SAMPLE_DATA` | `false` hides the fictional sample company | `true` |
| `ALLOW_UI_UPLOADS` | `false` makes the app pipeline-only | `true` |
| `BASIC_AUTH_USER`, `BASIC_AUTH_PASSWORD` | Sign-in for all pages and APIs except ingest | not set → open |
| `ANTHROPIC_API_KEY` | Live AI explanations; server-side only | not set → demo mode |
| `ANTHROPIC_MODEL` | Model for explanations | `claude-sonnet-5-5` |
| `LLM_TIMEOUT_MS` | Provider timeout | `45000` |
| `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET` | Receive human-approved actions | not set → actions recorded as not sent |

## After deploying

- Open **Settings → Integrations** (or `/api/status`) to see which features are on. Secrets are never shown.
- Only describe the app as deployed once the URL works for someone else.

## Verification status

The Dockerfile and compose file follow the standard Next.js standalone pattern but were **not built** in the development environment (no Docker or npm registry access there). Build them once on the target server or in CI before the pilot.
