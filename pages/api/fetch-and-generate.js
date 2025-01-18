// pages/api/fetch-and-generate.js

import { main, initClients } from './scripts/fetchAndGenerate';

export const config = {
  api: {
    bodyParser: true,
    responseLimit: false,
    maxDuration: 300, // Set to 5 minutes to allow for longer processing
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[FetchAndGenerate API] Starting FAQ generation process...');

    // Initialize clients once
    const clients = initClients();

    // Get target from request body or use default
    const target = req.body?.target || 2;

    // Call main function with clients
    await main(target, clients);

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