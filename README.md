# DREC Content OS

One continuously-learning content engine for DREC / 逆转医学.

This repository starts the Stage 1 build from the unified proposal:

- Thin Core: shared data model, brand kit, compliance rules, and contracts
- Publish rail: scheduler-ready publish queue
- Sense rail: metric ingestion endpoints and storage
- Human gate: review-ready assets and feedback capture
- Learning spine: outcomes + feedback tables that let the weekly loop improve

## Target Deployment

- **Supabase**: Postgres database and auth-ready storage later
- **Vercel**: web UI shell
- **Fly.io**: Python API and background jobs
- **GitHub**: source control and CI/CD

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

5. Open `apps/web/index.html` in a browser, or deploy `apps/web` to Vercel.

## Current Status

This is not the full Content OS yet. It is the Stage 1 foundation: database, API surface, contracts, deployment files, and UI shell. See `NEXT.md` for the active build path.
