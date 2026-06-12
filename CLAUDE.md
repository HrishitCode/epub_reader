# EPUB Reader — Project Guide

## Stack
- **Framework**: Next.js 16 (App Router), React 19, TypeScript
- **Styling**: Tailwind CSS v4 (library/vocabulary pages); inline styles in the reader where react-reader requires them
- **Auth + DB**: Supabase (auth, postgres, `Test bucket` storage)
- **EPUB rendering**: `react-reader` (wraps epub.js); `fflate` for direct zip parsing (metadata, validation)
- **Package manager**: pnpm

## Project structure
```
app/
  page.tsx            # Login / signup page (with "check your email" modal)
  library/page.tsx    # Book grid, upload + validation, catalog search, delete
  home/page.tsx       # Reader — themes, progress sync, selection bar, dictionary, notes
  vocabulary/page.tsx # Notebook — unified feed of words / highlights / notes
  api/define/route.ts # Server proxy to the Free Dictionary API (validated input)
  lib/supabase/
    client.ts         # Supabase client singleton (publishable key only)
    auth.ts           # signup(), login(), logout(), getExistingSession()
    queries.ts        # ALL Supabase calls live here
  types/supabase.ts   # Generated Supabase types
supabase/
  security-policies.sql  # RLS + storage policies — run in Supabase SQL Editor
```

## Supabase schema
- `Books` — per-user library: `id`, `user_id`, `book_url`, `title`, `cover_url`, `start_index`, `progress` (epub CFI), `catalog_id` (FK → Catalog)
- `Catalog` — shared, deduped books keyed by `file_hash` (SHA-256 of the epub bytes); files stored at `catalog/<hash>.epub`, covers at `catalog/covers/<hash>.jpg`
- `Words` — one row per (user, word): definition JSON + total count
- `WordBookStats` — per-(word, book) lookup counts
- `Highlights` — saved passages, optional `note`
- Storage bucket `Test bucket` — public **read**; writes governed by storage policies (catalog files are insert-only/immutable; user files only under own `uid/` prefix)

## Security model (important)
- The browser talks to Supabase with the **publishable key** — client-side `.eq('user_id', …)` filters are convenience, NOT security. **RLS policies are the enforcement layer**: keep `supabase/security-policies.sql` applied and update it whenever a table is added.
- Never prefix server secrets with `NEXT_PUBLIC_` (that inlines them into browser JS). The secret key lives in `.env.local` as `SUPABASE_SECRET_API_KEY`, server-only.
- `allowScriptedContent` in the reader must stay **false** — epubs are user-uploaded HTML and catalog books are shared across users; scripts in the epub iframe could reach the app origin and the Supabase session.
- Catalog storage files are content-addressed and immutable (`upsert: false`; "already exists" treated as success). Never delete `catalog/` storage objects when a user removes a book — other libraries point at them.
- The bucket is public-read by choice: anyone with a URL can download a book file, but cannot list, overwrite, or delete. Acceptable for now; switch to a private bucket + `createSignedUrl()` if book privacy starts to matter.

## Roadmap
1. ~~Book library UI~~ ✅
2. ~~Kindle-like reader theme~~ ✅ (sepia + dark, persisted in `reader_theme` localStorage key)
3. ~~Word definition on select~~ ✅ (selection bar → `/api/define` → popover; saved to Words)
4. **Notion integration** — save highlights/words/notes to a Notion database (next up; will need server-side code — good moment to also move catalog upload server-side so the file hash is verified)
5. Private bucket + signed URLs (optional hardening)

## Key conventions
- Keep ALL Supabase calls in `app/lib/supabase/queries.ts`; do not scatter them in components
- Destructive queries take `uid` and scope with `.eq('user_id', uid)` — belt-and-braces on top of RLS
- Use `ArrayBuffer` when passing epub data between layers (Supabase Storage → react-reader)
- Tailwind for new UI; the reader keeps inline styles (react-reader constraint)
- Upload flow: validate epub structure (`validateEpub`) → SHA-256 hash → catalog lookup → upload only if new → add to user's library

## Known rough edges
- `definition` is typed `any` in Words / queries.ts — needs a proper DictEntry type end-to-end
- `types/supabase.ts` is stale; client.ts creates an untyped client (typed createClient is commented out)
- No password strength requirements beyond Supabase's default minimum
- `/api/define` has no rate limiting

## Learning checkpoints
- Supabase RLS → `supabase/security-policies.sql` is annotated; docs: policies, `auth.uid()`
- epub format internals → `library/page.tsx`: container.xml → OPF → manifest/spine parsing with fflate
- epub.js rendering → react-reader README + epub.js "Rendition" concept
- Notion API → Notion developers: "Append block children", database pages
