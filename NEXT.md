# NEXT

## Build Objective

Ship Stage 1 of DREC Content OS:

1. Publish rail: queue, review gate, and scheduler-ready records
2. Sense rail: metrics ingestion structure
3. Thin Core: KB, brand kit, compliance, feedback, outcomes
4. Deploy path: Supabase + Vercel + Fly.io + GitHub

## Done This Pass

- [x] Created deployable monorepo skeleton
- [x] Added Supabase schema for the learning spine
- [x] Added FastAPI service with health, KB, queue, metrics, and feedback endpoints
- [x] Added Vercel-ready UI shell based on the proposal screens
- [x] Added core contracts, brand tokens, and compliance rules
- [x] Added Fly.io and Vercel deployment config
- [x] Created Supabase project `DREC Content OS`
- [x] Applied Stage 1 schema and seeded initial Knowledge Base rows
- [x] Deployed web shell to Vercel
- [x] Deployed API to Fly.io
- [x] Connected API to Supabase REST
- [x] Added pre-publish compliance check and safety gate
- [x] Documented conservative Meta publishing path
- [x] Added weekly plan generation and brief drafting workflow
- [x] Added review actions, learning summary, and performance outcome tracking
- [x] Added publishing handoff builder for manual-safe execution before Meta is connected
- [x] Added asset library workflow and Creative Draft packages with caption variants, carousel slides, and reel scripts
- [x] Added raw metrics entry and rollup into scored learning outcomes
- [x] Added media library records with usage-rights and approval status
- [x] Enabled Supabase RLS with server API policies
- [x] Added private Supabase Storage upload path for DREC media
- [x] Added short-lived private media links for review/download
- [x] Added Meta readiness checks for credentials, permissions, and safe rollout sequence
- [x] Added guarded Facebook dispatch dry run with real-publish lock
- [x] Added Meta metrics ingestion dry run for published post IDs
- [x] Added manual post ID capture after safe handoff publishing
- [x] Added direct Record Published action inside handoff ready items
- [x] Added latest published post prefill for manual metric entry
- [x] Added one-click Save & Roll Up for Performance metrics
- [x] Added guarded Instagram dispatch dry run with container/publish planning
- [x] Added safe editing for queued captions, media URLs, planned time, channel, and format
- [x] Added scheduler filters and a next-7-days operating view
- [x] Added batch scheduling for review-approved queue items
- [x] Added learning-informed weekly topic recommendations
- [x] Added Learning-to-Weekly Plan topic handoff
- [x] Added content brief lifecycle actions for drafted and archived briefs
- [x] Added batch archive cleanup for drafted briefs
- [x] Added copy-ready publishing handoff package
- [x] Added blocker reasons for handoff readiness
- [x] Added calendar export for scheduled publishing reminders
- [x] Added visible review feedback notes for queued content decisions
- [x] Filtered Review Queue to unscheduled draft items
- [x] Added asset and media lifecycle review actions
- [x] Added batch approval for safety-clear assets and batch queueing for ready assets
- [x] Added copy-ready weekly operating report
- [x] Added one-click draft asset creation from weekly briefs
- [x] Added batch draft asset creation from current weekly briefs
- [x] Added saved asset package preview and copy action
- [x] Added quick scheduling for compliance-clear queue items
- [x] Added next-open-slot schedule suggestion for MYT publishing times
- [x] Added Dashboard next-best-action guidance for moving through the workflow
- [x] Added Dashboard operating counts for review, handoff, ready assets, and learning signals
- [x] Added API-backed workflow status for shared next-action guidance
- [x] Tightened review-to-schedule safety so approval and planned publishing time stay separate
- [x] Added server-enforced asset-to-queue readiness gates
- [x] Added human asset safety review controls before queueing
- [x] Clarified approved-but-unscheduled queue display
- [x] Added workflow readiness to weekly operating report
- [x] Made brief-to-asset creation idempotent to avoid duplicate draft assets
- [x] Made asset-to-queue creation idempotent to avoid duplicate active queue items
- [x] Added non-mutating live smoke check for deploy verification
- [x] Added local API contract smoke check for route and workflow gate verification
- [x] Added operator test runbook for the full manual workflow
- [x] Added scheduler-ready nightly Meta metrics job wrapper with dry-run default and explicit enable flag
- [x] Added scheduler-ready Meta publishing job wrapper with due-time gate and explicit enable flag
- [x] Added Meta Setup UI action for scheduled publishing job dry runs
- [x] Added Supabase service-role security readiness gate before stricter RLS hardening

