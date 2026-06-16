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
- [x] Added guarded Instagram dispatch dry run with container/publish planning
- [x] Added safe editing for queued captions, media URLs, planned time, channel, and format
- [x] Added scheduler filters and a next-7-days operating view
- [x] Added learning-informed weekly topic recommendations
- [x] Added content brief lifecycle actions for drafted and archived briefs
- [x] Added copy-ready publishing handoff package
- [x] Added calendar export for scheduled publishing reminders
- [x] Added visible review feedback notes for queued content decisions
- [x] Added asset and media lifecycle review actions
- [x] Added copy-ready weekly operating report
- [x] Added one-click draft asset creation from weekly briefs
- [x] Added saved asset package preview and copy action
- [x] Added quick scheduling for compliance-clear queue items
- [x] Added Dashboard next-best-action guidance for moving through the workflow
- [x] Added API-backed workflow status for shared next-action guidance
- [x] Tightened review-to-schedule safety so approval and planned publishing time stay separate

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
- [x] Add dry-run Instagram dispatch worker
- [x] Add queue item editing before approval/publishing
- [x] Add scheduler status/channel filters and week view
- [x] Feed learning signals back into weekly plan generation
- [x] Add content brief status management after drafting
- [x] Add copy-ready manual publishing package
- [x] Add downloadable publishing calendar
- [x] Add visible review feedback notes
- [x] Add asset and media lifecycle review controls
- [x] Add weekly operating report
- [x] Add one-click draft asset creation from briefs
- [x] Add saved asset package preview/copy
- [x] Add quick queue scheduling
- [x] Add workflow guidance on the Dashboard
- [x] Add server-side workflow state for dashboard and future workers
- [x] Require planned time before handoff or Meta dispatch treats an item as publish-ready
- [ ] Connect Meta Graph API credentials
- [ ] Implement real Facebook publish scheduling
- [ ] Implement Instagram two-step publish worker
- [ ] Add nightly metrics ingestion from Meta

## Stage 2 Preview

- Meta credential wizard and permission health checks
- Meta publishing worker after Page/Instagram credentials are approved
- Nightly Meta metrics ingestion
- Stronger role-based web login
