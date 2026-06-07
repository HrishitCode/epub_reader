import { supabase } from "./client"


export const signup = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password,
    })
    if (data){
      return data
    }
    return error
}

export const login = async (email: string, password: string): Promise<string | null> => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    })
    if (error) throw error
    return data.user?.id ?? null
}
