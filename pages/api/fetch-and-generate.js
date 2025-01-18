// pages/api/fetch-and-generate.js
import OpenAI from "openai";
import { createClient } from '@supabase/supabase-js';
import { main } from './scripts/fetchAndGenerate';

export const config = {
  api: {
    bodyParser: true,
    responseLimit: false,
    maxDuration: 300,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[FetchAndGenerate API] Starting FAQ generation process...');

    // Initialize OpenAI
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Initialize Supabase
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing Supabase environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    console.log('[Supabase] Supabase client initialized.');

    const target = req.body?.target || 2;

    await main(target, openai, supabase);

    return res.status(200).json({ 
      success: true, 
      message: 'FAQ generation completed successfully'
    });

  } catch (error) {
    console.error('[FetchAndGenerate API] Error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error'
    });
  }
}