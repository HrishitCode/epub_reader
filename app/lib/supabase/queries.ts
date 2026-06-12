import { supabase } from "./client"

export const getUserId = async (): Promise<string> => {
    const { data } = await supabase.auth.getUser()
    if (!data.user) throw new Error("Not authenticated")
    return data.user.id
}

export const getBooks = async (uid: string) => {
    const {data, error} = await supabase
    .from('Books')
    .select()
    .eq('user_id', uid)

    if (error) throw error
    return data ?? []
}

export const insertBook = async (uid: string, book_url: string, title: string, cover_url?: string, start_index?: number, catalog_id?: number) => {
    const {error} = await supabase
    .from('Books')
    .insert({book_url, user_id: uid, title, cover_url: cover_url ?? null, start_index: start_index ?? 0, catalog_id: catalog_id ?? null})

    if (error) {
        console.error("insertBook error:", error.message, error.details, error.hint)
        throw new Error(error.message)
    }
    return true
}

// ── Universal catalog (shared across all users) ──────────────────────────────
// Every unique .epub is stored once in the Catalog table, keyed by the SHA-256
// of its bytes. A user's Books row references the catalog entry (catalog_id) and
// denormalises book_url/title/cover/start_index so the reader & library don't
// need a join. Re-uploading the same file (anywhere) reuses the catalog entry
// instead of storing the file again.
export type CatalogEntry = {
    id: number
    file_hash: string | null
    title: string | null
    book_url: string
    cover_url: string | null
    start_index: number
}

// SHA-256 of the epub bytes → lowercase hex. Used as the dedup key.
export const sha256Hex = async (buffer: ArrayBuffer): Promise<string> => {
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    return Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
}

export const findCatalogByHash = async (hash: string): Promise<CatalogEntry | null> => {
    const { data } = await supabase
        .from('Catalog')
        .select('id, file_hash, title, book_url, cover_url, start_index')
        .eq('file_hash', hash)
        .maybeSingle()
    return (data as CatalogEntry) ?? null
}

// Catalog files are content-addressed (path = sha256 of the bytes), so an
// existing file is by definition the same file — never overwrite (upsert:false).
// Allowing overwrite would let any logged-in user replace a shared book that
// every other reader's library points at. A 409 "already exists" is success.
const isAlreadyExists = (error: { message?: string } | null) =>
    !!error?.message && /already exists|duplicate/i.test(error.message)

export const uploadCatalogFile = async (file: ArrayBuffer, hash: string) => {
    const path = `catalog/${hash}.epub`
    const { data, error } = await supabase.storage
        .from('Test bucket')
        .upload(path, file, { cacheControl: '3600', upsert: false })
    if (error) {
        if (isAlreadyExists(error)) return { path }
        throw error
    }
    return data
}

export const uploadCatalogCover = async (blob: Blob, hash: string) => {
    const path = `catalog/covers/${hash}.jpg`
    const { data, error } = await supabase.storage
        .from('Test bucket')
        .upload(path, blob, { contentType: 'image/jpeg', cacheControl: '3600', upsert: false })
    if (error) {
        if (isAlreadyExists(error)) return { path }
        throw error
    }
    return data
}

export const insertCatalog = async (entry: {
    file_hash: string
    title: string
    book_url: string
    cover_url?: string
    start_index: number
    uploaded_by: string
}): Promise<CatalogEntry> => {
    const { data, error } = await supabase
        .from('Catalog')
        .insert({ ...entry, cover_url: entry.cover_url ?? null })
        .select('id, file_hash, title, book_url, cover_url, start_index')
        .single()
    if (error) throw new Error(error.message)
    return data as CatalogEntry
}

// Search the shared catalog by title (case-insensitive substring).
export const searchCatalog = async (query: string): Promise<CatalogEntry[]> => {
    // Escape ilike pattern metacharacters so user input is matched literally
    // (a bare "%" or "_" would act as a wildcard, "\" as an escape).
    const q = query.trim().slice(0, 100).replace(/[\\%_]/g, "\\$&")
    if (!q) return []
    const { data, error } = await supabase
        .from('Catalog')
        .select('id, file_hash, title, book_url, cover_url, start_index')
        .ilike('title', `%${q}%`)
        .order('title', { ascending: true })
        .limit(30)
    if (error) throw error
    return (data ?? []) as CatalogEntry[]
}

