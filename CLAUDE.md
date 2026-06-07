# EPUB Reader — Project Guide

## Stack
- **Framework**: Next.js 16 (App Router), React 19, TypeScript
- **Styling**: Tailwind CSS v4
- **Auth + DB**: Supabase (auth, postgres `Books` table, `Test bucket` storage)
- **EPUB rendering**: `react-reader` (wraps epub.js)
- **Package manager**: pnpm

## Project structure
```
app/
  page.tsx          # Login / signup page
  home/
    page.tsx        # Reader view — loads epub from Supabase URL
    upload.tsx      # File picker that uploads .epub to Supabase Storage
  lib/supabase/
    client.ts       # Supabase client singleton
    auth.ts         # login(), signup()
    queries.ts      # getBooks(), insertBook(), uploadFile(), getBookUrl(), getUserId()
  types/
    supabase.ts     # Generated Supabase types
  globals.css
  layout.tsx
```

## Supabase schema
- Table `Books`: `id`, `user_id` (uuid FK → auth.users), `book_url` (text)
- Storage bucket: `Test bucket` — public read, stores epub files under `User/`

## Roadmap (iterate in order)
1. **Book library UI** — after login show user's books as cards; route `/home?bookUrl=...`
2. **Kindle-like reader theme** — warm sepia background, Georgia/serif font, comfortable line-height
3. **Word double-tap → definition** — intercept `dblclick` inside the epub iframe, extract selected word, call a dictionary API
4. **Notion integration** — save highlighted words/phrases/notes to a Notion database via the Notion API
5. **Per-user storage paths** — prefix uploads with `uid/` so books are isolated per user

## Key conventions
- Keep Supabase calls in `app/lib/supabase/queries.ts`; do not scatter them in components
- Use `ArrayBuffer` when passing epub data between layers (Supabase Storage → react-reader)
- No inline styles except for `height: 100vh` on the reader container (react-reader requires it)
- Tailwind for everything else; no CSS modules

## Known rough edges (to clean up as we go)
- `uploadFile` hard-codes path `User/book2.epub` — needs `uid/filename` prefix
- `getBooks` does not filter by `user_id` (missing `.eq('user_id', uid)`)
- Login page has no loading state or error display
- `home/page.tsx` shows a broken state when `bookUrl` is absent instead of redirecting

## Learning checkpoints
Each feature iteration notes a concept for the developer to read about:
- Router / search params → Next.js App Router docs: `useSearchParams`, `useRouter`
- epub.js rendering pipeline → react-reader README + epub.js "Rendition" concept
- Supabase RLS (Row Level Security) → Supabase docs: policies, `auth.uid()`
- Dictionary API → Free Dictionary API (`https://api.dictionaryapi.dev/api/v2/entries/en/<word>`)
- Notion API → Notion developers: "Append block children", database pages
