# DREC Content OS

One continuously-learning content engine for DREC / 逆转医学.

This repository starts the Stage 1 build from the unified proposal:

- Thin Core: shared data model, brand kit, compliance rules, and contracts
- Publish rail: scheduler-ready publish queue
- Sense rail: metric ingestion endpoints and storage
- Human gate: review-ready assets and feedback capture
- Media library: approved images/videos with rights status and private storage before publishing
- Learning spine: outcomes + feedback tables that let the weekly loop improve

## Target Deployment

- **Supabase**: Postgres database and auth-ready storage later
- **Vercel**: web UI shell
- **Fly.io**: Python API and background jobs
- **GitHub**: source control and CI/CD

Current Supabase project details are documented in `docs/supabase.md`.
Manual workflow testing is available on the Dashboard and documented in `docs/operator-test-runbook.md`.

## Project Shape

```text
drec-content-os/
  apps/
    api/          FastAPI service for queue, metrics, KB, feedback
    web/          Vercel-ready static UI shell
  core/
    brandkit/     DREC design tokens
    compliance/   shared health-content rules
    contracts/    JSON schema contracts between modules
  supabase/       database schema
  orchestrator/   weekly loop plan and later worker jobs
  docs/           setup and operations notes
  NEXT.md         working build tracker
```

## Local Start

