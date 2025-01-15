import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Supabase client initialization
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('[Supabase] Missing environment variables for Supabase URL or Anon Key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);
console.log('[Supabase] Supabase client initialized.');

// Helper: Fetch data from Supabase
async function fetchDataFromSupabase(tableName) {
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
async function insertDataToSupabase(tableName, values) {
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
async function querySearchResults(embedding, text) {
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

export { supabase, fetchDataFromSupabase, insertDataToSupabase, querySearchResults };