## Next Engineering Tasks

- [x] Create the GitHub repository and push this folder
- [x] Create Supabase project and run `supabase/schema.sql`
- [x] Fill production environment variables in Fly.io and Vercel
- [x] Connect web UI actions to the API
- [x] Add auth protection to the API and token-gated web data access
- [x] Add weekly plan generation
- [x] Add first closed-loop learning report
- [x] Add Creative Engine draft packages
- [x] Add metrics-to-outcomes rollup before Meta is connected
- [x] Add media library records before Meta publishing
- [x] Add private media file upload through the API
- [x] Add signed links for private media review
- [x] Add Meta credential and permission health check screen
- [x] Add dry-run Facebook dispatch worker
- [x] Add dry-run Meta metrics ingestion worker
- [x] Add manual published-post ID capture for metrics learning
- [x] Add latest published post prefill for Performance metrics
- [x] Add dry-run Instagram dispatch worker
- [x] Add queue item editing before approval/publishing
- [x] Add scheduler status/channel filters and week view
- [x] Add batch schedule action for review-approved queue items
- [x] Feed learning signals back into weekly plan generation
- [x] Add Learning page action to send recommended topics into Weekly Plan
- [x] Add content brief status management after drafting
- [x] Add batch archive action for drafted briefs
- [x] Add copy-ready manual publishing package
- [x] Add handoff blocker reasons for not-ready items
- [x] Add downloadable publishing calendar
- [x] Add visible review feedback notes
- [x] Keep Review Queue focused on unscheduled draft items
- [x] Add asset and media lifecycle review controls
- [x] Add batch asset approval and queueing controls
- [x] Add weekly operating report
- [x] Add one-click draft asset creation from briefs
- [x] Add batch draft asset creation from weekly briefs
- [x] Add saved asset package preview/copy
- [x] Add quick queue scheduling
- [x] Add next-open-slot schedule suggestions
- [x] Add workflow guidance on the Dashboard
- [x] Add operational readiness counts to Dashboard
- [x] Add server-side workflow state for dashboard and future workers
- [x] Require planned time before handoff or Meta dispatch treats an item as publish-ready
- [x] Require asset approval and clear compliance before queueing from Assets
- [x] Add asset-level compliance review controls
- [x] Show review-approved queue items as ready to schedule without changing database status
- [x] Add queue-ready asset counts and next workflow action to weekly report
- [x] Reuse existing non-rejected asset when Save Asset is clicked repeatedly for the same brief
- [x] Reuse existing active queue item when Add To Queue is clicked repeatedly for the same asset
- [x] Add live smoke check script for API/web/report/Meta readiness
- [x] Add local contract smoke check for key routes and safety gates
- [x] Document the manual full-cycle test path from brief to weekly report
- [x] Update Dashboard Test Path to match handoff publishing and Save & Roll Up
- [x] Add guarded nightly Meta metrics job endpoint for scheduler wiring
- [x] Add guarded due-only Meta publishing job endpoint for scheduler wiring
- [x] Add Meta Setup button for scheduled publishing job dry run
- [x] Add Supabase service-role readiness check before strict RLS migration
- [ ] Connect Meta Graph API credentials
- [x] Implement real Facebook publish scheduling behind Meta readiness and enable flags
- [x] Implement Instagram two-step publish worker behind Meta readiness and enable flags
- [ ] Wire nightly metrics ingestion to a scheduler after Meta credentials are approved

## Stage 2 Preview

- Meta credential wizard and permission health checks
- Meta publishing worker after Page/Instagram credentials are approved
- Nightly Meta metrics ingestion
- Stronger role-based web login