1. Create a Supabase project.
2. Run `supabase/schema.sql` in Supabase SQL editor.
3. Copy `.env.example` to `.env` and fill the values.
4. Start the API:

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8080
```

5. Open `apps/web/index.html` in a browser, or deploy the repository root to Vercel.

## Current Status

Stage 1 is now a working thin-core workflow:

- Generate weekly DREC content briefs
- Use Insight Inbox to turn audience, competitor, ads, observation, idea, and learning signals into a safe Sense Brief before weekly planning
- Download an Ads Planning Pack from Insight Inbox with manual candidate tests, CPL targets from Knowledge Base, budget rules, and media buyer handoff
- Use Create Post for one-off content; it now saves a linked brief and draft asset into the review workflow with style, target signal, media, and compliance evidence attached
- Use the Assets Review Session summary and Markdown pack to run a focused human approval meeting with detector findings, recommended decisions, and next steps
- Use the Assets Rewrite Pack to prepare safer suggested captions for pending assets without auto-approving or changing saved content
- Apply a suggested rewrite to a draft asset while keeping human approval, queueing, scheduling, and publishing as separate gates
- Apply all detector-clear safe rewrites in one reviewed batch while still keeping approval, queueing, scheduling, and publishing locked behind human gates
- Use the First Cycle Handoff Pack to move from safe rewrites through human approval, queueing, scheduling, manual handoff, and metrics without bypassing safety gates
- Use the Approval Cockpit to prioritize clear draft assets for human review without auto-approving, queueing, scheduling, or publishing
- Use the Post-Approval Production Pack to brief design, media, rights checks, and visual QA after human approval without auto-queueing, scheduling, publishing, or sending Meta requests
- Use the Pre-Schedule Gate in Review/Scheduler to check human queue approval, final caption, approved media/design, visual QA, and schedule readiness before choosing publishing slots
- Use Creative Studio to review the DREC style library, brand tokens, KB style rules, safety rules, and style-learning signals before drafting or approving assets
- Use Template Studio to map static assets to DREC layout templates, render rules, brand tokens, and final QA before artwork handoff
- Use Video Studio to review reel readiness, approved video media, blockers, manual SOP steps, and the future DREC Cut lock before production handoff
- See the next best workflow action, operating counts, and copyable Test Path on the Dashboard, backed by the API, so testing and automation can move from brief to approved asset to queue, handoff, published ID, metrics, and report without guessing
- Use the Dashboard's live Test Path checklist to see which manual-cycle step is complete and jump to the next screen
- See launch readiness on the Dashboard, separating manual-use readiness from real Meta automation readiness
- See a plain "Can I Use It?" Dashboard decision that says what is safe to test now and what is not ready yet
- See an automation readiness gate that combines manual workflow, handoff, learning, Meta, and security status
- Run a protected content risk audit across automation gates, assets, active queue items, and media before publishing or enabling automation
- Download a protected Daily Ops Checklist with morning checks, today's priority, ready-to-publish items, blockers, learning prompts, and closeout steps
- Download a protected Weekly Cycle Pack from Learning that combines planning inputs, asset review, schedule/handoff, learning closeout, and weekly safety rules
- See overdue scheduled publishing items in risk audit and Daily Ops before missed handoff windows distort the workflow
- Download a protected launch evidence report with manual test status, readiness, risk, Meta setup, and safe go-live rules
- Download a protected First Test Kit with current next action, sample topics, manual metric values, acceptance criteria, and safety notes
- Download a protected First Test Run Tracker with live step status, evidence fields, and pass rules for the first manual workflow test
- Download a protected Manual Cycle QA report that summarizes the current test decision, blockers, risk, handoff, and learning gaps
- Download a protected CSV operations snapshot for audit or backup before rollout changes
- Download a protected Pipeline Board CSV that shows each topic's next action from brief through asset, queue, publishing, metrics, and learning
- Download a protected Audit Trail CSV that shows recent review, scheduler, role, and actor evidence before launch or Meta activation
- Download a Backup & Recovery Pack with required exports, data coverage, recovery order, degraded-mode rules, and weekly backup checks
- Download a protected operator pack with readiness status, setup checklist, publishing handoff, and weekly report in one Markdown file
- Download a Quarterly Learning Memo from Learning with posting-time heat, outcome signals, weight-change history, and next-quarter actions
- See the same "Can I Use It Now" decision in Launch Evidence and Operator Pack, including safe test scope and not-yet-ready automation blockers
- Use the GitHub Actions dry-run scheduler template to check publishing, metrics, automation, and risk gates without mutating live records
- Record GitHub dry-run scheduler heartbeats so the app can show whether the every-6-hour checks are actually running
- See the GitHub Scheduler Setup steps in Meta Setup and the Operator Pack before turning on recurring dry-run checks
- Download a Scheduler Activation Pack from Meta Setup with the GitHub secret, optional API variable, first-run check, heartbeat expectation, and dry-run safety rules
- Use Notify Rail in Meta Setup to preview n8n/WhatsApp approval alerts, role routing, and safe no-auto-approval rules before live message sending
- Use the guarded DREC Nightly Meta Metrics GitHub workflow, defaulting to dry-run and requiring both GitHub and Fly enable switches before live metrics ingestion
- Generate a Meta OAuth guide with redirect URI, required scopes, setup steps, and a copyable Login dialog URL/template before real credentials are installed
- Download a Meta Activation Checklist that shows credential gates, live worker switches, first-live-test order, and proof fields before enabling Meta automation
- Download a Meta Credential Wizard worksheet that explains each required Meta/Supabase value, where to collect it, where to store it, and the hard-stop rules before live setup
- Download a Meta Preflight Audit that combines credential, content risk, schedule, launch, security, access, and live-switch gates before a Meta dry run or first controlled live test
- See the Supabase service-role readiness gate before stricter RLS policies are applied
- See the current Access Role on the Dashboard and optionally configure separate viewer, reviewer, operator, and admin tokens while the legacy access token remains accepted; scoped routes now protect review, scheduling, metrics, and admin-sensitive actions, with optional actor labels for audit trails
- Download an Access Control Pack with role-token setup, actor naming, handoff policy, and rotation rules before full user login is added
- Download a protected RLS Hardening Plan and review the prepared strict server-only Supabase migration before applying it
- Use safer session-only access-token storage by default, with explicit Remember and Clear controls for shared testing devices
- Pull learning-informed topic recommendations into the next weekly plan
- Load active Knowledge Base context into weekly planning and creative drafts so brand, voice, compliance, and medical dictionary entries are visible during review
- Download the Knowledge Base as CSV so brand, voice, compliance, offer, and medical dictionary entries can be backed up or reviewed outside the app
- Download the weekly plan as CSV for team review of topics, hooks, formats, stages, status, and compliance notes
- Download a Brief-To-Asset Pack from Weekly Plan that maps each brief to its saved asset, review state, hooks, target signal, and next production action
- Mark content briefs as drafted or archived so weekly plans stay manageable
- Archive drafted briefs in one batch after assets are saved so the weekly plan stays focused
- Save a draft asset directly from a weekly brief for faster review prep
- Save all current weekly briefs as draft assets in one batch without duplicate copies
- Reuse an existing brief asset on repeated Save Asset clicks instead of creating duplicates
- Draft conservative educational captions
- Preview and copy saved asset packages with caption variants, carousel slides, or reel scripts
- Download a Media Shot List CSV that turns active draft assets into visual direction, shot requirements, media gaps, rights checks, and production priority
- Download an Asset Review Worklist that shows briefs to save, asset review blockers, and approved clear assets ready to queue
- Download a creative production pack with active assets, captions, slides, scripts, media notes, and KB review context
- Download an asset review CSV that combines draft asset readiness, media rights, approval status, blockers, and source URLs
- Download an Asset Review Decision CSV with captions, detector findings, and blank reviewer decision fields for human sign-off
- Preview and import completed Asset Review Decision CSV files so reviewed safety and approval decisions can be applied in batches without queueing or publishing
- Download an Asset Safety Review Pack with each asset caption, detector findings, reviewer checklist, and approval rules
- See the Asset Review Decision CSV import rules inside the Safety Review Pack and Operator Pack for reviewer handoff
- Copy an individual Asset Safety Review Note from each draft asset for reviewer handoff or audit notes
- Run pre-publish compliance checks
- Record human safety review on assets before queueing
- Approve safety-clear assets and queue approved clear assets in batches
- Add assets to the publishing queue only after asset approval and a clear safety check
- Reuse an existing active queue item when the same asset is added to queue again
- Queue and review posts with approval, regen, and rejection feedback trails
- Download a review log audit trail with recent approval, regeneration, rejection, and safety decisions
- Download an Editorial QA Pack that checks draft queue captions for hook, length, CTA, promise language, media gaps, and editor-ready decisions
- Download the current review queue as CSV with review state, latest feedback, blockers, captions, and media counts
- Download a Review-to-Schedule Pack that connects queue-ready assets, review-approved queue items, scheduled handoff items, and blockers
- Keep Review Queue focused on unscheduled draft items while Scheduler handles scheduled and published records
- Show reviewed queue items as approved-but-unscheduled until a planned publish time is selected
- Schedule review-approved, compliance-clear queue items in batches into suggested MYT publishing slots
- Edit queued captions, media URLs, planned time, and channel/format before publishing
- Cancel draft, scheduled, or failed queue items before publishing while keeping the feedback trail
- Keep cancelled queue items as history without counting them as active publishing risk
- Keep review approval separate from scheduling so approved content still needs a real planned time before handoff or Meta workers can use it
- Keep on-demand composer drafts tied to the same brief-to-asset learning spine as weekly planned content
- Download a Creative Style Guide for the current style library, brand colors, review rules, and performance-style signals
- Suggest the next open MYT publishing slot for compliance-clear queue items and schedule them without guessing
- Filter the scheduler by status/channel and scan the next 7 days of planned posts
- Download a Schedule Audit before handoff or Meta dry runs to catch duplicate planned slots, near-channel conflicts, missing times, and overdue scheduled items
- Download the full publishing schedule as CSV for spreadsheet review, blockers, captions, media links, and handoff readiness
- Download scheduled posts as a calendar file for manual publishing reminders
- Download a publishing run sheet for the next manual posting shift, including ready items, blockers, captions, media, and record-published reminders
- Build a manual publishing handoff while Meta credentials are pending
- Copy a ready-to-send publishing handoff package for manual posting
- Show why blocked handoff items are not ready yet
- Record the Meta post ID directly from the handoff after manual posting
- Mark manually published posts with their Meta post ID so metrics ingestion can learn from them later
- Download a metrics CSV template with current published candidates, sample manual values, and field instructions for cleaner performance entry
- Download a Metrics Closeout Pack that shows published posts waiting for metrics, raw metrics waiting for rollup, and recent learning outcomes
- Preview and import the completed metrics CSV back into Performance, with visible importable/skipped row details and optional learning rollup in one pass
- Dry-run Facebook and Instagram publishing workers before Meta credentials are connected
- Dry-run the scheduler-ready Meta publishing job against due scheduled posts before real posting is enabled
- Check the scheduled Meta publishing job from Meta Setup without using the terminal
- Download a Meta Credential Intake Pack with required values, OAuth scope checklist, safe command template, verification fields, and go-live rules
- Download a Meta Preflight Audit before Meta dry runs or first live testing, so credential, risk, schedule, launch, security, access-role, and live-switch blockers are visible together
- See the Nightly Metrics Scheduler in Meta Setup, including its default dry-run mode and live enable switches
- Dry-run the scheduler-ready nightly Meta metrics job before real ingestion is enabled
- Load the latest published post into Performance so raw metrics and outcomes do not require retyping the Meta ID and context
- Save raw metrics and roll them into a learning outcome in one Performance action
- Register approved media URLs or upload files into private Supabase Storage
- Approve, review, or block draft assets and media before they enter publishing
- Record raw performance metrics, roll them into scored outcomes, and view the first learning summary
- Compare outcome insights by format, channel, pillar, funnel stage, and audience so the next plan is based on visible performance signals
- Download a learning snapshot CSV with raw metrics, outcomes, and learning weights for weekly analysis or backup
- Download the weekly operating report directly from Learning for team review or weekly archive
- Build a copy-ready weekly operating report from briefs, queue, assets, feedback, outcomes, and next-topic recommendations
- Send learning topic recommendations directly back into Weekly Plan for the next cycle
- Include workflow readiness and queue-ready asset counts in the weekly operating report
- Run a non-mutating live smoke check after deploys to confirm the API, workflow, report, schedule suggestion, Meta readiness, and web shell are healthy
- Run a local API contract smoke check before deploys to catch missing routes or broken workflow gates

Meta auto-publishing and nightly Meta metrics ingestion are intentionally held until the Facebook Page and Instagram permissions are connected. See `NEXT.md` for the active build path.
