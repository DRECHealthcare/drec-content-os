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

## Next Engineering Tasks

- [ ] Create the GitHub repository and push this folder
- [ ] Create Supabase project and run `supabase/schema.sql`
- [ ] Fill production environment variables in Fly.io and Vercel
- [ ] Connect Meta Graph API credentials
- [ ] Implement real Facebook publish scheduling
- [ ] Implement Instagram two-step publish worker
- [ ] Add nightly metrics ingestion from Meta
- [ ] Add auth protection to the web UI
- [ ] Connect web UI actions to the API

## Stage 2 Preview

- Weekly plan generation
- Approval/edit capture as taste signals
- Brief routing into Creative Engine
- First true closed-loop learning report
