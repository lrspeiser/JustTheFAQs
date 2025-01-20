// lib/db.js
import { createClient } from '@supabase/supabase-js';
import OpenAI from "openai";
import dotenv from 'dotenv';
dotenv.config();

let globalSupabase = null; // Ensure single instance

// Initialize supabase for module-level exports
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (supabaseUrl && supabaseAnonKey) {
  globalSupabase = createClient(supabaseUrl, supabaseAnonKey);
}

export const supabase = globalSupabase;

export function initClients() {
  console.log("[initClients] Initializing clients...");
  if (globalSupabase) {
    console.log("[initClients] Using cached Supabase client.");
    return { openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), supabase: globalSupabase };
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[initClients] ❌ Missing Supabase environment variables");
    return { openai: null, supabase: null };
  }

  try {
    globalSupabase = createClient(supabaseUrl, supabaseAnonKey);
    console.log("[initClients] ✅ Supabase client successfully initialized!");
    return { 
      openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), 
      supabase: globalSupabase 
    };
  } catch (error) {
    console.error("[initClients] ❌ Failed to initialize Supabase:", error.message);
    return { openai: null, supabase: null };
  }
}

// Helper: Fetch data from Supabase
export async function fetchDataFromSupabase(tableName) {
  try {
    console.log(`[Supabase] Fetching data from table: ${tableName}`);
    const { data, error } = await supabase.from(tableName).select();
    if (error) throw error;
    console.log(`[Supabase] Data retrieved from ${tableName}:`, data);
    return data;
  } catch (error) {
    console.error(`[Supabase] Error fetching data from ${tableName}:`, error.message);
    throw error;
  }
}

// Helper: Insert data into Supabase
export async function insertDataToSupabase(tableName, values) {
  try {
    console.log(`[Supabase] Inserting data into table: ${tableName}`);
    const { data, error } = await supabase.from(tableName).insert(values);
    if (error) throw error;
    console.log(`[Supabase] Data inserted into ${tableName}:`, data);
    return data;
  } catch (error) {
    console.error(`[Supabase] Error inserting data into ${tableName}:`, error.message);
    throw error;
  }
}

// Query search results from Supabase REST API
export async function querySearchResults(embedding, text) {
  try {
    console.log('[Supabase] Querying search results...');
    const { data, error } = await supabase
      .rpc('search_faqs', {
        query_embedding: `{${embedding.join(',')}}`,
        text_query: text,
      });
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('[Supabase] Error querying search results:', error.message);
    throw error;
  }
}