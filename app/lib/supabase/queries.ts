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

export const getBookUrl = async (path: string) => {
    const {data} = await supabase
    .storage
    .from('Test bucket')
    .getPublicUrl(path)

    return data
}