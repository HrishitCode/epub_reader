-- New columns for reader features — run in Supabase dashboard → SQL Editor.
-- (Existing RLS policies cover these automatically: they're row-level, not
-- column-level, so no policy changes are needed.)

-- Reading progress as a fraction 0..1 (epub.js location percentage) and the
-- last time the book was opened — powers the "Continue reading" card and the
-- progress bars in the library.
alter table public."Books"
  add column if not exists progress_pct real,
  add column if not exists last_opened timestamptz;

-- epub CFI range of a saved highlight, e.g. "epubcfi(/6/8!/4/2/14,/1:0,/1:42)".
-- Lets the reader re-paint highlights inside the book on open. Nullable —
-- highlights saved before this feature simply won't render in-book.
alter table public."Highlights"
  add column if not exists cfi text;