// Add an existing catalog book to a user's library — no file upload. Returns
// false if the user already has it.
export const addBookFromCatalog = async (uid: string, c: CatalogEntry): Promise<boolean> => {
    const { data: existing } = await supabase
        .from('Books')
        .select('id')
        .eq('user_id', uid)
        .eq('catalog_id', c.id)
        .maybeSingle()
    if (existing) return false

    const { error } = await supabase.from('Books').insert({
        user_id: uid,
        catalog_id: c.id,
        book_url: c.book_url,
        cover_url: c.cover_url,
        title: c.title,
        start_index: c.start_index,
    })
    if (error) throw new Error(error.message)
    return true
}

// Spine index where the actual reading material begins (past front matter).
// Used by the reader to open at the body on first open. Defaults to 0.
export const getBookStartIndex = async (bookId: number): Promise<number> => {
    const { data, error } = await supabase
        .from('Books')
        .select('start_index')
        .eq('id', bookId)
        .single()
    if (error) return 0
    return data?.start_index ?? 0
}

export const uploadFile = async (file: ArrayBuffer, uid: string, filename: string) => {
    const path = `${uid}/${Date.now()}_${filename}`
    const {data, error} = await supabase
    .storage
    .from('Test bucket')
    .upload(path, file, {
        cacheControl: '3600',
        upsert: false
    })

    if (error) throw error
    return data
}

export const uploadCover = async (blob: Blob, uid: string, filename: string) => {
    const path = `${uid}/covers/${Date.now()}_${filename}.jpg`
    const {data, error} = await supabase
    .storage
    .from('Test bucket')
    .upload(path, blob, {
        contentType: 'image/jpeg',
        cacheControl: '3600',
        upsert: false
    })
    if (error) throw error
    return data
}

// Extracts the storage path from a full public URL, e.g.:
// "https://xxx.supabase.co/storage/v1/object/public/Test bucket/uid/file.epub"
// → "uid/file.epub"
function storagePathFromUrl(publicUrl: string): string | null {
    try {
        const marker = "/object/public/Test bucket/"
        const idx = publicUrl.indexOf(marker)
        if (idx === -1) return null
        return decodeURIComponent(publicUrl.slice(idx + marker.length))
    } catch { return null }
}

export const deleteBook = async (uid: string, bookId: number, bookUrl: string, coverUrl?: string | null) => {
    // 1. Delete storage files (best-effort — don't fail if already gone).
    //    NEVER touch `catalog/` paths: those files are shared by every user who
    //    added the book from the catalog — removing one user's library entry
    //    must not delete the file out from under everyone else.
    const filesToRemove: string[] = []
    const bookPath = storagePathFromUrl(bookUrl)
    if (bookPath && !bookPath.startsWith('catalog/')) filesToRemove.push(bookPath)
    if (coverUrl) {
        const coverPath = storagePathFromUrl(coverUrl)
        if (coverPath && !coverPath.startsWith('catalog/')) filesToRemove.push(coverPath)
    }
    if (filesToRemove.length > 0) {
        await supabase.storage.from('Test bucket').remove(filesToRemove)
    }

    // 2. Delete the DB row — scoped to the owner so a forged bookId can't
    //    delete someone else's row (RLS is the real guard; this is belt+braces)
    const { error } = await supabase.from('Books').delete().eq('id', bookId).eq('user_id', uid)
    if (error) throw new Error(error.message)
}

// ── Word vocabulary (global + per-book counts) ───────────────────────────────
//
// Two-table design:
//   Words          — one row per (user, word); holds definition + total count
//   WordBookStats  — one row per (word, book);  holds per-book count
//
// This means "ephemeral" looked up in 3 books = 1 Words row + 3 WordBookStats rows.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const upsertWordLookup = async (userId: string, bookId: number, word: string, definition: any) => {
    const now = new Date().toISOString()

    // 1. Upsert global Words row ──────────────────────────────────────────────
    const { data: existingWord } = await supabase
        .from('Words')
        .select('id, total_count')
        .eq('user_id', userId)
        .eq('word', word)
        .single()

    let wordId: number
    if (existingWord) {
        wordId = existingWord.id
        await supabase
            .from('Words')
            .update({ total_count: existingWord.total_count + 1, last_seen: now, definition })
            .eq('id', wordId)
    } else {
        const { data: inserted, error } = await supabase
            .from('Words')
            .insert({ user_id: userId, word, definition, total_count: 1 })
            .select('id')
            .single()
        if (error || !inserted) { console.warn('Words insert error:', error?.message); return }
        wordId = inserted.id
    }

    // 2. Upsert per-book WordBookStats row ────────────────────────────────────
    const { data: existingStat } = await supabase
        .from('WordBookStats')
        .select('id, count')
        .eq('word_id', wordId)
        .eq('book_id', bookId)
        .single()

    if (existingStat) {
        await supabase
            .from('WordBookStats')
            .update({ count: existingStat.count + 1, last_seen: now })
            .eq('id', existingStat.id)
    } else {
        await supabase
            .from('WordBookStats')
            .insert({ word_id: wordId, book_id: bookId, count: 1 })
    }
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type BookStat = {
    book_id: number
    count: number
    first_seen: string
    last_seen: string
}

