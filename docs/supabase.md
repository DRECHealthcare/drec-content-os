# Supabase Connection

## Project

- Name: DREC Content OS
- Project ref: `ddzqgttrwfwssxnayfsd`
- Region: `ap-southeast-1`
- URL: `https://ddzqgttrwfwssxnayfsd.supabase.co`
- Private storage bucket: `drec-media`

## Tables Created

- `kb_entries`
- `content_briefs`
- `assets`
- `media_assets`
- `publish_queue`
- `raw_metrics`
- `feedback`
- `outcomes`
- `learning_weights`

The initial Knowledge Base seed rows are:

- DREC brand colors
- Health-content baseline
- Editorial posture

## Security Note

Row Level Security is enabled for the Content OS tables. The current REST
policies are intentionally not tightened further until Fly has
`SUPABASE_SERVICE_ROLE_KEY` installed. The API currently reports this through
`GET /security/status` and the Dashboard `Security Gate` card.

The target state is:

- Fly API uses `SUPABASE_SERVICE_ROLE_KEY`.
- Browser continues to talk only to the protected Fly.io API.
- Supabase direct browser access remains disabled until proper login and
  user/session-aware RLS policies are added.
- Content OS tables revoke direct `anon` and `authenticated` Data API access.
- The `drec-media` Storage bucket uses service-role-only access for the server
  path.

Before any browser client reads or writes Supabase tables directly, replace the
server-oriented policies with user/session-aware policies.

For now, the planned path is:

1. Backend API on Fly.io connects through Supabase REST using server-side Fly secrets.
2. Backend API uploads media files into the private `drec-media` bucket.
3. Web UI talks to the API, not directly to Supabase.
4. Direct Supabase browser access stays disabled until proper login and RLS policies are added.

## Strict RLS Hardening

The prepared migration is:

```text
supabase/migrations/20260617040906_strict_server_only_rls.sql
```

Do not apply it until:

1. Fly has `SUPABASE_SERVICE_ROLE_KEY` installed.
2. `GET /security/status` returns `ready_for_rls_hardening`.
3. `DREC_ACCESS_TOKEN="..." npm run smoke:live` passes immediately before the migration.

After applying, run the same live smoke check again. Expected behavior:

- Protected Fly API routes still work.
- Direct `anon`/`authenticated` Supabase REST access to Content OS tables is blocked.
- The browser continues to use only the DREC API token and Fly API.

The live API also exposes the same checklist as:

```text
GET /security/rls-hardening-plan.md
```
