# Deployment Notes

## Supabase

1. Create a new Supabase project.
2. Open SQL Editor.
3. Run `supabase/schema.sql`.
4. Copy the project URL and service role key into Fly.io secrets.
5. Copy the database connection string into `DATABASE_URL`.

## Fly.io API

From `drec-content-os`:

```bash
fly launch --no-deploy
fly secrets set DATABASE_URL="postgresql://..."
fly secrets set SUPABASE_URL="https://..."
fly secrets set SUPABASE_SERVICE_ROLE_KEY="..."
fly deploy
```

The API exposes:

- `GET /health`
- `GET /loop-status`
- `GET/POST /kb`
- `GET/POST /publish-queue`
- `POST /metrics`
- `POST /feedback`

## Vercel Web

Deploy `apps/web` as a static Vercel project.

Set:

```text
DREC_API_BASE_URL=https://your-fly-app.fly.dev
```

The current web shell is static. The next pass will wire its buttons to the API.

## GitHub

Recommended repository name:

```text
drec-content-os
```

Push only the `drec-content-os` folder as the first clean repository root.
