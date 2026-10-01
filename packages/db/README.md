# db
Versioned SQL migrations for Supabase/Postgres. Apply with `supabase db push` or `psql`.
Every user-owned table must enable RLS with `user_id = auth.uid()` policies.