export type Word = {
    id: number
    word: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    definition: any
    total_count: number
    first_seen: string
    last_seen: string
    book_stats: BookStat[]
}

// Fetches all words for a user with their per-book breakdown.
export const getWords = async (userId: string): Promise<Word[]> => {
    // 1. All Words rows for this user
    const { data: words, error: wordsErr } = await supabase
        .from('Words')
        .select('id, word, definition, total_count, first_seen, last_seen')
        .eq('user_id', userId)
        .order('last_seen', { ascending: false })
    if (wordsErr) throw wordsErr
    if (!words?.length) return []

    // 2. All WordBookStats for those word ids
    const wordIds = words.map(w => w.id)
    const { data: stats, error: statsErr } = await supabase
        .from('WordBookStats')
        .select('word_id, book_id, count, first_seen, last_seen')
        .in('word_id', wordIds)
    if (statsErr) throw statsErr

    // 3. Merge — attach book stats to each word
    const statsByWordId = new Map<number, BookStat[]>()
    for (const s of stats ?? []) {
        const arr = statsByWordId.get(s.word_id) ?? []
        arr.push({ book_id: s.book_id, count: s.count, first_seen: s.first_seen, last_seen: s.last_seen })
        statsByWordId.set(s.word_id, arr)
    }

    return words.map(w => ({ ...w, book_stats: statsByWordId.get(w.id) ?? [] }))
}

// ── Highlights & Notes ────────────────────────────────────────────────────────
export type Highlight = {
    id: number
    book_id: number
    text: string
    note: string | null
    cfi: string | null   // epub CFI range — lets the reader repaint it in-book
    created_at: string
}

// Save a highlighted sentence, optionally with a note and its CFI range.
export const saveHighlight = async (
    userId: string,
    bookId: number,
    text: string,
    note?: string,
    cfi?: string
): Promise<void> => {
    const { error } = await supabase
        .from('Highlights')
        .insert({ user_id: userId, book_id: bookId, text, note: note ?? null, cfi: cfi ?? null })
    if (error) console.warn('saveHighlight error:', error.message)
}

export const getHighlights = async (userId: string): Promise<Highlight[]> => {
    const { data, error } = await supabase
        .from('Highlights')
        .select('id, book_id, text, note, cfi, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []) as Highlight[]
}

// CFI ranges of this user's highlights in one book — used by the reader to
// repaint them when the book opens. Pre-CFI highlights (null) are skipped.
export const getBookHighlightCfis = async (userId: string, bookId: number): Promise<string[]> => {
    const { data, error } = await supabase
        .from('Highlights')
        .select('cfi')
        .eq('user_id', userId)
        .eq('book_id', bookId)
        .not('cfi', 'is', null)
    if (error) return []
    return (data ?? []).map(r => r.cfi as string)
}

export const deleteHighlight = async (id: number, uid: string): Promise<void> => {
    await supabase.from('Highlights').delete().eq('id', id).eq('user_id', uid)
}

// ── Reading progress (cross-device) ─────────────────────────────────────────
// Saves the epub CFI string for a book so the user can resume on any device.
// Also stamps last_opened (for the "Continue reading" card) and, when epub.js
// has generated locations, the overall percentage 0..1 (for progress bars).
export const updateProgress = async (bookId: number, cfi: string, pct?: number) => {
    const patch: Record<string, unknown> = { progress: cfi, last_opened: new Date().toISOString() }
    if (typeof pct === 'number' && pct > 0) patch.progress_pct = pct
    const { error } = await supabase
        .from('Books')
        .update(patch)
        .eq('id', bookId)
    if (error) console.warn("updateProgress error:", error.message)
}

export const getProgress = async (bookId: number): Promise<string | null> => {
    const { data, error } = await supabase
        .from('Books')
        .select('progress')
        .eq('id', bookId)
        .single()
    if (error) return null
    return data?.progress ?? null
}

export const getBookUrl = async (path: string) => {
    const {data} = await supabase
    .storage
    .from('Test bucket')
    .getPublicUrl(path)

    return data
}