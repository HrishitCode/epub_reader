import { supabase } from "./client"

export const signup = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (data) return data
    return error
}

export const login = async (email: string, password: string): Promise<string | null> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data.user?.id ?? null
}

export const logout = async () => {
    await supabase.auth.signOut()
}

// Returns the current user id if a session already exists, null otherwise.
// Supabase persists the session in localStorage automatically — this just reads it.
export const getExistingSession = async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession()
    return data.session?.user.id ?? null
}
