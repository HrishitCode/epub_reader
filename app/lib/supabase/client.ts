import { createClient, SupabaseClient } from "@supabase/supabase-js";
// import {Database} from "@/types/supabase"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

if (!supabaseKey || !supabaseUrl){
    throw new Error("Missing Supabase Environment Variables")
}

// export const supabase: SupabaseClient<Database> = createClient<Database>(supabaseUrl, supabaseKey)
export const supabase = createClient(supabaseUrl, supabaseKey)