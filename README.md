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
- See the next best workflow action on the Dashboard, backed by the API, so testing and automation can move from brief to asset to queue to schedule without guessing
- Pull learning-informed topic recommendations into the next weekly plan
- Mark content briefs as drafted or archived so weekly plans stay manageable
- Save a draft asset directly from a weekly brief for faster review prep
- Draft conservative educational captions
- Preview and copy saved asset packages with caption variants, carousel slides, or reel scripts
- Run pre-publish compliance checks
- Queue and review posts with approval, regen, and rejection feedback trails
- Edit queued captions, media URLs, planned time, and channel/format before publishing
- Keep review approval separate from scheduling so approved content still needs a real planned time before handoff or Meta workers can use it
- Quick-schedule compliance-clear queue items into real publishing slots
- Filter the scheduler by status/channel and scan the next 7 days of planned posts
- Download scheduled posts as a calendar file for manual publishing reminders
- Build a manual publishing handoff while Meta credentials are pending
- Copy a ready-to-send publishing handoff package for manual posting
- Mark manually published posts with their Meta post ID so metrics ingestion can learn from them later
- Dry-run Facebook and Instagram publishing workers before Meta credentials are connected
- Register approved media URLs or upload files into private Supabase Storage
- Approve, review, or block draft assets and media before they enter publishing
- Record raw performance metrics, roll them into scored outcomes, and view the first learning summary
- Build a copy-ready weekly operating report from briefs, queue, assets, feedback, outcomes, and next-topic recommendations

Meta auto-publishing and nightly Meta metrics ingestion are intentionally held until the Facebook Page and Instagram permissions are connected. See `NEXT.md` for the active build path.
