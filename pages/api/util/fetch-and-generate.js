// pages/api/util/fetch-and-generate.js
import { initClients } from '../../../lib/db';
import { main } from '../scripts/fetchAndGenerate';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[API] Starting fetch and generate process...');

    // Initialize clients
    const { openai, supabase } = initClients();

    if (!openai || !supabase) {
      console.error("[API] ❌ One or more clients failed to initialize.");
      return res.status(500).json({ error: 'Failed to initialize required clients' });
    }

    // Call main without allowing it to terminate the process
    const processedCount = await main(openai, supabase);

    console.log(`[API] Process completed successfully. Processed ${processedCount} pages.`);
    return res.status(200).json({ 
      success: true, 
      message: `Fetch and generate process completed successfully. Processed ${processedCount} pages.`,
      processedCount
    });

  } catch (error) {
    console.error('[API] Error in fetch and generate process:', error);
    return res.status(500).json({ 
      error: 'Failed to execute fetch and generate process',
      details: error.message 
    });
  }
}