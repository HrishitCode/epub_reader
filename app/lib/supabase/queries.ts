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

export const insertBook = async (uid: string, book_url: string, title: string, cover_url?: string) => {
    const {error} = await supabase
    .from('Books')
    .insert({book_url, user_id: uid, title, cover_url: cover_url ?? null})

    if (error) {
        console.error("insertBook error:", error.message, error.details, error.hint)
        throw new Error(error.message)
    }
    return true
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

export const deleteBook = async (bookId: number, bookUrl: string, coverUrl?: string | null) => {
    // 1. Delete storage files (best-effort — don't fail if already gone)
    const filesToRemove: string[] = []
    const bookPath = storagePathFromUrl(bookUrl)
    if (bookPath) filesToRemove.push(bookPath)
    if (coverUrl) {
        const coverPath = storagePathFromUrl(coverUrl)
        if (coverPath) filesToRemove.push(coverPath)
    }
    if (filesToRemove.length > 0) {
        await supabase.storage.from('Test bucket').remove(filesToRemove)
    }

    // 2. Delete the DB row
    const { error } = await supabase.from('Books').delete().eq('id', bookId)
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
    created_at: string
}

// Save a highlighted sentence, optionally with a note.
export const saveHighlight = async (
    userId: string,
    bookId: number,
    text: string,
    note?: string
): Promise<void> => {
    const { error } = await supabase
        .from('Highlights')
        .insert({ user_id: userId, book_id: bookId, text, note: note ?? null })
    if (error) console.warn('saveHighlight error:', error.message)
}

export const getHighlights = async (userId: string): Promise<Highlight[]> => {
    const { data, error } = await supabase
        .from('Highlights')
        .select('id, book_id, text, note, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []) as Highlight[]
}

export const deleteHighlight = async (id: number): Promise<void> => {
    await supabase.from('Highlights').delete().eq('id', id)
}

// ── Reading progress (cross-device) ─────────────────────────────────────────
// Saves the epub CFI string for a book so the user can resume on any device.
export const updateProgress = async (bookId: number, cfi: string) => {
    const { error } = await supabase
        .from('Books')
        .update({ progress: cfi })
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