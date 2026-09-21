-- 031_profile_avatars.sql
--
-- Storage for the profile picture set from the sidebar profile card.
--
-- A real storage bucket rather than a base64 data URL in app_settings: the
-- avatar renders in the sidebar on every page, so inlining ~40KB of base64
-- into a settings row that several pages already read would put it on the
-- critical path of every screen. A bucket keeps it a cacheable image request.
--
-- The bucket is public-read. It holds a company logo and an owner portrait
-- that the app shows to anyone already looking at the dashboard; signed URLs
-- would add an expiry to refresh for no privacy gained. Writes stay restricted
-- to authenticated users.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists avatars_auth_insert on storage.objects;
create policy avatars_auth_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'avatars');

drop policy if exists avatars_auth_update on storage.objects;
create policy avatars_auth_update on storage.objects
  for update to authenticated using (bucket_id = 'avatars');

drop policy if exists avatars_auth_delete on storage.objects;
create policy avatars_auth_delete on storage.objects
  for delete to authenticated using (bucket_id = 'avatars');

-- The company name already lives here (profile_company). The avatar URL joins
-- it so both the sidebar card and the top bar read one source.
insert into public.app_settings (setting_key, setting_value)
values ('profile_avatar_url', '')
on conflict (setting_key) do nothing;
