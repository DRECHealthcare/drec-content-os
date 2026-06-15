# Deployment Notes

## Supabase

1. Create a new Supabase project.
2. Open SQL Editor.
3. Run `supabase/schema.sql`.
4. Copy the project URL and service role key into Fly.io secrets.
5. Copy the database connection string into `DATABASE_URL`.

## Fly.io API

Current app:

```text
https://drec-content-os-api.fly.dev
```

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

Current production app:

```text
https://drec-content-os.vercel.app
```

Deploy the repository root as a Vercel project. The root `vercel.json` copies
`apps/web` into `dist` during build, so the project works even if the Vercel
Root Directory is left as the repository root.

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
