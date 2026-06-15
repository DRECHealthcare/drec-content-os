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
- `publish_queue`
- `raw_metrics`
- `feedback`
- `outcomes`

The initial Knowledge Base seed rows are:

- DREC brand colors
- Health-content baseline
- Editorial posture

## Security Note

Supabase currently reports Row Level Security as disabled for these Stage 1
tables. That is acceptable only while the API is server-side and not exposing
the Supabase anon key for direct table access.

Before any browser client reads or writes Supabase tables directly, enable RLS
and add policies deliberately. Enabling RLS without policies will block all
client access.

Reference remediation SQL:

```sql
alter table public.kb_entries enable row level security;
alter table public.content_briefs enable row level security;
alter table public.assets enable row level security;
alter table public.publish_queue enable row level security;
alter table public.raw_metrics enable row level security;
alter table public.feedback enable row level security;
alter table public.outcomes enable row level security;
```

For now, the planned path is:

1. Backend API on Fly.io connects through Supabase REST using server-side Fly secrets.
2. Web UI talks to the API, not directly to Supabase.
3. RLS policies are added before exposing any direct Supabase browser access.
