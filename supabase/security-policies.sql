-- ═══════════════════════════════════════════════════════════════════════════
-- Row Level Security (RLS) + Storage policies for the EPUB reader
-- Run this in the Supabase dashboard → SQL Editor.
--
-- WHY THIS MATTERS
-- The app talks to Supabase directly from the browser with the publishable
-- key. That key is public by design — anyone can copy it from the JS bundle
-- and issue their own REST queries. The `.eq('user_id', uid)` filters in
-- queries.ts are convenience, NOT security: an attacker simply omits them.
-- RLS is what actually enforces "you can only touch your own rows", because
-- it runs inside Postgres on every query, keyed on auth.uid() from the JWT.
--
-- (Learning checkpoint: https://supabase.com/docs/guides/database/postgres/row-level-security)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Books: strictly per-user ─────────────────────────────────────────────────
alter table public."Books" enable row level security;

drop policy if exists "books_select_own" on public."Books";
create policy "books_select_own" on public."Books"
  for select using (auth.uid() = user_id);

drop policy if exists "books_insert_own" on public."Books";
create policy "books_insert_own" on public."Books"
  for insert with check (auth.uid() = user_id);

drop policy if exists "books_update_own" on public."Books";
create policy "books_update_own" on public."Books"
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "books_delete_own" on public."Books";
create policy "books_delete_own" on public."Books"
  for delete using (auth.uid() = user_id);

-- ── Catalog: shared read, authenticated insert, immutable ───────────────────
-- Every logged-in user may read and add entries; nobody may update or delete
-- from the client (no update/delete policy = denied). This stops one user
-- from rewriting the book_url of a catalog entry that other libraries point at.
alter table public."Catalog" enable row level security;

drop policy if exists "catalog_select_authenticated" on public."Catalog";
create policy "catalog_select_authenticated" on public."Catalog"
  for select to authenticated using (true);

drop policy if exists "catalog_insert_authenticated" on public."Catalog";
create policy "catalog_insert_authenticated" on public."Catalog"
  for insert to authenticated with check (auth.uid() = uploaded_by);

-- ── Words: strictly per-user ─────────────────────────────────────────────────
alter table public."Words" enable row level security;

drop policy if exists "words_select_own" on public."Words";
create policy "words_select_own" on public."Words"
  for select using (auth.uid() = user_id);

drop policy if exists "words_insert_own" on public."Words";
create policy "words_insert_own" on public."Words"
  for insert with check (auth.uid() = user_id);

drop policy if exists "words_update_own" on public."Words";
create policy "words_update_own" on public."Words"
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "words_delete_own" on public."Words";
create policy "words_delete_own" on public."Words"
  for delete using (auth.uid() = user_id);

-- ── WordBookStats: per-user via the parent Words row ────────────────────────
-- This table has no user_id column, so ownership is derived from Words.
alter table public."WordBookStats" enable row level security;

drop policy if exists "wbs_select_own" on public."WordBookStats";
create policy "wbs_select_own" on public."WordBookStats"
  for select using (
    exists (select 1 from public."Words" w
            where w.id = word_id and w.user_id = auth.uid()));

drop policy if exists "wbs_insert_own" on public."WordBookStats";
create policy "wbs_insert_own" on public."WordBookStats"
  for insert with check (
    exists (select 1 from public."Words" w
            where w.id = word_id and w.user_id = auth.uid()));

drop policy if exists "wbs_update_own" on public."WordBookStats";
create policy "wbs_update_own" on public."WordBookStats"
  for update using (
    exists (select 1 from public."Words" w
            where w.id = word_id and w.user_id = auth.uid()));

drop policy if exists "wbs_delete_own" on public."WordBookStats";
create policy "wbs_delete_own" on public."WordBookStats"
  for delete using (
    exists (select 1 from public."Words" w
            where w.id = word_id and w.user_id = auth.uid()));

-- ── Highlights: strictly per-user ────────────────────────────────────────────
alter table public."Highlights" enable row level security;

drop policy if exists "highlights_select_own" on public."Highlights";
create policy "highlights_select_own" on public."Highlights"
  for select using (auth.uid() = user_id);

drop policy if exists "highlights_insert_own" on public."Highlights";
create policy "highlights_insert_own" on public."Highlights"
  for insert with check (auth.uid() = user_id);

drop policy if exists "highlights_delete_own" on public."Highlights";
create policy "highlights_delete_own" on public."Highlights"
  for delete using (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Storage policies — bucket "Test bucket"
-- storage.objects already has RLS enabled; these policies define who may
-- write what. Layout: catalog/<hash>.epub (shared, content-addressed) and
-- <uid>/... (per-user legacy uploads).
-- ═══════════════════════════════════════════════════════════════════════════

-- Authenticated users may add NEW catalog files (content-addressed by hash).
drop policy if exists "catalog_files_insert" on storage.objects;
create policy "catalog_files_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'Test bucket' and name like 'catalog/%');

-- Per-user folder: users may only write/delete inside their own <uid>/ prefix.
drop policy if exists "user_files_insert" on storage.objects;
create policy "user_files_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'Test bucket'
              and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "user_files_delete" on storage.objects;
create policy "user_files_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'Test bucket'
         and (storage.foldername(name))[1] = auth.uid()::text);

-- Deliberately NO update policy and NO delete policy for catalog/% :
-- catalog files are immutable once uploaded (the path IS the sha256 of the
-- bytes), so nobody can overwrite a shared book with a tampered copy.

-- NOTE on reads: the bucket is currently public-read, which means anyone with
-- a URL can download any book without logging in. For a stricter setup, make
-- the bucket private and switch the app from getPublicUrl() to
-- createSignedUrl() — see "Per-user storage paths" on the roadmap.
