# Deploying to Vercel

The app is a standard Next.js project: no database, no extra services. The sample data ships in `public/sample-data`, so a deployment works immediately in demo mode.

## 1. Check locally first

```bash
npm install
npm run typecheck && npm test && npm run build
npm start          # http://localhost:3000
```

Commit `package-lock.json` after the first `npm install` so Vercel installs the same versions.

## 2. Push to GitHub

```bash
git init
git add .
git commit -m "SME Decision Intelligence: initial version"
git branch -M main
git remote add origin https://github.com/<you>/sme-decision-intelligence.git
git push -u origin main
```

`.gitignore` already excludes `.env*` files, `node_modules` and build output. Before pushing, confirm no keys are in the repository: `git grep -n "sk-ant"` should return nothing.

## 3. Import into Vercel

1. In Vercel, choose **Add New → Project** and import the GitHub repository.
2. Framework preset: **Next.js** (detected automatically). Build command `next build`, output handled by Vercel.
3. Node.js version: 20 or 22 (Project Settings → General).
4. Deploy. The app runs in demo mode.

## 4. Optional: enable live AI explanations

Project Settings → Environment Variables:

| Name | Value | Environments |
|---|---|---|
| `ANTHROPIC_API_KEY` | your key | Production (and Preview if wanted) |
| `ANTHROPIC_MODEL` | optional override | as above |

Redeploy. The Ask page badge changes from "Demo mode" to "Live AI explanations enabled".

**Cost control:** each question is one API call with a compact prompt (an evidence packet of at most 90 short lines). Set a monthly spend limit in the Anthropic console. The `/api/ask` route also limits each IP to 20 questions per minute per server instance. For a public portfolio link, consider leaving the key unset (demo mode) and demonstrating live mode locally, or protecting the deployment with Vercel's password protection.

## 5. Optional: connect n8n

Add `N8N_WEBHOOK_URL` (and `N8N_WEBHOOK_SECRET`) to the environment variables and redeploy. See [N8N.md](N8N.md).

## 6. After deploying

- Open `/api/status` to confirm which integrations are configured (booleans only, no secrets).
- Walk through the [demo script](DEMO_SCRIPT.md).
- Only describe the app as "deployed" once the URL works for someone else.
