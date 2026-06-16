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
- See the next best workflow action, operating counts, and copyable Test Path on the Dashboard, backed by the API, so testing and automation can move from brief to approved asset to queue, handoff, published ID, metrics, and report without guessing
- Use the Dashboard's live Test Path checklist to see which manual-cycle step is complete and jump to the next screen
- See launch readiness on the Dashboard, separating manual-use readiness from real Meta automation readiness
- See an automation readiness gate that combines manual workflow, handoff, learning, Meta, and security status
- Run a protected content risk audit across automation gates, assets, queue items, and media before publishing or enabling automation
- Download a protected CSV operations snapshot for audit or backup before rollout changes
- Download a protected operator pack with readiness status, setup checklist, publishing handoff, and weekly report in one Markdown file
- Use the GitHub Actions dry-run scheduler template to check publishing, metrics, automation, and risk gates without mutating live records
- See the GitHub Scheduler Setup steps in Meta Setup and the Operator Pack before turning on recurring dry-run checks
- See the Supabase service-role readiness gate before stricter RLS policies are applied
- Pull learning-informed topic recommendations into the next weekly plan
- Load active Knowledge Base context into weekly planning and creative drafts so brand, voice, compliance, and medical dictionary entries are visible during review
- Download the weekly plan as CSV for team review of topics, hooks, formats, stages, status, and compliance notes
- Mark content briefs as drafted or archived so weekly plans stay manageable
- Archive drafted briefs in one batch after assets are saved so the weekly plan stays focused
- Save a draft asset directly from a weekly brief for faster review prep
- Save all current weekly briefs as draft assets in one batch without duplicate copies
- Reuse an existing brief asset on repeated Save Asset clicks instead of creating duplicates
- Draft conservative educational captions
- Preview and copy saved asset packages with caption variants, carousel slides, or reel scripts
- Download a creative production pack with active assets, captions, slides, scripts, media notes, and KB review context
- Download an asset review CSV that combines draft asset readiness, media rights, approval status, blockers, and source URLs
- Run pre-publish compliance checks
- Record human safety review on assets before queueing
- Approve safety-clear assets and queue approved clear assets in batches
- Add assets to the publishing queue only after asset approval and a clear safety check
- Reuse an existing active queue item when the same asset is added to queue again
- Queue and review posts with approval, regen, and rejection feedback trails
- Download a review log audit trail with recent approval, regeneration, rejection, and safety decisions
- Download the current review queue as CSV with review state, latest feedback, blockers, captions, and media counts
- Keep Review Queue focused on unscheduled draft items while Scheduler handles scheduled and published records
- Show reviewed queue items as approved-but-unscheduled until a planned publish time is selected
- Schedule review-approved, compliance-clear queue items in batches into suggested MYT publishing slots
- Edit queued captions, media URLs, planned time, and channel/format before publishing
- Keep review approval separate from scheduling so approved content still needs a real planned time before handoff or Meta workers can use it
- Suggest the next open MYT publishing slot for compliance-clear queue items and schedule them without guessing
- Filter the scheduler by status/channel and scan the next 7 days of planned posts
- Download the full publishing schedule as CSV for spreadsheet review, blockers, captions, media links, and handoff readiness
- Download scheduled posts as a calendar file for manual publishing reminders
- Download a publishing run sheet for the next manual posting shift, including ready items, blockers, captions, media, and record-published reminders
- Build a manual publishing handoff while Meta credentials are pending
- Copy a ready-to-send publishing handoff package for manual posting
- Show why blocked handoff items are not ready yet
- Record the Meta post ID directly from the handoff after manual posting
- Mark manually published posts with their Meta post ID so metrics ingestion can learn from them later
- Dry-run Facebook and Instagram publishing workers before Meta credentials are connected
- Dry-run the scheduler-ready Meta publishing job against due scheduled posts before real posting is enabled
- Check the scheduled Meta publishing job from Meta Setup without using the terminal
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
