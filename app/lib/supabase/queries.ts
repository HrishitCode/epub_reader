import { supabase } from "./client"

export const getUserId = async () => {
    const data = await supabase.auth.getUser()
    return data['data']['user']['id']
}

export const getBooks = async (uid: String) => {
    const {data, error} = await supabase
    .from('Books')
    .select()

    if (data) {
        return data
    }
    return error
}

export const insertBook = async (uid: String, book_url: String) => {
    const {error} = await supabase
    .from('Books')
    .insert({book_url: book_url, user_id: uid})

    if (error){
        return false
    }
    return true
}

export const uploadFile = async (file: ArrayBuffer) => {
    console.log(file)
    const {data, error} = await supabase
    .storage
    .from('Test bucket')
    .upload('User/book2.epub', file, {
        cacheControl: '3600',
        upsert: false
    })

    if (error) throw error
    return data
}

export const getBookUrl = async (path) => {
    const {data} = await supabase
    .storage
    .from('Test bucket')
    .getPublicUrl(path)

    return data
}