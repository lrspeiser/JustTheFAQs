// pages/api/fetch-and-generate.js

import { main, initClients } from './scripts/fetchAndGenerate';

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

    // Initialize clients and pass directly to main
    const { openai, supabase } = initClients();

    if (!openai || !supabase) {
      throw new Error('Failed to initialize OpenAI or Supabase clients');
    }

    // Get target from request body or use default
    const target = req.body?.target || 2;

    // Pass clients object with both openai and supabase
    await main(target, { openai, supabase });

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