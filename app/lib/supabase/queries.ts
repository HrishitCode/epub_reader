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

export const getBookUrl = async (path: string) => {
    const {data} = await supabase
    .storage
    .from('Test bucket')
    .getPublicUrl(path)

    return data
}