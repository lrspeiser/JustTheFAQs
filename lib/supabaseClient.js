// lib/supabaseClient.js
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

// If you are on Replit and want to load .env files, do this:
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL; 
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; 

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("[supabaseClient] ❌ Missing Supabase environment variables");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
