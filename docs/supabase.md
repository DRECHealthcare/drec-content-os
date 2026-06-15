# Supabase Connection

## Project

- Name: DREC Content OS
- Project ref: `ddzqgttrwfwssxnayfsd`
- Region: `ap-southeast-1`
- URL: `https://ddzqgttrwfwssxnayfsd.supabase.co`

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
policies allow the server-side API key role to manage rows while the browser
continues to talk only to the protected Fly.io API.

Before any browser client reads or writes Supabase tables directly, replace the
server-oriented policies with user/session-aware policies.

For now, the planned path is:

1. Backend API on Fly.io connects through Supabase REST using server-side Fly secrets.
2. Web UI talks to the API, not directly to Supabase.
3. Direct Supabase browser access stays disabled until proper login and RLS policies are added.
