# Deployment Notes

## Supabase

1. Create a new Supabase project.
2. Open SQL Editor.
3. Run `supabase/schema.sql`.
4. Copy the project URL and service role key into Fly.io secrets.
5. Copy the database connection string into `DATABASE_URL`.

## Fly.io API

Current app:

```text
https://drec-content-os-api.fly.dev
```

From `drec-content-os`:

```bash
fly launch --no-deploy
fly secrets set DATABASE_URL="postgresql://..."
fly secrets set SUPABASE_URL="https://..."
fly secrets set SUPABASE_SERVICE_ROLE_KEY="..."
fly deploy
```

The API exposes:

- `GET /health`
- `GET /loop-status`
- `GET/POST /kb`
- `GET/POST /publish-queue`
- `POST /metrics`
- `POST /feedback`

## Vercel Web

Current production app:

```text
https://drec-content-os.vercel.app
```

Deploy the repository root as a Vercel project. The root `vercel.json` copies
`apps/web` into `dist` during build, so the project works even if the Vercel
Root Directory is left as the repository root.

Set:

```text
DREC_API_BASE_URL=https://your-fly-app.fly.dev
```

The live web app is static and talks to the Fly.io API through
`DREC_API_BASE_URL`.

Manual workflow testing is documented in `docs/operator-test-runbook.md`.

## Live Smoke Check

Before deploy, run the local contract check:

```bash
npm run smoke:contract
```

This confirms key API routes, workflow safety gates, status schema assumptions,
and web/API contract strings are still present without importing Python
dependencies or touching live data.

After deploying Fly.io or Vercel, run a non-mutating live check:

```bash
DREC_ACCESS_TOKEN="..." npm run smoke:live
```

Optional overrides:

```bash
DREC_API_BASE_URL="https://drec-content-os-api.fly.dev" \
DREC_WEB_URL="https://drec-content-os.vercel.app" \
DREC_ACCESS_TOKEN="..." \
npm run smoke:live
```

The check verifies API health, workflow status, weekly report readiness, Meta
readiness, the scheduler-ready nightly metrics dry run, and the production web
shell without creating or changing records.

The Dashboard `Download Operator Pack` action calls
`/operations/operator-pack.md` and produces one Markdown handoff file with
readiness status, credential setup, publishing handoff copy, and the weekly
operating report.

The Dashboard `Run Risk Audit` action calls `/operations/risk-audit` and scans
automation gates, assets, queue items, and media for blocked or warning-level
issues before a publishing run.

The Scheduler `Download Run Sheet` action calls
`/operations/publishing-run-sheet.md` and creates a read-only shift sheet with
ready scheduled items, blocked items, captions, media, and post-publishing
recording reminders for manual Meta posting.

The Scheduler `Download Schedule CSV` action calls
`/publish-queue/schedule.csv` and exports the full queue for spreadsheet review,
including planned slots, blockers, captions, media links, and handoff readiness.

The Dashboard launch readiness summary calls `/operations/launch-readiness` and
separates what is usable now in manual mode from what remains blocked for real
Meta automation.

## GitHub Dry-Run Scheduler

The repository includes `.github/workflows/drec-scheduler-dry-run.yml`.
It is safe to leave enabled because it only calls dry-run endpoints and skips
itself when the GitHub secret is missing.

Set this GitHub Actions secret when you want scheduled dry-run checks:

```text
DREC_ACCESS_TOKEN
```

Optional repository variable:

```text
DREC_API_BASE_URL=https://drec-content-os-api.fly.dev
```

The Meta Setup screen now shows the same GitHub Scheduler Setup block, and the
Operator Pack exports it for non-technical rollout handoff.

The workflow checks:

- Due Meta publishing in dry-run mode every 6 hours
- Nightly Meta metrics in dry-run mode at 02:30 Asia/Kuala_Lumpur
- Automation status and content risk audit gates

## Nightly Meta Metrics Job

The API has guarded job endpoints for future scheduling:

```bash
curl -X POST \
  -H "X-DREC-Access-Token: ..." \
  "https://drec-content-os-api.fly.dev/jobs/meta-publishing?dry_run=true&channel=all"
```

```bash
curl -X POST \
  -H "X-DREC-Access-Token: ..." \
  "https://drec-content-os-api.fly.dev/jobs/nightly-meta-metrics?dry_run=true&limit=25&rollup=true"
```

Keep both jobs in dry-run mode until Meta credentials and permissions are ready.
The live app also exposes a protected `Meta Setup` checklist and copy-ready
command template through `/meta/setup-checklist`; paste real secret values only
into Fly.io or the provider dashboards, never into GitHub or the browser UI.
Real scheduled publishing needs Meta readiness plus these Fly secrets:

```bash
fly secrets set META_ENABLE_PUBLISHING=true
fly secrets set META_ENABLE_PUBLISHING_JOB=true
```

Real nightly ingestion needs all Meta readiness checks to pass plus this Fly secret:

```bash
fly secrets set META_ENABLE_METRICS_JOB=true
```

## GitHub

Recommended repository name:

```text
drec-content-os
```

Push only the `drec-content-os` folder as the first clean repository root.
