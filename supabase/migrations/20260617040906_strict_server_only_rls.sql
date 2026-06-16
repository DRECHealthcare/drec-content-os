-- DREC Content OS strict server-only Supabase access.
-- Apply only after:
-- 1. Fly has SUPABASE_SERVICE_ROLE_KEY installed.
-- 2. `GET /security/status` returns ready_for_rls_hardening.
-- 3. `DREC_ACCESS_TOKEN="..." npm run smoke:live` passes immediately before the migration.
--
-- This migration intentionally blocks direct anon/authenticated Data API access
-- to Content OS tables. The browser must continue to use the protected Fly API.

begin;

revoke all privileges on table
  public.kb_entries,
  public.content_briefs,
  public.assets,
  public.media_assets,
  public.publish_queue,
  public.raw_metrics,
  public.feedback,
  public.outcomes,
  public.learning_weights
from anon, authenticated;

grant select, insert, update, delete on table
  public.kb_entries,
  public.content_briefs,
  public.assets,
  public.media_assets,
  public.publish_queue,
  public.raw_metrics,
  public.feedback,
  public.outcomes,
  public.learning_weights
to service_role;

revoke usage, select on all sequences in schema public from anon, authenticated;
grant usage, select on all sequences in schema public to service_role;

drop policy if exists "drec_api_rest_access" on public.kb_entries;
drop policy if exists "drec_api_rest_access" on public.content_briefs;
drop policy if exists "drec_api_rest_access" on public.assets;
drop policy if exists "drec_api_rest_access" on public.media_assets;
drop policy if exists "drec_api_rest_access" on public.publish_queue;
drop policy if exists "drec_api_rest_access" on public.raw_metrics;
drop policy if exists "drec_api_rest_access" on public.feedback;
drop policy if exists "drec_api_rest_access" on public.outcomes;
drop policy if exists "drec_api_rest_access" on public.learning_weights;

create policy "drec_service_role_access" on public.kb_entries
  for all to service_role using (true) with check (true);
create policy "drec_service_role_access" on public.content_briefs
  for all to service_role using (true) with check (true);
create policy "drec_service_role_access" on public.assets
  for all to service_role using (true) with check (true);
create policy "drec_service_role_access" on public.media_assets
  for all to service_role using (true) with check (true);
create policy "drec_service_role_access" on public.publish_queue
  for all to service_role using (true) with check (true);
create policy "drec_service_role_access" on public.raw_metrics
  for all to service_role using (true) with check (true);
create policy "drec_service_role_access" on public.feedback
  for all to service_role using (true) with check (true);
create policy "drec_service_role_access" on public.outcomes
  for all to service_role using (true) with check (true);
create policy "drec_service_role_access" on public.learning_weights
  for all to service_role using (true) with check (true);

drop policy if exists "drec_media_server_access" on storage.objects;
drop policy if exists "drec_media_service_role_access" on storage.objects;
create policy "drec_media_service_role_access" on storage.objects
  for all to service_role
  using (bucket_id = 'drec-media')
  with check (bucket_id = 'drec-media');

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;

notify pgrst, 'reload schema';

commit;
