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
fly secrets set DREC_ACCESS_TOKEN="..."
fly deploy
```

Optional role-token hardening can be added without breaking the existing access
token. Set `DREC_VIEWER_TOKEN`, `DREC_REVIEWER_TOKEN`, `DREC_OPERATOR_TOKEN`,
and `DREC_ADMIN_TOKEN` as Fly secrets, then check `/security/access-policy` or
the Dashboard `Access Role` card. The existing `DREC_ACCESS_TOKEN` remains
accepted as admin for backward compatibility. Reviewer tokens can work on
briefs, creative drafts, assets, media review, and feedback; operator tokens can
queue, schedule, build handoff, and dry-run publishing; metrics tokens can
import performance data, roll up outcomes, and run metrics dry runs; admin tokens
are reserved for security rollout and scheduler heartbeat setup.
Operators can fill the browser `Actor name` field, or send `X-DREC-Actor`, so
review and scheduler feedback rows include role/actor audit tags.
The Dashboard `Download Access Pack` action calls
`/security/access-control-pack.md` and exports role-token setup guidance, actor
naming rules, handoff policy, and rotation rules before full user login is
added.

`GET /health` reports both direct Postgres and Supabase REST status. If
`DATABASE_URL` is not installed yet but Supabase REST can read the checked
Content OS tables, `data_backend` reports `supabase_rest` instead of making the
system look fully disconnected. `GET /security/data-connection` is protected by
the DREC access token and shows the per-table REST diagnostic without exposing
database passwords, API keys, or service-role tokens.

Project completion scoring treats server data connection evidence separately
from strict RLS hardening. A working Supabase REST backend can satisfy the data
connection gate, while the RLS/service-role gate remains blocked until
`SUPABASE_SERVICE_ROLE_KEY` and the service-role smoke test are complete.

The API exposes:

- `GET /health`
- `GET /loop-status`
- `GET /security/data-connection`
- `GET /security/access-policy`
- `GET /security/access-control-pack.md`
- `GET /operations/launch-evidence.md`
- `POST /operations/scheduler-heartbeat`
- `GET/POST /kb`
- `GET /kb/export.csv`
- `GET/POST /publish-queue`
- `POST /metrics`
- `POST /feedback`

## Web UI

Current production app:

```text
https://drec-content-os-api.fly.dev/ui/
```

The Fly.io API serves the current operator UI at `/ui/`. The Vercel static web
deployment can still be used as a secondary shell, but the Fly UI is the
preferred live app because it is deployed with the API and avoids stale static
files.

If using Vercel, deploy the repository root as a Vercel project. The root
`vercel.json` copies `apps/web` into `dist` during build, so the project works
even if the Vercel Root Directory is left as the repository root.

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
DREC_WEB_URL="https://drec-content-os-api.fly.dev/ui/" \
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

The Dashboard `Download Pipeline Board` action calls
`/operations/pipeline-board.csv` and exports one status board that tracks each
topic from brief through asset review, queue review, scheduling, publishing,
metrics, and learning next action.

The Weekly Plan `Download Plan CSV` action calls `/briefs/plan.csv` and exports
recent briefs for spreadsheet review, including topics, hooks, stages, status,
and compliance notes.

The Weekly Plan `Download Asset Pack` action calls `/briefs/asset-pack.md` and
exports a brief-to-asset production handoff with saved asset IDs, review/safety
state, hooks, target signals, and the next production action for each brief.

The Assets `Download Shot List` action calls `/operations/media-shot-list.csv`
and exports active draft assets as a visual production sheet with visual
direction, shot requirements, media gaps, rights checks, and production priority
for design or filming handoff.

The Assets `Download Asset Review CSV` action calls
`/operations/asset-review.csv` and exports draft assets plus media-library
records with readiness, blockers, rights, approval, and source URL fields.

The Assets `Download Review Decisions` action calls
`/operations/asset-review-decisions.csv` and exports active draft assets with
caption text, detector findings, and blank reviewer decision fields for
spreadsheet-style human sign-off. It is read-only and does not approve assets.
After the reviewer fills the CSV, `Preview Decisions` and `Import Decisions`
call `/operations/import-asset-review-decisions`. Preview is read-only. Import
updates asset safety/review status only, records feedback notes, and never queues
or publishes content.
The same import rules are also printed inside the Safety Review Pack and
Operator Pack so operators can follow the reviewer handoff even while frontend
deploys are delayed.

The Assets `Download Safety Review` action calls
`/operations/asset-safety-review.md` and exports draft captions, detector
findings, human review checklist, and approval rules before queueing.

The Review Queue `Download Review Queue CSV` action calls
`/operations/review-queue.csv` and exports the current unscheduled draft review
queue with review state, latest feedback, blockers, captions, and media counts.

The Review Queue `Download Editorial QA` action calls
`/operations/editorial-qa-pack.md` and exports a read-only editor checklist for
draft queue items, including hook/structure, CTA, promise-language, caption
length, compliance, and media gap checks before scheduling.

The Review Queue `Download Review-to-Schedule` action calls
`/operations/review-to-schedule-pack.md` and exports queue-ready assets,
review-approved draft queue items, handoff-ready scheduled items, and blockers
in one read-only operating pack.

The Performance `Download Metrics Closeout` action calls
`/operations/metrics-closeout-pack.md` and exports published candidates waiting
for metrics, raw metric rows waiting for rollup, recent learning outcomes, and
closeout rules for the weekly learning loop.

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

The Scheduler `Download Schedule Audit` action calls
`/publish-queue/schedule-audit.md` and exports a read-only conflict report for
duplicate planned slots, near same-channel timing conflicts, missing planned
times, and overdue scheduled items before handoff or Meta dry runs.

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

## GitHub Monthly Notion Refresh Watch

The repository includes
`.github/workflows/drec-monthly-notion-refresh-watch.yml`. It runs on the 19th
and 20th of each month at 09:15 Asia/Kuala_Lumpur so the system checks the
Notion monthly carousel source after the expected refresh window and again the
next morning in case the refresh is late.

It uses the same GitHub Actions secret as the dry-run scheduler:

```text
DREC_ACCESS_TOKEN
```

Optional repository variable:

```text
DREC_API_BASE_URL=https://drec-content-os-api.fly.dev
```

The workflow is read-only. It calls:

- `/notion/monthly-refresh-status`
- `/operations/monthly-carousel-acceptance-audit`
- `/operations/monthly-carousel-production-smoke-test`

It does not approve content, create queue items, schedule posts, publish, update
Notion, or call Meta. Use the Action summary after the 19th refresh to confirm
there are no duplicate Topic IDs, current-cycle rows are visible, and generated
carousel previews still pass structural smoke tests.

Connector status as of 2026-06-21: the Notion connector can verify the database
schema and data source URL, but row-level database querying requires a Notion
Enterprise plan with Notion AI in the current workspace. Until that gate is
removed, the safe production path is to export the refreshed Notion view as CSV
and import it through the app with `Topic ID` dedupe.

## GitHub Publishing Closeout Watch

The repository includes `.github/workflows/drec-publishing-closeout-watch.yml`.
It runs daily at 10:00 Asia/Kuala_Lumpur to check whether manual publishing,
post-ID capture, metrics entry, learning rollup, and weekly reporting are still
moving after a post is published.

It uses the same GitHub Actions secret as the other safe monitors:

```text
DREC_ACCESS_TOKEN
```

Optional repository variable:

```text
DREC_API_BASE_URL=https://drec-content-os-api.fly.dev
```

The workflow is read-only. It calls:

- `/operations/publishing-closeout`
- `/metrics/published-source`
- `/learning-summary`
- `/weekly-report.md`

It does not publish, import metrics, roll up outcomes, approve content, update
Notion, or call Meta. Use the Action summary after a manual post to spot any
missing external post ID, missing metrics, pending rollup, or learning report
issue before the next planning cycle.

## GitHub Project Completion Watch

The repository includes `.github/workflows/drec-project-completion-watch.yml`.
It runs daily at 09:45 Asia/Kuala_Lumpur after the morning closeout check to
capture the current project completion percentage, the live unblock board,
workflow status, and launch readiness in one Action summary.

It uses the same GitHub Actions secret as the other safe monitors:

```text
DREC_ACCESS_TOKEN
```

Optional repository variable:

```text
DREC_API_BASE_URL=https://drec-content-os-api.fly.dev
```

The workflow is read-only. It calls:

- `/operations/project-completion-audit`
- `/operations/project-unblock-board`
- `/workflow/status`
- `/launch-readiness`
- `/operations/project-completion-watch-heartbeat`

It does not approve, import, queue, schedule, publish, update Notion, store
secrets, or call Meta. It records one dedicated project-completion-watch
heartbeat only after the completion, unblock, workflow, and launch checks pass;
this heartbeat is separate from the dry-run scheduler heartbeat. Use the Action
summary to see whether the next blocker is doctor/human approval, production
media, queue review, scheduling evidence, metrics closeout, Supabase
service-role/RLS, or Meta activation.

## GitHub Today Next Action Watch

The repository includes `.github/workflows/drec-today-next-action-watch.yml`.
It runs every 6 hours and writes one concise Action summary with the single
recommended operator action, the monthly carousel queue status, publishing
closeout status, and the project unblock board.

It uses the same GitHub Actions secret as the other safe monitors:

```text
DREC_ACCESS_TOKEN
```

Optional repository variable:

```text
DREC_API_BASE_URL=https://drec-content-os-api.fly.dev
```

The workflow is read-only. It calls:

- `/operations/today-next-action`
- `/operations/monthly-carousel-next-action-queue`
- `/operations/publishing-closeout`
- `/operations/project-unblock-board`

It does not approve, import, queue, schedule, publish, record post IDs, update
Notion, store secrets, or call Meta. Use it as the lightweight six-hour
operator pulse: the summary should answer “what should I do next?” without
opening the full UI.

## GitHub Nightly Meta Metrics Scheduler

The repository also includes `.github/workflows/drec-nightly-meta-metrics.yml`.
It runs daily at 02:30 Asia/Kuala_Lumpur and defaults to dry-run mode. Live
metrics ingestion requires both of these switches:

```text
GitHub Actions variable: DREC_ENABLE_REAL_META_METRICS=true
Fly secret: META_ENABLE_METRICS_JOB=true
```

Keep the GitHub variable unset or `false` until Meta readiness is green and a
manual workflow dispatch has passed in dry-run mode with `ready=true` and at
least one planned request. Even when the GitHub variable is true, the workflow
first runs a same-run dry-run proof and blocks live ingestion unless that
payload is ready; the API also blocks live ingestion unless the Fly
`META_ENABLE_METRICS_JOB` secret is enabled and Meta credentials/permissions
pass readiness checks.

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
Download `/meta/credential-wizard.md` from Meta Setup before installing secrets;
it explains each required Meta/Supabase value, where to collect it, where to
store it, and the hard-stop rules before live Meta switches are enabled.
Download `/meta/credential-intake-pack.md` from Meta Setup before installing
credentials so the Page ID, IG user ID, token permission check, dry-run evidence,
and first live-test record are tracked in one place.
Download `/meta/activation-checklist.md` before enabling live Meta switches; it
shows credential gates, scheduler proof, live worker switch status, and the
required first Facebook -> Instagram -> nightly metrics activation order.
Download `/meta/preflight-audit.md` before Meta dry runs or the first controlled
live test; it combines credential, content risk, schedule, launch, security,
access-role, and live-switch gates in one read-only decision report.
Real scheduled publishing needs Meta readiness plus these Fly secrets:

```bash
fly secrets set META_ENABLE_PUBLISHING=true
fly secrets set META_ENABLE_PUBLISHING_JOB=true
```

Real nightly ingestion needs all Meta readiness checks to pass, a ready=true
nightly metrics dry run with planned requests, plus this Fly secret:

```bash
fly secrets set META_ENABLE_METRICS_JOB=true
```

## GitHub

Recommended repository name:

```text
drec-content-os
```

Push only the `drec-content-os` folder as the first clean repository root.
