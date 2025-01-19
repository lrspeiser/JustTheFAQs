import OpenAI from "openai";
import { createClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log("[FetchAndGenerate API] Received request...");

    // Verify required environment variables
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("[FetchAndGenerate API] Missing OpenAI API Key");
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("[FetchAndGenerate API] Missing Supabase environment variables");
    }

    console.log("[FetchAndGenerate API] Initializing OpenAI and Supabase clients...");

    // Initialize OpenAI
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Initialize Supabase
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    console.log("[FetchAndGenerate API] Clients initialized successfully.");

    // Import main function dynamically
    const { main } = await import('./scripts/fetchAndGenerate.js');

    // ✅ Ensure target is set, provide a default if missing
    const target = parseInt(req.body?.target, 10) || 2; // 🔹 Default to 2 if undefined

    if (isNaN(target) || target <= 0) {
      throw new Error(`[FetchAndGenerate API] Invalid target value: ${req.body?.target}`);
    }

    console.log(`[FetchAndGenerate API] Starting FAQ generation process with target: ${target}`);

    // Start the process asynchronously (do not await it)
    main(openai, supabase, target).catch(err => {
      console.error("[FetchAndGenerate API] Error in main execution:", err);
    });

    // Return success immediately
    return res.status(200).json({ 
      success: true, 
      message: `Generation process started for ${target} pages.` 
    });

  } catch (error) {
    console.error("[FetchAndGenerate API] Error:", error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error'
    });
  }
}

