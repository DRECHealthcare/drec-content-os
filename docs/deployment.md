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
- `GET /operations/launch-evidence.md`
- `POST /operations/scheduler-heartbeat`
- `GET/POST /kb`
- `GET /kb/export.csv`
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

The Dashboard `Download Launch Evidence` action calls
`/operations/launch-evidence.md` and produces one Markdown evidence file with
manual test progress, launch readiness, automation gates, risk items, Meta
credential status, and safe go-live rules.

The Weekly Plan `Download Plan CSV` action calls `/briefs/plan.csv` and exports
recent briefs for spreadsheet review, including topics, hooks, stages, status,
and compliance notes.

The Weekly Plan `Download Asset Pack` action calls `/briefs/asset-pack.md` and
exports a brief-to-asset production handoff with saved asset IDs, review/safety
state, hooks, target signals, and the next production action for each brief.

The Assets `Download Asset Review CSV` action calls
`/operations/asset-review.csv` and exports draft assets plus media-library
records with readiness, blockers, rights, approval, and source URL fields.

The Review Queue `Download Review Queue CSV` action calls
`/operations/review-queue.csv` and exports the current unscheduled draft review
queue with review state, latest feedback, blockers, captions, and media counts.

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

The Dashboard `Download RLS Plan` action calls
`/security/rls-hardening-plan.md` and exports the strict Supabase RLS rollout
steps. Apply `supabase/migrations/20260617040906_strict_server_only_rls.sql`
only after Fly has `SUPABASE_SERVICE_ROLE_KEY` and live smoke passes.

The Learning `Download Cycle Pack` action calls
`/operations/weekly-cycle-pack.md` and exports a one-cycle operating packet
covering planning inputs, assets, queue, handoff, learning closeout, risks, and
weekly closeout rules.

## GitHub Dry-Run Scheduler

The repository includes `.github/workflows/drec-scheduler-dry-run.yml`.
It is safe to leave enabled because it only calls dry-run endpoints and skips
itself when the GitHub secret is missing.
When the workflow runs with a valid token, it calls
`/operations/scheduler-heartbeat` after the checks pass. The Meta Setup screen
and automation status use that heartbeat as evidence that the recurring
six-hour checks are actually active.

Set this GitHub Actions secret when you want scheduled dry-run checks:

```text
DREC_ACCESS_TOKEN
```

Optional repository variable:

```text
DREC_API_BASE_URL=https://drec-content-os-api.fly.dev
```

The Meta Setup screen now shows the same GitHub Scheduler Setup block. Use
`Download Scheduler Pack` or call `/operations/scheduler-activation-pack.md`
to export the one-page activation guide with the required secret, optional API
variable, first-run check, heartbeat expectation, and dry-run safety rules. The
Operator Pack also includes the scheduler setup for rollout handoff.

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
