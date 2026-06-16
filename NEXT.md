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
- [ ] Connect Meta Graph API credentials
- [ ] Implement real Facebook publish scheduling
- [ ] Implement Instagram two-step publish worker
- [ ] Add nightly metrics ingestion from Meta

## Stage 2 Preview

- Meta credential wizard and permission health checks
- Meta publishing worker after Page/Instagram credentials are approved
- Nightly Meta metrics ingestion
- Stronger role-based web login
