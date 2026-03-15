# OpsFlow Setup (Supabase)

## 1) Create Supabase project

- Create a new Supabase project.
- Go to Project Settings -> API.
- Collect these values:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (server-side only)

## 2) Create local env file

Create a file at `opsflow/.env.local` with:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## 3) Apply database schema

- Open Supabase SQL Editor.
- Copy/paste and run: `opsflow/schema.sql`.

This will create:

- Tables: `profiles`, `departments`, `user_departments`, `training_materials`, `training_material_departments`, `replies`, `activity_logs`
- RLS policies
- Storage buckets: `training-files`, `reply-audio` (private)

## 4) Bootstrap a boss account

- Create a user via Supabase Auth (email/password) or by signing in from `/login`.
- In Table Editor -> `profiles`, update that user row:
  - set `role` to `boss` (or `admin`)

## 5) Run the app

From `opsflow/`:

```
npm run dev
```

Open:

- `/login`
- `/training`
- `/boss` (requires `boss` or `admin` role)

## Notes

- `.env*` files are gitignored by default. Do not commit secrets.
